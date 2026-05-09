/**
 * POST /api/sync/jobs/[jobId]/tick (#151)
 *
 * Cold-start chunked executor entry point. The cold-sync loading screen
 * (#151) hits this every ~1s. Each call:
 *
 *   1. Looks up the job + its family (`syncJobs.ref` is the root league
 *      id; we resolve back to the family from there).
 *   2. Builds the chunked stage list (deterministic — same shape every
 *      tick).
 *   3. Runs stages until the 25s budget is exhausted, then returns the
 *      current cursor + label so the client can update the helix copy.
 *   4. On the final stage, releases the sync lock + returns
 *      `status: "completed"`.
 *
 * Why 25s budget when Vercel allows 30s: we leave a 5s safety margin so a
 * stage that overruns its expected duration still has time to record its
 * watermark / progress before the function is killed. The next tick picks
 * up cleanly.
 *
 * Idempotency: every chunked stage is gated on its own watermark or
 * upsert-on-conflict path. Re-running a stage after a partial completion
 * is a no-op once data is in. Closing the tab and coming back resumes
 * from the persisted cursor.
 *
 * Errors:
 *   - 404 if the job doesn't exist
 *   - 410 if the job already completed / failed (the client should stop
 *     polling and route to the dashboard)
 *   - 200 with `status: "failed"` on a soft failure during stage
 *     execution — we record the error on the audit row and surface a
 *     non-throwing payload so the loading screen can render an inline
 *     retry hint.
 */

