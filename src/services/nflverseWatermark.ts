import { getDb, schema } from "@/db";
import { and, eq } from "drizzle-orm";

/**
 * Identifier for an nflverse data source. Used as the partition key in the
 * nflverse_watermarks table so each source can track its own per-season
 * progress independently.
 */
export type NflverseSource = "roster_status" | "injuries" | "schedule";

/**
 * Returns the current NFL season year. Extracted as a function so tests can
 * stub it to exercise the current-vs-historical branch.
 */
export function currentSeason(): number {
  return new Date().getFullYear();
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
 * Record a successful season sync. `lastSyncedWeek` is the highest week
 * ingested in this run; for sources without a meaningful week granularity
 * (e.g. schedule), pass 0 — the row still serves as a "synced at least once"
 * marker for the season.
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
