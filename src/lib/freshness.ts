/**
 * Lazy-on-visit freshness gate.
 *
 * `ensureLeagueFresh(familyId)` is the single helper called from every server
 * component under any URL containing a `leagueId` or `familyId`. It enforces
 * the "fresh-on-visit" contract from the Two-Track Sync strategy (#20):
 *
 *   - Fresh (lastSyncedAt within window) -> { ready: true }, render proceeds.
 *   - Stale (warm but past window)       -> sync runs synchronously, then
 *                                           { ready: true }.
 *   - Cold (never synced or no row yet)  -> create syncJobs row,
 *                                           { ready: false, jobId } so the
 *                                           caller can redirect to the cold-
 *                                           start loading screen (#151).
 *
 * Concurrency safety is delegated to the existing `syncJobs` lock
 * (`src/services/syncLock.ts`). If a sync is already running for this family,
 * the second visitor reuses the in-flight `jobId` and gets `ready: false`
 * (the loading screen will poll the same job).
 *
 * Freshness windows:
 *   - In-season  (Sept 1 -> Jan 7 inclusive): 30 minutes
 *   - Off-season:                              1 hour
 *
 * Observability: every lazy run records a `recordSyncBreadcrumb` payload with
 * `trigger: "lazy"` and is wrapped in `withSyncTransaction` so it shows up
 * alongside cron / manual syncs in Sentry Performance.
 */

import { getDb, schema } from "@/db";
import { eq, inArray, sql } from "drizzle-orm";
import { resolveFamily } from "@/lib/familyResolution";
import { syncLeagueFamily } from "@/services/sync";
import {
  acquireSyncLock,
  releaseSyncLock,
} from "@/services/syncLock";
import { recordSyncBreadcrumb } from "@/lib/observability/syncBreadcrumb";
import { withSyncTransaction } from "@/lib/observability/withSyncTransaction";

// --- Freshness windows ------------------------------------------------------

export const IN_SEASON_FRESHNESS_MS = 30 * 60 * 1000; // 30 minutes
export const OFF_SEASON_FRESHNESS_MS = 60 * 60 * 1000; // 1 hour

/**
 * Pure date check for "is it currently NFL regular season."
 *
 * Window: Sept 1 (inclusive) -> Jan 7 (inclusive). This intentionally errs
 * on the side of "in-season" so the week-of-season-rollover and end-of-
 * playoffs both get the tighter 30-minute freshness window.
 *
 * Implementation note: months are 0-indexed (`getMonth() === 0` is January).
 */
export function isInSeason(d: Date = new Date()): boolean {
  const month = d.getUTCMonth();
  const day = d.getUTCDate();

  // September (8) through December (11): always in-season.
  if (month >= 8 && month <= 11) return true;

  // January (0): in-season through Jan 7 inclusive.
  if (month === 0 && day <= 7) return true;

  return false;
}

/** Public for testing / callers that want to know the window without re-deriving. */
export function freshnessWindowMs(now: Date = new Date()): number {
  return isInSeason(now) ? IN_SEASON_FRESHNESS_MS : OFF_SEASON_FRESHNESS_MS;
}

// --- Helpers ---------------------------------------------------------------

/**
 * Read the family-level sync watermark: the *minimum* `lastSyncedAt` across
 * every league in the family. We use the floor (not the max) because the
 * page renders data from every season — if any season is stale, the user
 * effectively sees stale data.
 *
 * Returns `null` when the family has no synced leagues yet (cold path).
 */
async function getFamilyLastSyncedAt(familyId: string): Promise<Date | null> {
  const db = getDb();

  const members = await db
    .select({ leagueId: schema.leagueFamilyMembers.leagueId })
    .from(schema.leagueFamilyMembers)
    .where(eq(schema.leagueFamilyMembers.familyId, familyId));

  if (members.length === 0) return null;

  const ids = members.map((m) => m.leagueId);
  const rows = await db
    .select({ lastSyncedAt: schema.leagues.lastSyncedAt })
    .from(schema.leagues)
    .where(inArray(schema.leagues.id, ids));

  // If any league has never been synced, treat the whole family as cold.
  if (rows.length === 0) return null;
  let minTs: number | null = null;
  for (const r of rows) {
    if (!r.lastSyncedAt) return null;
    const t = new Date(r.lastSyncedAt).getTime();
    if (minTs === null || t < minTs) minTs = t;
  }
  return minTs === null ? null : new Date(minTs);
}

/**
 * Look up the family root league id (used as `syncJobs.ref`). Falls back to
 * the most recent member if `rootLeagueId` is missing.
 */
async function getFamilyRootRef(familyId: string): Promise<string | null> {
  const db = getDb();

  const family = await db
    .select({ rootLeagueId: schema.leagueFamilies.rootLeagueId })
    .from(schema.leagueFamilies)
    .where(eq(schema.leagueFamilies.id, familyId))
    .limit(1);

  if (family.length > 0 && family[0].rootLeagueId) {
    return family[0].rootLeagueId;
  }

  const members = await db
    .select({
      leagueId: schema.leagueFamilyMembers.leagueId,
      season: schema.leagueFamilyMembers.season,
    })
    .from(schema.leagueFamilyMembers)
    .where(eq(schema.leagueFamilyMembers.familyId, familyId))
    .orderBy(sql`${schema.leagueFamilyMembers.season} DESC`)
    .limit(1);

  return members[0]?.leagueId ?? null;
}

/**
 * Find an in-flight `syncJobs` row for a family root ref. Mirrors the
 * staleness threshold inside `acquireSyncLock` so we never report a long-
 * dead job as "still running."
 */
