import { getDb, schema } from "@/db";
import { eq, and, sql } from "drizzle-orm";
import type { SyncTrigger } from "@/lib/observability/syncBreadcrumb";

const STALE_JOB_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

interface AcquireSyncLockOpts {
  /** What kicked off this run. Defaults to "manual" when omitted. */
  trigger?: SyncTrigger;
  /** Total stages this run will execute (chunked-stage executor — #151). */
  stagesTotal?: number;
}

/**
 * Attempt to acquire a sync lock for a family root league ID.
 * Returns the job ID if acquired, or null if a sync is already running.
 */
export async function acquireSyncLock(
  familyRootId: string,
  opts?: AcquireSyncLockOpts
): Promise<string | null> {
  const db = getDb();

  // Check for a running job that isn't stale
  const staleThreshold = new Date(Date.now() - STALE_JOB_TIMEOUT_MS);

  const running = await db
    .select({ id: schema.syncJobs.id })
    .from(schema.syncJobs)
    .where(
      and(
        eq(schema.syncJobs.ref, familyRootId),
        eq(schema.syncJobs.status, "running"),
        sql`${schema.syncJobs.startedAt} > ${staleThreshold}`
      )
    )
    .limit(1);

  if (running.length > 0) {
    return null; // Already running
  }

  // Mark any stale running jobs as failed
  await db
    .update(schema.syncJobs)
    .set({
      status: "failed",
      error: "Timed out (stale job)",
      finishedAt: new Date(),
    })
    .where(
      and(
        eq(schema.syncJobs.ref, familyRootId),
        eq(schema.syncJobs.status, "running"),
        sql`${schema.syncJobs.startedAt} <= ${staleThreshold}`
      )
    );

  // Insert a new running job. Default `trigger` to "manual" so the audit
  // column is always populated even when a caller forgets to pass it.
  const [job] = await db
    .insert(schema.syncJobs)
    .values({
      type: "league_sync",
      ref: familyRootId,
      status: "running",
      trigger: opts?.trigger ?? "manual",
      apiCallsMade: 0,
      stagesCompleted: 0,
      stagesTotal: opts?.stagesTotal ?? null,
    })
    .returning({ id: schema.syncJobs.id });

  return job.id;
}

/**
 * Release a sync lock by updating the job status. Optionally records the
 * total `apiCallsMade` and the final `stagesCompleted` for the run so the
 * audit row reflects what the sync actually did.
 */
export async function releaseSyncLock(
  jobId: string,
  status: "success" | "failed",
  error?: string,
  audit?: {
    apiCallsMade?: number;
    stagesCompleted?: number;
  }
): Promise<void> {
  const db = getDb();

  const set: Record<string, unknown> = {
    status,
    error: error ?? null,
    finishedAt: new Date(),
  };
  if (audit?.apiCallsMade != null) set.apiCallsMade = audit.apiCallsMade;
  if (audit?.stagesCompleted != null)
    set.stagesCompleted = audit.stagesCompleted;

  await db.update(schema.syncJobs).set(set).where(eq(schema.syncJobs.id, jobId));
}

/**
 * Increment the running tally of Sleeper API calls on a sync_jobs row.
 * Best-effort — never throws if the update fails (we don't want
 * observability to break the underlying sync).
 */
export async function incrementSyncJobApiCalls(
  jobId: string,
  by = 1
): Promise<void> {
  if (!jobId) return;
  try {
    const db = getDb();
    await db
      .update(schema.syncJobs)
      .set({
        apiCallsMade: sql`coalesce(${schema.syncJobs.apiCallsMade}, 0) + ${by}`,
      })
      .where(eq(schema.syncJobs.id, jobId));
  } catch {
    // Swallow — observability must never break the caller.
  }
}

/**
 * Update the current_stage / stages_completed audit fields. Used by the
 * chunked-stage executor (#151) to record progress as each stage finishes.
 */
export async function updateSyncJobStage(
  jobId: string,
  currentStage: string | null,
  stagesCompleted?: number
): Promise<void> {
  if (!jobId) return;
  try {
    const db = getDb();
    const set: Record<string, unknown> = { currentStage };
    if (stagesCompleted != null) set.stagesCompleted = stagesCompleted;
    await db
      .update(schema.syncJobs)
      .set(set)
      .where(eq(schema.syncJobs.id, jobId));
  } catch {
    // Swallow — observability must never break the caller.
  }
}