import { NextRequest, NextResponse } from "next/server";
import { eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { releaseSyncLock } from "@/services/syncLock";
import { buildFamilyStages, runChunk } from "@/services/chunkedSync";
import { recordSyncBreadcrumb } from "@/lib/observability/syncBreadcrumb";
import { withSyncTransaction } from "@/lib/observability/withSyncTransaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Per-tick wallclock budget. 25s leaves a 5s safety margin under the
 * Vercel 30s function cap. Stages are checked between executions so we
 * never abort mid-stage.
 */
const TICK_BUDGET_MS = 25_000;

interface TickResponse {
  status: "in_progress" | "completed" | "failed";
  stagesCompleted: number;
  stagesTotal: number;
  currentStageLabel: string | null;
  error?: string | null;
}

/** Resolve the family that owns this `syncJobs.ref` (== family root league id). */
async function getFamilyForRef(
  ref: string
): Promise<{ familyId: string; leagueIds: string[] } | null> {
  const db = getDb();

  // 1) Family lookup by rootLeagueId.
  const familyRow = await db
    .select({ id: schema.leagueFamilies.id })
    .from(schema.leagueFamilies)
    .where(eq(schema.leagueFamilies.rootLeagueId, ref))
    .limit(1);

  let familyId = familyRow[0]?.id ?? null;

  // 2) Fallback: the ref is itself a member league id (rare but possible
  //    when a family was created without a populated rootLeagueId).
  if (!familyId) {
    const memberRow = await db
      .select({ familyId: schema.leagueFamilyMembers.familyId })
      .from(schema.leagueFamilyMembers)
      .where(eq(schema.leagueFamilyMembers.leagueId, ref))
      .limit(1);
    familyId = memberRow[0]?.familyId ?? null;
  }

  if (!familyId) return null;

  const members = await db
    .select({
      leagueId: schema.leagueFamilyMembers.leagueId,
      season: schema.leagueFamilyMembers.season,
    })
    .from(schema.leagueFamilyMembers)
    .where(eq(schema.leagueFamilyMembers.familyId, familyId));

  const leagueIds = members
    .sort((a, b) => Number(a.season) - Number(b.season))
    .map((m) => m.leagueId);

  return { familyId, leagueIds };
}

export async function POST(
  _req: NextRequest,
  { params }: { params: { jobId: string } }
) {
  const { jobId } = params;
  if (!jobId) {
    return NextResponse.json(
      { error: "jobId is required" },
      { status: 400 }
    );
  }

  const db = getDb();
  const [job] = await db
    .select({
      id: schema.syncJobs.id,
      ref: schema.syncJobs.ref,
      status: schema.syncJobs.status,
      stagesCompleted: schema.syncJobs.stagesCompleted,
      stagesTotal: schema.syncJobs.stagesTotal,
      currentStage: schema.syncJobs.currentStage,
      trigger: schema.syncJobs.trigger,
    })
    .from(schema.syncJobs)
    .where(eq(schema.syncJobs.id, jobId))
    .limit(1);

  if (!job) {
    return NextResponse.json({ error: "Unknown job" }, { status: 404 });
  }

  // If the job already completed or failed, return the terminal state so
  // the client stops polling. We use 200 + status field rather than 410
  // so the loading screen can render the final label without a special
  // error code path.
  if (job.status !== "running") {
    const payload: TickResponse = {
      status: job.status === "success" ? "completed" : "failed",
      stagesCompleted: job.stagesCompleted ?? 0,
      stagesTotal: job.stagesTotal ?? 0,
      currentStageLabel: job.currentStage ?? null,
    };
    return NextResponse.json(payload);
  }

  if (!job.ref) {
    await releaseSyncLock(jobId, "failed", "syncJobs row missing ref");
    return NextResponse.json(
      {
        status: "failed",
        stagesCompleted: 0,
        stagesTotal: 0,
        currentStageLabel: null,
        error: "Job is missing its family ref",
      } satisfies TickResponse,
      { status: 200 }
    );
  }

  const family = await getFamilyForRef(job.ref);
  if (!family) {
    await releaseSyncLock(jobId, "failed", "Family not found for job ref");
    return NextResponse.json(
      {
        status: "failed",
        stagesCompleted: job.stagesCompleted ?? 0,
        stagesTotal: job.stagesTotal ?? 0,
        currentStageLabel: null,
        error: "Family not found",
      } satisfies TickResponse,
      { status: 200 }
    );
  }

  const startedAt = Date.now();
  const stages = await buildFamilyStages(family.familyId, family.leagueIds, {
    trigger: "lazy",
  });

  const deadlineAt = startedAt + TICK_BUDGET_MS;

  // No "tick started" breadcrumb here — `withSyncTransaction` records the
  // start signal natively, and the chunked-complete / chunked-failed
  // breadcrumbs below capture the terminal outcome. A leading
  // outcome:"success" breadcrumb (per the SyncOutcome contract) would
  // misrepresent unfinished work as complete.

  try {
    const result = await withSyncTransaction(
      "chunked-tick",
      "sync.family",
      () => runChunk(jobId, stages, { deadlineAt })
    );

    if (result.status === "completed") {
      // Touch each league's lastSyncedAt so the freshness gate sees a
      // fresh family on the very next request. The per-stage syncLeague
      // call already does this for seasons it visits, but on a fully-
      // resumed family every stage may have been a watermark no-op — in
      // that case we still want the row marked fresh. `inArray` short-
      // circuits to a no-op predicate on an empty list, which protects
      // against an orphan family (members table empty) producing
      // `WHERE id IN ()` — a Postgres parser error.
      if (family.leagueIds.length > 0) {
        await db
          .update(schema.leagues)
          .set({ lastSyncedAt: new Date() })
          .where(inArray(schema.leagues.id, family.leagueIds));
      }

      await releaseSyncLock(jobId, "success", undefined, {
        stagesCompleted: result.stagesCompleted,
      });

      recordSyncBreadcrumb({
        source: "league-family",
        trigger: "lazy",
        scope: `chunked-complete:${family.familyId}`,
        durationMs: Date.now() - startedAt,
        outcome: "success",
      });

      return NextResponse.json({
        status: "completed",
        stagesCompleted: result.stagesCompleted,
        stagesTotal: result.stagesTotal,
        currentStageLabel: null,
      } satisfies TickResponse);
    }

    return NextResponse.json({
      status: "in_progress",
      stagesCompleted: result.stagesCompleted,
      stagesTotal: result.stagesTotal,
      currentStageLabel: result.currentStageLabel,
    } satisfies TickResponse);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await releaseSyncLock(jobId, "failed", message);

    recordSyncBreadcrumb({
      source: "league-family",
      trigger: "lazy",
      scope: `chunked-failed:${family.familyId}`,
      durationMs: Date.now() - startedAt,
      outcome: "failed",
      error: message,
    });

    // Re-read the cursor so the client gets accurate progress on the
    // failed payload (release didn't bump it).
    const [after] = await db
      .select({
        stagesCompleted: schema.syncJobs.stagesCompleted,
        stagesTotal: schema.syncJobs.stagesTotal,
        currentStage: schema.syncJobs.currentStage,
      })
      .from(schema.syncJobs)
      .where(eq(schema.syncJobs.id, jobId))
      .limit(1);

    return NextResponse.json(
      {
        status: "failed",
        stagesCompleted: after?.stagesCompleted ?? 0,
        stagesTotal: after?.stagesTotal ?? stages.length,
        currentStageLabel: after?.currentStage ?? null,
        error: message,
      } satisfies TickResponse,
      { status: 200 }
    );
  }
}