async function findRunningJobId(ref: string): Promise<string | null> {
  const db = getDb();
  const STALE_MS = 10 * 60 * 1000;
  const staleThreshold = new Date(Date.now() - STALE_MS);

  const rows = await db
    .select({ id: schema.syncJobs.id })
    .from(schema.syncJobs)
    .where(
      sql`${schema.syncJobs.ref} = ${ref} AND ${schema.syncJobs.status} = 'running' AND ${schema.syncJobs.startedAt} > ${staleThreshold}`
    )
    .limit(1);

  return rows[0]?.id ?? null;
}

/**
 * Get every league id in a family, oldest-first (matches the API route's
 * sort).
 */
async function getFamilyLeagueIds(familyId: string): Promise<string[]> {
  const db = getDb();
  const members = await db
    .select({
      leagueId: schema.leagueFamilyMembers.leagueId,
      season: schema.leagueFamilyMembers.season,
    })
    .from(schema.leagueFamilyMembers)
    .where(eq(schema.leagueFamilyMembers.familyId, familyId));

  return members
    .sort((a, b) => Number(a.season) - Number(b.season))
    .map((m) => m.leagueId);
}

// --- Public API ------------------------------------------------------------

export interface EnsureLeagueFreshResult {
  /** True when the page can render with current DB data. */
  ready: boolean;
  /**
   * Set when `ready === false` (cold path). Caller should redirect to the
   * loading screen (#151) keyed on this `jobId`. The loading-screen route
   * does not exist yet; until #151 lands, callers may render a placeholder.
   */
  jobId?: string;
  /**
   * Resolved canonical family UUID. Returned so callers don't have to call
   * `resolveFamily` a second time. `null` when the input doesn't resolve to
   * any known family — caller should treat as 404.
   */
  familyId: string | null;
}

export interface EnsureLeagueFreshOptions {
  /** Override "now" for tests. Defaults to `new Date()`. */
  now?: Date;
}

/**
 * Lazy-on-visit freshness gate. Safe to call from any server component on a
 * route under `leagueId` / `familyId`. The input may be a family UUID, a
 * family `rootLeagueId`, or any member league id — all three resolve to the
 * same family via `resolveFamily`.
 *
 * Returns:
 *   - `{ ready: true,  familyId }` -> render with current data.
 *   - `{ ready: false, familyId, jobId }` -> redirect to loading screen
 *     (#151). Until that screen exists, callers can render a placeholder
 *     using the `jobId`.
 *   - `{ ready: true,  familyId: null }` -> family not found; caller should
 *     treat as a 404. We never block on resolution failure.
 */
export async function ensureLeagueFresh(
  familyIdInput: string,
  opts: EnsureLeagueFreshOptions = {}
): Promise<EnsureLeagueFreshResult> {
  const familyId = await resolveFamily(familyIdInput);
  if (!familyId) {
    return { ready: true, familyId: null };
  }

  const now = opts.now ?? new Date();
  const lastSyncedAt = await getFamilyLastSyncedAt(familyId);

  // ---- Fresh ----------------------------------------------------------
  if (lastSyncedAt) {
    const ageMs = now.getTime() - lastSyncedAt.getTime();
    if (ageMs < freshnessWindowMs(now)) {
      return { ready: true, familyId };
    }
  }

  // ---- Cold or stale: try to acquire the sync lock --------------------
  const ref = await getFamilyRootRef(familyId);
  if (!ref) {
    // No member leagues at all — pathological state, treat as ready so the
    // page can render its 404. We never want freshness to mask a 404.
    return { ready: true, familyId };
  }

  const jobId = await acquireSyncLock(ref, { trigger: "lazy" });

  // Lock contended -> someone else is already syncing. Cold visitors get
  // the in-flight job id so they can poll. Stale visitors fall through to
  // ready: true (they can render slightly stale data while the sync
  // completes — better than blocking on someone else's run).
  if (!jobId) {
    if (!lastSyncedAt) {
      const inFlight = await findRunningJobId(ref);
      return { ready: false, familyId, jobId: inFlight ?? undefined };
    }
    return { ready: true, familyId };
  }

  // ---- Cold path: hand off to the loading screen via jobId ------------
  // Per #150 / #151: cold visitors do NOT block on the sync — they get
  // redirected to a loading screen that drives chunked progress. We leave
  // the syncJobs row in `running` state so #151 can pick it up. The lock
  // is released by the chunked executor (#151) when the sync completes.
  if (!lastSyncedAt) {
    recordSyncBreadcrumb({
      source: "league-family",
      trigger: "lazy",
      scope: familyId,
      outcome: "success",
    });
    return { ready: false, familyId, jobId };
  }

  // ---- Stale path: run a watermark-incremental sync synchronously -----
  const start = Date.now();
  let outcome: "success" | "failed" = "success";
  let errMsg: string | undefined;
  let apiCallsMade = 0;

  try {
    const leagueIds = await getFamilyLeagueIds(familyId);
    const result = await withSyncTransaction(
      `freshness.ensureLeagueFresh(${familyId})`,
      "sync.lazy",
      () =>
        syncLeagueFamily(leagueIds, undefined, familyId, { trigger: "lazy" })
    );
    apiCallsMade = result.apiCallsMade;
    await releaseSyncLock(jobId, "success", undefined, { apiCallsMade });
  } catch (err) {
    outcome = "failed";
    errMsg = err instanceof Error ? err.message : String(err);
    await releaseSyncLock(jobId, "failed", errMsg, { apiCallsMade });
  } finally {
    recordSyncBreadcrumb({
      source: "league-family",
      trigger: "lazy",
      scope: familyId,
      durationMs: Date.now() - start,
      outcome,
      apiCalls: apiCallsMade,
      error: errMsg,
    });
  }

  // Even on failure we let the page render — stale data beats a blocking
  // error wall, and the breadcrumb captures the failure for ops.
  return { ready: true, familyId };
}
