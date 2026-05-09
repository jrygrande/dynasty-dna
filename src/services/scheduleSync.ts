import { getDb, getSyncDb, schema } from "@/db";
import { sql, eq } from "drizzle-orm";
import {
  setNflverseWatermarkTx,
  shouldSkipSeasonSync,
} from "@/services/nflverseWatermark";
import { recordSyncBreadcrumb } from "@/lib/observability/syncBreadcrumb";
import type { SyncTrigger } from "@/lib/observability/syncBreadcrumb";

const NFLVERSE_GAMES_URL =
  "https://github.com/nflverse/nfldata/raw/master/data/games.csv";

// In-process memoization of the nflverse games CSV. Multi-family cron
// runs hit syncSchedule once per family, so without this, the same ~600KB
// CSV gets re-downloaded N times back-to-back.
//
// Cached for 1 hour so a long-warm Vercel instance picks up mid-day
// nflverse corrections within an hour rather than holding stale data
// for up to 24h. Stores the in-flight promise so concurrent callers
// share a single fetch.
const CSV_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface CsvCacheEntry {
  cachedAt: number;
  promise: Promise<string>;
}

let csvCacheEntry: CsvCacheEntry | null = null;

// Indirection so tests can inject a fake clock.
let nowFn: () => number = () => Date.now();

async function fetchGamesCsv(): Promise<string> {
  const now = nowFn();
  if (csvCacheEntry && now - csvCacheEntry.cachedAt < CSV_CACHE_TTL_MS) {
    return csvCacheEntry.promise;
  }

  const promise = (async () => {
    const response = await fetch(NFLVERSE_GAMES_URL);
    if (!response.ok) {
      throw new Error(`Failed to fetch schedule data: ${response.status}`);
    }
    return response.text();
  })();

  const entry: CsvCacheEntry = { cachedAt: now, promise };
  csvCacheEntry = entry;

  // On error, evict so a retry can re-fetch instead of replaying the failure
  promise.catch(() => {
    if (csvCacheEntry === entry) csvCacheEntry = null;
  });

  return promise;
}

/**
 * Test-only helper. Resets the in-process CSV memoization so each test
 * starts from a known state.
 */
export function __resetScheduleCsvCache(): void {
  csvCacheEntry = null;
}

/**
 * Test-only helper. Injects a fake clock for TTL expiry assertions.
 * Pass `null` to restore Date.now.
 */
export function __setScheduleCsvNow(fn: (() => number) | null): void {
  nowFn = fn ?? (() => Date.now());
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

async function hasScheduleRows(season: number): Promise<boolean> {
  const db = getDb();
  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.nflSchedule)
    .where(eq(schema.nflSchedule.season, season));
  return Number(result[0]?.count || 0) > 0;
}

async function syncScheduleSeason(
  season: number,
  allLines: string[],
  headers: string[],
  force = false
): Promise<number> {
  const skip = await shouldSkipSeasonSync(season, {
    force,
    hasRows: hasScheduleRows,
  });
  if (skip) {
    return 0;
  }

  const col = {
    season: headers.indexOf("season"),
    gameType: headers.indexOf("game_type"),
    week: headers.indexOf("week"),
    homeTeam: headers.indexOf("home_team"),
    awayTeam: headers.indexOf("away_team"),
    homeScore: headers.indexOf("home_score"),
    awayScore: headers.indexOf("away_score"),
    gameday: headers.indexOf("gameday"),
  };

  // Filter lines for this season + REG game type
  const rows: Array<typeof schema.nflSchedule.$inferInsert> = [];
  for (const line of allLines) {
    const cols = parseCSVLine(line);
    const s = parseInt(cols[col.season], 10);
    if (s !== season) continue;
    const gameType = cols[col.gameType]?.trim();
    if (gameType !== "REG") continue;

    const homeTeam = cols[col.homeTeam]?.trim();
    const awayTeam = cols[col.awayTeam]?.trim();
    if (!homeTeam || !awayTeam) continue;

    rows.push({
      season,
      week: parseInt(cols[col.week], 10),
      homeTeam,
      awayTeam,
      homeScore: cols[col.homeScore] ? parseInt(cols[col.homeScore], 10) : null,
      awayScore: cols[col.awayScore] ? parseInt(cols[col.awayScore], 10) : null,
      gameDate: cols[col.gameday]?.trim() || null,
    });
  }

  if (rows.length === 0) return 0;

  const syncDb = getSyncDb();

  // Atomic delete + batch insert inside a transaction
  const BATCH_SIZE = 200;
  let count = 0;

  const maxWeek = rows.reduce(
    (m, r) => ((r.week ?? 0) > m ? r.week ?? 0 : m),
    0
  );

  // Watermark write lives inside the transaction so it commits atomically
  // with the data write — if the inserts roll back, the watermark is not
  // stamped, and vice versa.
  await syncDb.transaction(async (tx) => {
    await tx
      .delete(schema.nflSchedule)
      .where(eq(schema.nflSchedule.season, season));

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      await tx.insert(schema.nflSchedule).values(batch).onConflictDoNothing();
      count += batch.length;
    }

    await setNflverseWatermarkTx(tx, "schedule", season, maxWeek);
  });

  return count;
}

