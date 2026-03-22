import { getDb, schema } from "@/db";
import { eq, and, sql } from "drizzle-orm";

const STALE_JOB_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Attempt to acquire a sync lock for a family root league ID.
 * Returns the job ID if acquired, or null if a sync is already running.
 */
export async function acquireSyncLock(
  familyRootId: string
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

  // Insert a new running job
  const [job] = await db
    .insert(schema.syncJobs)
    .values({
      type: "league_sync",
      ref: familyRootId,
      status: "running",
    })
    .returning({ id: schema.syncJobs.id });

  return job.id;
}

/**
 * Release a sync lock by updating the job status.
 */
export async function releaseSyncLock(
  jobId: string,
  status: "success" | "failed",
  error?: string
): Promise<void> {
  const db = getDb();

  await db
    .update(schema.syncJobs)
    .set({
      status,
      error: error ?? null,
      finishedAt: new Date(),
    })
    .where(eq(schema.syncJobs.id, jobId));
}
