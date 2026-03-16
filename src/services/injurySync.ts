import { getDb, schema } from "@/db";
import { sql, eq, and } from "drizzle-orm";

const NFLVERSE_INJURY_URL =
  "https://github.com/nflverse/nflverse-data/releases/download/injuries/injuries_";

// nflverse data available from 2009 through 2024
const FIRST_AVAILABLE_SEASON = 2009;
const LAST_AVAILABLE_SEASON = 2024;

interface NflverseInjuryRow {
  season: string;
  game_type: string;
  team: string;
  week: string;
  gsis_id: string;
  position: string;
  full_name: string;
  first_name: string;
  last_name: string;
  report_primary_injury: string;
  report_secondary_injury: string;
  report_status: string;
  practice_primary_injury: string;
  practice_secondary_injury: string;
  practice_status: string;
  date_modified: string;
}

/**
 * Parse a CSV string into an array of objects.
 * Handles quoted fields with commas inside them.
 */
function parseCSV(csv: string): NflverseInjuryRow[] {
  const lines = csv.split("\n");
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]);
  const rows: NflverseInjuryRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = parseCSVLine(line);
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] || "";
    }
    rows.push(row as unknown as NflverseInjuryRow);
  }

  return rows;
}

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

/**
 * Check if a season's injury data has already been synced.
 */
async function isSeasonSynced(season: number): Promise<boolean> {
  const db = await getDb();
  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.nflInjuries)
    .where(eq(schema.nflInjuries.season, season));
  return Number(result[0]?.count || 0) > 0;
}

/**
 * Fetch and ingest injury data from nflverse for a single season.
 * Returns the number of injury records ingested.
 */
async function syncInjurySeason(
  season: number,
  force = false
): Promise<number> {
  if (!force && (await isSeasonSynced(season))) {
    return 0;
  }

  const url = `${NFLVERSE_INJURY_URL}${season}.csv`;
  const response = await fetch(url);

  if (!response.ok) {
    if (response.status === 404) {
      // Season data not available yet
      return 0;
    }
    throw new Error(`Failed to fetch injury data for ${season}: ${response.status}`);
  }

  const csv = await response.text();
  const rows = parseCSV(csv);

  if (rows.length === 0) return 0;

  const db = await getDb();

  // Delete existing data for this season (idempotent rebuild)
  await db
    .delete(schema.nflInjuries)
    .where(eq(schema.nflInjuries.season, season));

  // Batch insert
  const BATCH_SIZE = 100;
  let count = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const values = batch
      .filter((r) => r.gsis_id) // Skip rows without gsis_id
      .map((r) => ({
        season: parseInt(r.season, 10),
        week: parseInt(r.week, 10),
        gsisId: r.gsis_id,
        gameType: r.game_type || null,
        playerName: r.full_name || null,
        team: r.team || null,
        position: r.position || null,
        reportStatus: r.report_status || null,
        reportPrimaryInjury: r.report_primary_injury || null,
        reportSecondaryInjury: r.report_secondary_injury || null,
        practiceStatus: r.practice_status || null,
        practicePrimaryInjury: r.practice_primary_injury || null,
        practiceSecondaryInjury: r.practice_secondary_injury || null,
        dateModified: r.date_modified || null,
      }));

    if (values.length === 0) continue;

    await db
      .insert(schema.nflInjuries)
      .values(values)
      .onConflictDoNothing();

    count += values.length;
  }

  return count;
}

/**
 * Sync injury data from nflverse for specified seasons.
 * If no seasons specified, syncs all available seasons (2009-2024).
 * Skips seasons that are already in the database unless force=true.
 *
 * Returns total number of injury records synced.
 */
export async function syncInjuries(options?: {
  seasons?: number[];
  force?: boolean;
}): Promise<{ total: number; seasonResults: Record<number, number> }> {
  const force = options?.force ?? false;
  const seasons =
    options?.seasons ??
    Array.from(
      { length: LAST_AVAILABLE_SEASON - FIRST_AVAILABLE_SEASON + 1 },
      (_, i) => FIRST_AVAILABLE_SEASON + i
    );

  let total = 0;
  const seasonResults: Record<number, number> = {};

  for (const season of seasons) {
    if (season < FIRST_AVAILABLE_SEASON || season > LAST_AVAILABLE_SEASON) {
      seasonResults[season] = 0;
      continue;
    }

    const count = await syncInjurySeason(season, force);
    seasonResults[season] = count;
    total += count;
  }

  return { total, seasonResults };
}

/**
 * Get injury status for a player in a specific week.
 * Uses gsis_id to look up the player's injury report.
 */
export async function getPlayerInjuryStatus(
  gsisId: string,
  season: number,
  week: number
): Promise<{
  reportStatus: string | null;
  primaryInjury: string | null;
  practiceStatus: string | null;
} | null> {
  const db = await getDb();
  const result = await db
    .select()
    .from(schema.nflInjuries)
    .where(
      and(
        eq(schema.nflInjuries.gsisId, gsisId),
        eq(schema.nflInjuries.season, season),
        eq(schema.nflInjuries.week, week)
      )
    )
    .limit(1);

  if (result.length === 0) return null;

  return {
    reportStatus: result[0].reportStatus,
    primaryInjury: result[0].reportPrimaryInjury,
    practiceStatus: result[0].practiceStatus,
  };
}
