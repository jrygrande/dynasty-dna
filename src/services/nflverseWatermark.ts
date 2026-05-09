import { getDb, getSyncDb, schema } from "@/db";
import { and, eq } from "drizzle-orm";

/**
 * Identifier for an nflverse data source. Used as the partition key in the
 * nflverse_watermarks table so each source can track its own per-season
 * progress independently.
 */
export type NflverseSource = "roster_status" | "injuries" | "schedule";

/**
 * Returns the current NFL season year. Extracted as a function so tests can
 * stub it (or pass `now`) to exercise the current-vs-historical branch.
 *
 * The NFL season `N` runs from September of year `N` through early February
 * of year `N+1`. A naive `new Date().getFullYear()` would roll the label
 * forward on Jan 1, prematurely classifying the in-progress
 * playoff/Week-18 season as "historical" and short-circuiting weekly
 * nflverse fetches for injuries, roster status, and schedule. We treat
 * months Aug–Dec as season=year and Jan–July as season=year-1.
 */
export function currentSeason(now: Date = new Date()): number {
  const month = now.getMonth(); // 0-indexed: 0 = Jan, 7 = Aug
  return month >= 7 ? now.getFullYear() : now.getFullYear() - 1;
}

/**
 * Decide whether a season sync should be skipped.
 *
 * - If `force` is true: never skip.
 * - Current season (or future): never skip — in-progress data needs to keep
 *   flowing in week-over-week. (This is the bug fix for #146; the previous
 *   implementation short-circuited as soon as any row existed for the season,
 *   silently missing every subsequent week's data until someone manually
 *   passed `force: true`.)
 * - Historical seasons: skip if the destination table already has rows for
 *   that season. Historical nflverse data is static, so re-fetching is wasted
 *   work and unnecessary write amplification.
 */
export async function shouldSkipSeasonSync(
  season: number,
  opts: {
    force?: boolean;
    now?: number;
    hasRows: (season: number) => Promise<boolean>;
  }
): Promise<boolean> {
  if (opts.force) return false;

  const current = opts.now ?? currentSeason();
  if (season >= current) return false;

  return opts.hasRows(season);
}

/**
 * The argument passed to a `db.transaction(async (tx) => ...)` callback by
 * the WebSocket-backed sync drizzle instance. Inferred from the actual
 * transaction signature so we stay in sync with whatever drizzle exposes
 * without hand-typing PgTransaction generics.
 */
type SyncTx = Parameters<
  Parameters<ReturnType<typeof getSyncDb>["transaction"]>[0]
>[0];

/**
 * Upsert a watermark row using a caller-supplied transaction handle. Call
 * this from inside `db.transaction(async (tx) => ...)` so the watermark
 * write commits atomically with the data write — if the data insert
 * rolls back, the watermark is not stamped; if the watermark write fails,
 * the data write rolls back. This closes the previous footgun where
 * `setNflverseWatermark()` opened a separate connection after the
 * transaction committed: a rolled-back data insert could leave a stamped
 * watermark (skipping the season forever), and a post-commit watermark
 * failure would silently re-do the work next run.
 */
export async function setNflverseWatermarkTx(
  tx: SyncTx,
  source: NflverseSource,
  season: number,
  lastSyncedWeek: number
): Promise<void> {
  await tx
    .insert(schema.nflverseWatermarks)
    .values({ source, season, lastSyncedWeek })
    .onConflictDoUpdate({
      target: [
        schema.nflverseWatermarks.source,
        schema.nflverseWatermarks.season,
      ],
      set: { lastSyncedWeek, lastSyncedAt: new Date() },
    });
}

/**
 * Record a successful season sync without a transaction context. Prefer
 * `setNflverseWatermarkTx` from inside an existing transaction — this
 * form is kept for callers (and tests) that don't have one.
 */
export async function setNflverseWatermark(
  source: NflverseSource,
  season: number,
  lastSyncedWeek: number
): Promise<void> {
  const db = getDb();
  await db
    .insert(schema.nflverseWatermarks)
    .values({ source, season, lastSyncedWeek })
    .onConflictDoUpdate({
      target: [
        schema.nflverseWatermarks.source,
        schema.nflverseWatermarks.season,
      ],
      set: { lastSyncedWeek, lastSyncedAt: new Date() },
    });
}

/**
 * Read the last synced week for a (source, season). Returns 0 if no
 * watermark row exists yet. Currently informational — the per-season syncs
 * still re-ingest the full season CSV — but exposed so callers can build
 * "weeks past the watermark" logic later without another schema migration.
 */
export async function getNflverseWatermark(
  source: NflverseSource,
  season: number
): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({ lastSyncedWeek: schema.nflverseWatermarks.lastSyncedWeek })
    .from(schema.nflverseWatermarks)
    .where(
      and(
        eq(schema.nflverseWatermarks.source, source),
        eq(schema.nflverseWatermarks.season, season)
      )
    )
    .limit(1);
  return rows[0]?.lastSyncedWeek ?? 0;
}
