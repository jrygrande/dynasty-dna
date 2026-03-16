/**
 * CLI script to sync NFL weekly roster status and injury data.
 *
 * This script syncs two data sources:
 * 1. nflverse weekly roster status (ACT/RES/INA/DEV/CUT) — primary availability source
 * 2. nflverse injury reports (Out/Questionable/Doubtful + injury details) — detail overlay
 *
 * Usage:
 *   npx tsx scripts/sync-2025-injuries.ts                    # Sync 2025 only
 *   npx tsx scripts/sync-2025-injuries.ts 2023 2024 2025     # Sync specific seasons
 *   npx tsx scripts/sync-2025-injuries.ts --all              # Sync all available seasons
 *   npx tsx scripts/sync-2025-injuries.ts --force 2025       # Force re-sync even if data exists
 */

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { sql, eq } from "drizzle-orm";
import * as schema from "../src/db/schema";

const DATABASE_URL = process.env.DATABASE_URL!;
const sqlClient = neon(DATABASE_URL);
const db = drizzle(sqlClient, { schema });

const NFLVERSE_ROSTER_URL =
  "https://github.com/nflverse/nflverse-data/releases/download/weekly_rosters/roster_weekly_";
const NFLVERSE_INJURY_URL =
  "https://github.com/nflverse/nflverse-data/releases/download/injuries/injuries_";
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

async function syncRosterStatus(season: number, force: boolean): Promise<number> {
  // Check if already synced
  if (!force) {
    const existing = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.nflWeeklyRosterStatus)
      .where(eq(schema.nflWeeklyRosterStatus.season, season));
    if (Number(existing[0]?.count || 0) > 0) {
      console.log(`  Roster status ${season}: already synced (use --force to resync)`);
      return 0;
    }
  }

  const url = `${NFLVERSE_ROSTER_URL}${season}.csv`;
  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 404) {
      console.log(`  Roster status ${season}: not available (404)`);
      return 0;
    }
    throw new Error(`HTTP ${res.status} fetching roster data for ${season}`);
  }

  const csv = await res.text();
  const lines = csv.split("\n");
  const headers = parseCSVLine(lines[0]);
  const col = {
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

  // Delete existing
  await db
    .delete(schema.nflWeeklyRosterStatus)
    .where(eq(schema.nflWeeklyRosterStatus.season, season));

  // Parse and batch insert + build sleeper→gsis crosswalk
  const BATCH_SIZE = 200;
  let count = 0;
  let batch: Array<typeof schema.nflWeeklyRosterStatus.$inferInsert> = [];
  const sleeperToGsis = new Map<string, string>();

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = parseCSVLine(line);
    const gsisId = cols[col.gsisId]?.trim();
    if (!gsisId) continue;

    // Build crosswalk
    const sleeperId = col.sleeperId >= 0 ? cols[col.sleeperId]?.trim() : "";
    if (sleeperId && gsisId) {
      sleeperToGsis.set(sleeperId, gsisId);
    }

    batch.push({
      season: parseInt(cols[col.season], 10),
      week: parseInt(cols[col.week], 10),
      gsisId,
      status: cols[col.status] || "",
      statusAbbr: cols[col.statusAbbr] || "",
      team: cols[col.team] || "",
      position: cols[col.position] || "",
      playerName: cols[col.playerName] || "",
    });

    if (batch.length >= BATCH_SIZE) {
      await db.insert(schema.nflWeeklyRosterStatus).values(batch).onConflictDoNothing();
      count += batch.length;
      batch = [];
    }
  }

  if (batch.length > 0) {
    await db.insert(schema.nflWeeklyRosterStatus).values(batch).onConflictDoNothing();
    count += batch.length;
  }

  // Backfill gsis_id into players table
  let backfilled = 0;
  for (const [sleeperId, gsisId] of sleeperToGsis) {
    const result = await db.execute(
      sql`UPDATE ${schema.players} SET gsis_id = ${gsisId}, updated_at = now() WHERE id = ${sleeperId} AND (gsis_id IS NULL OR gsis_id != ${gsisId})`
    );
    if (Number(result.rowCount || 0) > 0) backfilled++;
  }
  if (backfilled > 0) {
    console.log(`  Backfilled gsis_id for ${backfilled} players`);
  }

  console.log(`  Roster status ${season}: ${count} records`);
  return count;
}

