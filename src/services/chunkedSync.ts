/**
 * Chunked sync executor (#151).
 *
 * Wraps the existing `syncLeague` / global-sync helpers so a single
 * `syncJobs` row can be advanced one stage at a time across multiple
 * HTTP ticks. Why chunked:
 *
 *   - Vercel functions cap at 30s. A pathological 10-season cold sync can
 *     exceed that even after the within-season parallelism win.
 *   - The cold-start loading screen (#151) needs a "what's happening right
 *     now" signal, not just a binary done/not-done.
 *
 * Why not just run `syncLeagueFamily` per tick: it's atomic — once you
 * call it, you're committed to the whole thing. We need finer granularity
 * so the user sees per-season progress and so we can yield back to the
 * client (and the Vercel runtime) cheaply between stages.
 *
 * Key invariants:
 *
 *   - Idempotent: each stage is gated on the underlying watermark / row
 *     state, so re-running it is a no-op once data is in. Closing the
 *     tab and coming back picks up cleanly.
 *   - Budget-aware: `runChunk` accepts a deadline and stops cleanly between
 *     stages when the budget is exhausted (never mid-stage).
 *   - Progress-only side effects: every successful stage bumps
 *     `stagesCompleted` / `currentStage` on the `syncJobs` row via
 *     `updateSyncJobStage`. Counters are the single source of truth for
 *     the loading screen.
 */

import { getDb, schema } from "@/db";
import { eq, inArray } from "drizzle-orm";
import { syncLeague } from "@/services/sync";
import { syncPlayers } from "@/services/playerSync";
import { syncFantasyCalcValues } from "@/services/fantasyCalcSync";
import { syncRosterStatus } from "@/services/rosterStatusSync";
import { syncInjuries } from "@/services/injurySync";
import { syncSchedule } from "@/services/scheduleSync";
import { rollupManagerGrades } from "@/services/managerGrades";
import { updateSyncJobStage } from "@/services/syncLock";
import type { SyncTrigger } from "@/lib/observability/syncBreadcrumb";

// --- Types --------------------------------------------------------------

/** A single chunk of work the executor knows how to advance one tick at a time. */
export interface ChunkedStage {
  /** Stable key persisted to `sync_jobs.current_stage`. */
  key: string;
  /** Friendly label surfaced to the loading screen. */
  label: string;
  /** Function that runs the work. Idempotent. */
  run: () => Promise<void>;
}

export interface ChunkedRunResult {
  status: "in_progress" | "completed";
  stagesCompleted: number;
  stagesTotal: number;
  currentStageKey: string | null;
  currentStageLabel: string | null;
}

export interface BuildStagesOpts {
  trigger?: SyncTrigger;
}

// --- Stage planning -----------------------------------------------------

/**
 * Build the ordered stage list for a family. Same shape every tick — the
 * executor uses the persisted `stagesCompleted` count as a cursor into
 * this array.
 *
 * Stages, in order:
 *   1. `players` — global player metadata refresh
 *   2. `nflverse` — roster status + injuries + schedule for every season
 *   3. `fantasycalc` — dynasty trade values
 *   4. For each season (oldest -> newest): one `season:{year}` stage that
 *      runs the full per-season `syncLeague` (within-season parallelism is
 *      already exploited inside that call). The label is friendly:
 *      `"season N of M"`.
 *   5. `manager-grades` — career rollup
 *
 * 5-season family: 1 + 1 + 1 + 5 + 1 = 9 stages. Issue body's "23 stages"
 * count assumed per-data-type granularity per season; in practice the
 * within-season parallelism makes per-season the right granularity.
 */
