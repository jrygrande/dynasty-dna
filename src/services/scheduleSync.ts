import { getDb, schema } from "@/db";
import { sql, eq } from "drizzle-orm";

const NFLVERSE_GAMES_URL =
  "https://github.com/nflverse/nfldata/raw/master/data/games.csv";

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

async function isSeasonSynced(season: number): Promise<boolean> {
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
  if (!force && (await isSeasonSynced(season))) {
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

  const db = getDb();

  // Delete existing data for this season
  await db.delete(schema.nflSchedule).where(eq(schema.nflSchedule.season, season));

  // Batch insert
  const BATCH_SIZE = 100;
  let count = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    await db.insert(schema.nflSchedule).values(batch).onConflictDoNothing();
    count += batch.length;
  }

  return count;
}

/**
 * Sync NFL schedule data from nflverse.
 * Downloads the full games CSV once and extracts requested seasons.
 */
export async function syncSchedule(options?: {
  seasons?: number[];
  force?: boolean;
}): Promise<{ total: number; seasonResults: Record<number, number> }> {
  const force = options?.force ?? false;
  const currentYear = new Date().getFullYear();
  const seasons =
    options?.seasons ??
    Array.from({ length: currentYear - 1999 + 1 }, (_, i) => 1999 + i);

  // Fetch the full CSV once (contains all seasons)
  const response = await fetch(NFLVERSE_GAMES_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch schedule data: ${response.status}`);
  }

  const csv = await response.text();
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
