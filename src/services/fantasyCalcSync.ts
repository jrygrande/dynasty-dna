import { getDb, schema } from "@/db";
import { eq, sql } from "drizzle-orm";
import { getFantasyCalcValues } from "@/lib/fantasycalc";

const STALENESS_MS = 12 * 60 * 60 * 1000; // 12 hours

/**
 * Sync FantasyCalc dynasty trade values for a league's settings.
 * Skips if data is less than 12 hours old.
 * Returns the fetchedAt timestamp, or null if no data.
 */
export async function syncFantasyCalcValues(
  leagueId: string,
  opts?: { force?: boolean },
): Promise<Date | null> {
  const db = getDb();

  // Read league settings to determine scoring format
  const [league] = await db
    .select({
      scoringSettings: schema.leagues.scoringSettings,
      rosterPositions: schema.leagues.rosterPositions,
      totalRosters: schema.leagues.totalRosters,
    })
    .from(schema.leagues)
    .where(eq(schema.leagues.id, leagueId))
    .limit(1);

  if (!league) {
    console.warn(`[fantasyCalcSync] League ${leagueId} not found in DB`);
    return null;
  }

  // Extract PPR setting
  const scoring = league.scoringSettings as Record<string, number> | null;
  const ppr = scoring?.rec ?? 0.5;

  // Detect superflex: check for SUPER_FLEX in roster positions
  const rosterPositions = (league.rosterPositions as string[]) || [];
  const hasSuperFlex = rosterPositions.includes("SUPER_FLEX");
  const numQbs = hasSuperFlex ? 2 : 1;

  const numTeams = league.totalRosters || 12;

  // Staleness check
  const [latestRow] = await db
    .select({
      latest: sql<string>`max(${schema.fantasyCalcValues.fetchedAt})`,
    })
    .from(schema.fantasyCalcValues);

  if (latestRow?.latest && !opts?.force) {
    const lastFetch = new Date(latestRow.latest);
    if (Date.now() - lastFetch.getTime() < STALENESS_MS) {
      return lastFetch;
    }
  }

  // Fetch from FantasyCalc API
  const values = await getFantasyCalcValues({
    isDynasty: true,
    numQbs,
    numTeams,
    ppr,
  });

  // Filter to entries with a sleeper ID
  const withSleeperId = values.filter((v) => v.player.sleeperId);
  const pickEntries = values.filter((v) => v.player.position === "PICK");

  if (withSleeperId.length === 0) {
    console.warn("[fantasyCalcSync] No entries with sleeperId found");
    return null;
  }

  const fetchedAt = new Date();

  // Batch insert players
  const BATCH_SIZE = 50;
  for (let i = 0; i < withSleeperId.length; i += BATCH_SIZE) {
    const batch = withSleeperId.slice(i, i + BATCH_SIZE);
    await db.insert(schema.fantasyCalcValues).values(
      batch.map((v) => ({
        playerId: v.player.sleeperId!,
        playerName: v.player.name,
        value: v.value,
        rank: v.overallRank,
        positionRank: v.positionRank,
        position: v.player.position,
        team: v.player.maybeTeam,
        fetchedAt,
      }))
    );
  }

  // Batch insert PICK entries (use name as ID since no sleeperId)
  for (let i = 0; i < pickEntries.length; i += BATCH_SIZE) {
    const batch = pickEntries.slice(i, i + BATCH_SIZE);
    await db.insert(schema.fantasyCalcValues).values(
      batch.map((v) => ({
        playerId: `PICK_${v.player.name.replace(/\s+/g, "_")}`,
        playerName: v.player.name,
        value: v.value,
        rank: v.overallRank,
        positionRank: v.positionRank,
        position: "PICK",
        team: null,
        fetchedAt,
      }))
    );
  }

  console.log(
    `[fantasyCalcSync] Synced ${withSleeperId.length} players + ${pickEntries.length} picks (ppr=${ppr}, qbs=${numQbs}, teams=${numTeams})`
  );
  return fetchedAt;
}
