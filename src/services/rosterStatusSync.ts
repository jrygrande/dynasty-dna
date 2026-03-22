import { getDb, getSyncDb, schema } from "@/db";
import { sql, eq, and } from "drizzle-orm";

const NFLVERSE_WEEKLY_ROSTER_URL =
  "https://github.com/nflverse/nflverse-data/releases/download/weekly_rosters/roster_weekly_";

// nflverse weekly roster data available from 2002 through current season
const FIRST_AVAILABLE_SEASON = 2002;

/**
 * Parse a CSV line handling quoted fields (nflverse CSVs have quoted headshot URLs with commas).
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

interface RosterRow {
  season: number;
  week: number;
  gsisId: string;
  status: string;
  statusAbbr: string;
  team: string;
  position: string;
  playerName: string;
}

/**
 * Check if a season's roster status data has already been synced.
 */
async function isSeasonSynced(season: number): Promise<boolean> {
  const db = getDb();
  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.nflWeeklyRosterStatus)
    .where(eq(schema.nflWeeklyRosterStatus.season, season));
  return Number(result[0]?.count || 0) > 0;
}

/**
 * Fetch and ingest weekly roster status data from nflverse for a single season.
 * Returns the number of records ingested.
 */
async function syncRosterStatusSeason(
  season: number,
  force = false
): Promise<number> {
  if (!force && (await isSeasonSynced(season))) {
    return 0;
  }

  const url = `${NFLVERSE_WEEKLY_ROSTER_URL}${season}.csv`;
  const response = await fetch(url);

  if (!response.ok) {
    if (response.status === 404) {
      return 0; // Season not available yet
    }
    throw new Error(
      `Failed to fetch weekly roster data for ${season}: ${response.status}`
    );
  }

  const csv = await response.text();
  const lines = csv.split("\n");
  if (lines.length < 2) return 0;

  const headers = parseCSVLine(lines[0]);
  const colIdx = {
    season: headers.indexOf("season"),
    week: headers.indexOf("week"),
    gsisId: headers.indexOf("gsis_id"),
    sleeperId: headers.indexOf("sleeper_id"),
    status: headers.indexOf("status"),
    statusAbbr: headers.indexOf("status_description_abbr"),
    team: headers.indexOf("team"),
    position: headers.indexOf("position"),
    playerName: headers.indexOf("full_name"),
  };

  // Parse all rows + build sleeper→gsis crosswalk
  const rows: RosterRow[] = [];
  const sleeperToGsis = new Map<string, string>();
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cols = parseCSVLine(line);
    const gsisId = cols[colIdx.gsisId]?.trim();
    if (!gsisId) continue; // Skip rows without GSIS ID

    // Build crosswalk map (sleeper_id → gsis_id)
    const sleeperId = colIdx.sleeperId >= 0 ? cols[colIdx.sleeperId]?.trim() : "";
    if (sleeperId && gsisId) {
      sleeperToGsis.set(sleeperId, gsisId);
    }

    rows.push({
      season: parseInt(cols[colIdx.season], 10),
      week: parseInt(cols[colIdx.week], 10),
      gsisId,
      status: cols[colIdx.status] || "",
      statusAbbr: cols[colIdx.statusAbbr] || "",
      team: cols[colIdx.team] || "",
      position: cols[colIdx.position] || "",
      playerName: cols[colIdx.playerName] || "",
    });
  }

  if (rows.length === 0) return 0;

  const db = getDb();
  const syncDb = getSyncDb();

  // Atomic delete + batch insert inside a transaction
  const BATCH_SIZE = 200;
  let count = 0;

  await syncDb.transaction(async (tx) => {
    await tx
      .delete(schema.nflWeeklyRosterStatus)
      .where(eq(schema.nflWeeklyRosterStatus.season, season));

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const values = batch.map((r) => ({
        season: r.season,
        week: r.week,
        gsisId: r.gsisId,
        status: r.status,
        statusAbbr: r.statusAbbr,
        team: r.team,
        position: r.position,
        playerName: r.playerName,
      }));

      await tx
        .insert(schema.nflWeeklyRosterStatus)
        .values(values)
        .onConflictDoNothing();

      count += values.length;
    }
  });

  // Backfill gsis_id into players table using sleeper_id crosswalk
  if (sleeperToGsis.size > 0) {
    const BACKFILL_BATCH = 50;
    const entries = Array.from(sleeperToGsis.entries());
    let backfilled = 0;
    for (let i = 0; i < entries.length; i += BACKFILL_BATCH) {
      const batch = entries.slice(i, i + BACKFILL_BATCH);
      for (const [sleeperId, gsisId] of batch) {
        const result = await db.execute(
          sql`UPDATE ${schema.players} SET gsis_id = ${gsisId}, updated_at = now() WHERE id = ${sleeperId} AND (gsis_id IS NULL OR gsis_id != ${gsisId})`
        );
        if (result.rowCount && result.rowCount > 0) backfilled++;
      }
    }
    if (backfilled > 0) {
      console.log(`  Backfilled gsis_id for ${backfilled} players from ${season} roster data`);
    }
  }

  return count;
}

/**
 * Sync weekly roster status data from nflverse.
 * If no seasons specified, syncs all available seasons.
 * Skips seasons already in the database unless force=true.
 */
export async function syncRosterStatus(options?: {
  seasons?: number[];
  force?: boolean;
}): Promise<{ total: number; seasonResults: Record<number, number> }> {
  const force = options?.force ?? false;
  const currentYear = new Date().getFullYear();
  const seasons =
    options?.seasons ??
    Array.from(
      { length: currentYear - FIRST_AVAILABLE_SEASON + 1 },
      (_, i) => FIRST_AVAILABLE_SEASON + i
    );

  let total = 0;
  const seasonResults: Record<number, number> = {};

  for (const season of seasons) {
    if (season < FIRST_AVAILABLE_SEASON) {
      seasonResults[season] = 0;
      continue;
    }

    const count = await syncRosterStatusSeason(season, force);
    seasonResults[season] = count;
    total += count;
  }

  return { total, seasonResults };
}

/**
 * Get a player's roster status for a specific week.
 */
export async function getPlayerRosterStatus(
  gsisId: string,
  season: number,
  week: number
): Promise<{
  status: string;
  statusAbbr: string | null;
  team: string | null;
} | null> {
  const db = getDb();
  const result = await db
    .select()
    .from(schema.nflWeeklyRosterStatus)
    .where(
      and(
        eq(schema.nflWeeklyRosterStatus.gsisId, gsisId),
        eq(schema.nflWeeklyRosterStatus.season, season),
        eq(schema.nflWeeklyRosterStatus.week, week)
      )
    )
    .limit(1);

  if (result.length === 0) return null;

  return {
    status: result[0].status,
    statusAbbr: result[0].statusAbbr,
    team: result[0].team,
  };
}