export async function buildFamilyStages(
  familyId: string,
  leagueIds: string[],
  opts: BuildStagesOpts = {}
): Promise<ChunkedStage[]> {
  const trigger = opts.trigger ?? "lazy";
  const db = getDb();

  // Order leagues oldest-first — matches the existing sync route + makes
  // "season 1 of 5" line up with the chronologically earliest season.
  const members = await db
    .select({
      leagueId: schema.leagueFamilyMembers.leagueId,
      season: schema.leagueFamilyMembers.season,
    })
    .from(schema.leagueFamilyMembers)
    .where(inArray(schema.leagueFamilyMembers.leagueId, leagueIds));

  const ordered = [...members].sort(
    (a, b) => Number(a.season) - Number(b.season)
  );

  // Compute the union of seasons across the family so the global nflverse
  // sync covers every season in one go.
  const seasonNumbers: number[] = [];
  for (const m of ordered) {
    const n = parseInt(m.season, 10);
    if (!isNaN(n)) seasonNumbers.push(n);
  }
  const uniqueSeasons = [...new Set(seasonNumbers)];

  const totalSeasons = ordered.length;

  const stages: ChunkedStage[] = [];

  stages.push({
    key: "players",
    label: "Refreshing player metadata",
    run: async () => {
      await syncPlayers(false, {
        trigger,
        scope: `family=${familyId}`,
      });
    },
  });

  stages.push({
    key: "nflverse",
    label: "Loading NFL data",
    run: async () => {
      if (uniqueSeasons.length === 0) return;
      await syncRosterStatus({ seasons: uniqueSeasons, trigger });
      await syncInjuries({ seasons: uniqueSeasons, trigger });
      await syncSchedule({ seasons: uniqueSeasons, trigger });
    },
  });

  stages.push({
    key: "fantasycalc",
    label: "Pulling dynasty values",
    run: async () => {
      const mostRecent = ordered[ordered.length - 1]?.leagueId;
      if (!mostRecent) return;
      await syncFantasyCalcValues(mostRecent, { trigger });
    },
  });

  ordered.forEach((member, i) => {
    const seasonIndex = i + 1;
    stages.push({
      key: `season:${member.season}`,
      label: `season ${seasonIndex} of ${totalSeasons}`,
      run: async () => {
        await syncLeague(member.leagueId, undefined, familyId, {
          skipGlobalSyncs: true,
          trigger,
        });
      },
    });
  });

  stages.push({
    key: "manager-grades",
    label: "Computing career grades",
    run: async () => {
      try {
        await rollupManagerGrades(familyId);
      } catch (err) {
        // Non-critical — match `syncLeagueFamily`'s behaviour. Surfacing
        // this would block the loading screen indefinitely on a soft
        // failure; the audit row already captures the underlying error.
        // eslint-disable-next-line no-console
        console.warn(
          `[chunked-sync] manager grade rollup failed for ${familyId}:`,
          err
        );
      }
    },
  });

  return stages;
}

// --- Executor -----------------------------------------------------------

export interface RunChunkOpts {
  /** Wallclock deadline (`Date.now()`). The executor stops cleanly when reached. */
  deadlineAt: number;
  /** Optional cursor override (for tests). Defaults to the persisted value. */
  startFromCursor?: number;
}

/**
 * Advance the chunked executor one HTTP-tick's worth of work. Stops when
 * either (a) every stage has run, or (b) the deadline is reached. Always
 * leaves the `syncJobs` row in a consistent state — `stagesCompleted` is
 * the cursor of "stages done so far," and resuming on the next tick is a
 * matter of starting from that index.
 *
 * Returns the final state for the tick (`in_progress` if more work
 * remains; `completed` if every stage ran).
 */
export async function runChunk(
  jobId: string,
  stages: ChunkedStage[],
  opts: RunChunkOpts
): Promise<ChunkedRunResult> {
  const db = getDb();
  const total = stages.length;

  // Read the persisted cursor (stagesCompleted) so concurrent ticks pick
  // up where the last one left off.
  let cursor = opts.startFromCursor;
  if (cursor == null) {
    const [row] = await db
      .select({
        stagesCompleted: schema.syncJobs.stagesCompleted,
      })
      .from(schema.syncJobs)
      .where(eq(schema.syncJobs.id, jobId))
      .limit(1);
    cursor = row?.stagesCompleted ?? 0;
  }

  // Persist the total + the (optimistic) current stage label up front so
  // the very first tick already shows real progress on the client.
  if (total > 0 && cursor < total) {
    await db
      .update(schema.syncJobs)
      .set({
        stagesTotal: total,
        currentStage: stages[cursor]?.label ?? null,
      })
      .where(eq(schema.syncJobs.id, jobId));
  }

  while (cursor < total) {
    if (Date.now() >= opts.deadlineAt) break;

    const stage = stages[cursor];
    // Surface the stage we're about to run *before* running it so the
    // client sees the label flip the moment the work starts.
    await updateSyncJobStage(jobId, stage.label, cursor);

    try {
      await stage.run();
    } catch (err) {
      // Soft-fail: log and rethrow. The tick route catches and records
      // failure on the audit row. We deliberately don't bump the cursor
      // so the next manual reload retries the failed stage.
      // eslint-disable-next-line no-console
      console.warn(
        `[chunked-sync] stage ${stage.key} failed for job ${jobId}:`,
        err
      );
      throw err;
    }

    cursor += 1;
    await updateSyncJobStage(
      jobId,
      cursor < total ? stages[cursor].label : null,
      cursor
    );
  }

  if (cursor >= total) {
    return {
      status: "completed",
      stagesCompleted: cursor,
      stagesTotal: total,
      currentStageKey: null,
      currentStageLabel: null,
    };
  }

  const next = stages[cursor];
  return {
    status: "in_progress",
    stagesCompleted: cursor,
    stagesTotal: total,
    currentStageKey: next?.key ?? null,
    currentStageLabel: next?.label ?? null,
  };
}