/**
 * Sync NFL schedule data from nflverse.
 * Downloads the full games CSV once and extracts requested seasons.
 */
export async function syncSchedule(options?: {
  seasons?: number[];
  force?: boolean;
  trigger?: SyncTrigger;
}): Promise<{ total: number; seasonResults: Record<number, number> }> {
  const trigger = options?.trigger ?? "manual";
  const seasonScope = options?.seasons?.length
    ? `seasons=${options.seasons.join(",")}`
    : "seasons=all";
  const startedAt = Date.now();

  try {
    const result = await runSyncSchedule(options);
    recordSyncBreadcrumb({
      source: "nflverse",
      trigger,
      scope: `schedule|${seasonScope}`,
      outcome: "success",
      durationMs: Date.now() - startedAt,
      apiCalls: 1, // single CSV fetch (memoized across seasons)
    });
    return result;
  } catch (err) {
    recordSyncBreadcrumb({
      source: "nflverse",
      trigger,
      scope: `schedule|${seasonScope}`,
      outcome: "failed",
      durationMs: Date.now() - startedAt,
      apiCalls: 1,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

async function runSyncSchedule(options?: {
  seasons?: number[];
  force?: boolean;
}): Promise<{ total: number; seasonResults: Record<number, number> }> {
  const force = options?.force ?? false;
  const currentYear = new Date().getFullYear();
  const seasons =
    options?.seasons ??
    Array.from({ length: currentYear - 1999 + 1 }, (_, i) => 1999 + i);

  // Fetch the full CSV once per day (contains all seasons). Memoized so
  // multi-family cron runs share a single download.
  const csv = await fetchGamesCsv();
  const lines = csv.split("\n");
  if (lines.length < 2) return { total: 0, seasonResults: {} };

  const headers = parseCSVLine(lines[0]);
  const dataLines = lines.slice(1).filter((l) => l.trim());

  let total = 0;
  const seasonResults: Record<number, number> = {};

  for (const season of seasons) {
    const count = await syncScheduleSeason(season, dataLines, headers, force);
    seasonResults[season] = count;
    total += count;
  }

  return { total, seasonResults };
}

/**
 * Get bye weeks for a team in a given season.
 * Returns the set of regular season week numbers where the team had no game.
 */
export async function getTeamByeWeeks(
  season: number,
  team: string
): Promise<Set<number>> {
  const db = getDb();
  const games = await db
    .select({ week: schema.nflSchedule.week })
    .from(schema.nflSchedule)
    .where(eq(schema.nflSchedule.season, season));

  // Find all weeks that exist in the schedule
  const allWeeks = new Set(games.map((g) => g.week));
  if (allWeeks.size === 0) return new Set();

  // Find weeks where this team played
  const teamGames = await db
    .select({ week: schema.nflSchedule.week })
    .from(schema.nflSchedule)
    .where(
      sql`${schema.nflSchedule.season} = ${season} AND (${schema.nflSchedule.homeTeam} = ${team} OR ${schema.nflSchedule.awayTeam} = ${team})`
    );

  const teamWeeks = new Set(teamGames.map((g) => g.week));
  const byeWeeks = new Set<number>();
  for (const week of allWeeks) {
    if (!teamWeeks.has(week)) {
      byeWeeks.add(week);
    }
  }

  return byeWeeks;
}