async function syncInjuries(season: number, force: boolean): Promise<number> {
  if (!force) {
    const existing = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.nflInjuries)
      .where(eq(schema.nflInjuries.season, season));
    if (Number(existing[0]?.count || 0) > 0) {
      console.log(`  Injuries ${season}: already synced (use --force to resync)`);
      return 0;
    }
  }

  const url = `${NFLVERSE_INJURY_URL}${season}.csv`;
  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 404) {
      console.log(`  Injuries ${season}: not available (404)`);
      return 0;
    }
    throw new Error(`HTTP ${res.status} fetching injury data for ${season}`);
  }

  const csv = await res.text();
  const lines = csv.split("\n");
  const headers = parseCSVLine(lines[0]);
  const col = {
    season: headers.indexOf("season"),
    week: headers.indexOf("week"),
    gsisId: headers.indexOf("gsis_id"),
    gameType: headers.indexOf("game_type"),
    playerName: headers.indexOf("full_name"),
    team: headers.indexOf("team"),
    position: headers.indexOf("position"),
    reportStatus: headers.indexOf("report_status"),
    reportPrimaryInjury: headers.indexOf("report_primary_injury"),
    reportSecondaryInjury: headers.indexOf("report_secondary_injury"),
    practiceStatus: headers.indexOf("practice_status"),
    practicePrimaryInjury: headers.indexOf("practice_primary_injury"),
    practiceSecondaryInjury: headers.indexOf("practice_secondary_injury"),
    dateModified: headers.indexOf("date_modified"),
  };

  await db.delete(schema.nflInjuries).where(eq(schema.nflInjuries.season, season));

  const BATCH_SIZE = 100;
  let count = 0;
  let batch: Array<typeof schema.nflInjuries.$inferInsert> = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = parseCSVLine(line);
    const gsisId = cols[col.gsisId]?.trim();
    if (!gsisId) continue;

    batch.push({
      season: parseInt(cols[col.season], 10),
      week: parseInt(cols[col.week], 10),
      gsisId,
      gameType: cols[col.gameType] || null,
      playerName: cols[col.playerName] || null,
      team: cols[col.team] || null,
      position: cols[col.position] || null,
      reportStatus: cols[col.reportStatus] || null,
      reportPrimaryInjury: cols[col.reportPrimaryInjury] || null,
      reportSecondaryInjury: cols[col.reportSecondaryInjury] || null,
      practiceStatus: cols[col.practiceStatus] || null,
      practicePrimaryInjury: cols[col.practicePrimaryInjury] || null,
      practiceSecondaryInjury: cols[col.practiceSecondaryInjury] || null,
      dateModified: cols[col.dateModified] || null,
    });

    if (batch.length >= BATCH_SIZE) {
      await db.insert(schema.nflInjuries).values(batch).onConflictDoNothing();
      count += batch.length;
      batch = [];
    }
  }

  if (batch.length > 0) {
    await db.insert(schema.nflInjuries).values(batch).onConflictDoNothing();
    count += batch.length;
  }

  console.log(`  Injuries ${season}: ${count} records`);
  return count;
}

// Cache for the full games CSV (downloaded once, used for all seasons)
let gamesCSVCache: { headers: string[]; lines: string[] } | null = null;

async function fetchGamesCSV(): Promise<{ headers: string[]; lines: string[] }> {
  if (gamesCSVCache) return gamesCSVCache;
  const res = await fetch(NFLVERSE_GAMES_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching games CSV`);
  const csv = await res.text();
  const lines = csv.split("\n");
  gamesCSVCache = {
    headers: parseCSVLine(lines[0]),
    lines: lines.slice(1).filter((l) => l.trim()),
  };
  return gamesCSVCache;
}

async function syncSchedule(season: number, force: boolean): Promise<number> {
  if (!force) {
    const existing = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.nflSchedule)
      .where(eq(schema.nflSchedule.season, season));
    if (Number(existing[0]?.count || 0) > 0) {
      console.log(`  Schedule ${season}: already synced (use --force to resync)`);
      return 0;
    }
  }

  const { headers, lines } = await fetchGamesCSV();
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

  await db.delete(schema.nflSchedule).where(eq(schema.nflSchedule.season, season));

  const BATCH_SIZE = 100;
  let count = 0;
  let batch: Array<typeof schema.nflSchedule.$inferInsert> = [];

  for (const line of lines) {
    const cols = parseCSVLine(line);
    const s = parseInt(cols[col.season], 10);
    if (s !== season) continue;
    if (cols[col.gameType]?.trim() !== "REG") continue;
    const homeTeam = cols[col.homeTeam]?.trim();
    const awayTeam = cols[col.awayTeam]?.trim();
    if (!homeTeam || !awayTeam) continue;

    batch.push({
      season,
      week: parseInt(cols[col.week], 10),
      homeTeam,
      awayTeam,
      homeScore: cols[col.homeScore] ? parseInt(cols[col.homeScore], 10) : null,
      awayScore: cols[col.awayScore] ? parseInt(cols[col.awayScore], 10) : null,
      gameDate: cols[col.gameday]?.trim() || null,
    });

    if (batch.length >= BATCH_SIZE) {
      await db.insert(schema.nflSchedule).values(batch).onConflictDoNothing();
      count += batch.length;
      batch = [];
    }
  }

  if (batch.length > 0) {
    await db.insert(schema.nflSchedule).values(batch).onConflictDoNothing();
    count += batch.length;
  }

  console.log(`  Schedule ${season}: ${count} games`);
  return count;
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const filteredArgs = args.filter((a) => a !== "--force");

  let seasons: number[];
  if (filteredArgs.includes("--all")) {
    const currentYear = new Date().getFullYear();
    seasons = Array.from({ length: currentYear - 2002 + 1 }, (_, i) => 2002 + i);
  } else if (filteredArgs.length > 0) {
    seasons = filteredArgs.map((s) => parseInt(s, 10)).filter((n) => !isNaN(n));
  } else {
    seasons = [2025];
  }

  console.log(`=== NFL Data Sync (${force ? "forced" : "incremental"}) ===`);
  console.log(`Seasons: ${seasons.join(", ")}\n`);

  let totalRoster = 0;
  let totalInjury = 0;
  let totalSchedule = 0;

  for (const season of seasons) {
    console.log(`Season ${season}:`);
    totalRoster += await syncRosterStatus(season, force);
    totalInjury += await syncInjuries(season, force);
    totalSchedule += await syncSchedule(season, force);
  }

  console.log(`\nDone! Roster status: ${totalRoster}, Injuries: ${totalInjury}, Schedule: ${totalSchedule}`);
}

main().catch(console.error);
