import { getDb, schema } from "@/db";
import { eq, and, sql } from "drizzle-orm";
import { getFantasyCalcValues } from "@/lib/fantasycalc";

const STALENESS_MS = 12 * 60 * 60 * 1000; // 12 hours

/**
 * Sync FantasyCalc dynasty trade values for a league's settings.
 * Upserts by (playerId, isSuperFlex, ppr) — each config gets one row per player.
 * Skips if data for this config is less than 12 hours old.
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
  const isSuperFlex = rosterPositions.includes("SUPER_FLEX");
  const numQbs = isSuperFlex ? 2 : 1;

  const numTeams = league.totalRosters || 12;

  // Staleness check per config key (isSuperFlex + ppr)
  const [latestRow] = await db
    .select({
      latest: sql<string>`max(${schema.fantasyCalcValues.fetchedAt})`,
    })
    .from(schema.fantasyCalcValues)
    .where(
      and(
        eq(schema.fantasyCalcValues.isSuperFlex, isSuperFlex),
        eq(schema.fantasyCalcValues.ppr, ppr),
      ),
    );

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

  // Batch upsert players
  const BATCH_SIZE = 50;
  for (let i = 0; i < withSleeperId.length; i += BATCH_SIZE) {
    const batch = withSleeperId.slice(i, i + BATCH_SIZE);
    await db
      .insert(schema.fantasyCalcValues)
      .values(
        batch.map((v) => ({
          playerId: v.player.sleeperId!,
          isSuperFlex,
          ppr,
          playerName: v.player.name,
          value: v.value,
          rank: v.overallRank,
          positionRank: v.positionRank,
          position: v.player.position,
          team: v.player.maybeTeam,
          fetchedAt,
        })),
      )
      .onConflictDoUpdate({
        target: [
          schema.fantasyCalcValues.playerId,
          schema.fantasyCalcValues.isSuperFlex,
          schema.fantasyCalcValues.ppr,
        ],
        set: {
          playerName: sql`excluded.player_name`,
          value: sql`excluded.value`,
          rank: sql`excluded.rank`,
          positionRank: sql`excluded.position_rank`,
          position: sql`excluded.position`,
          team: sql`excluded.team`,
          fetchedAt: sql`excluded.fetched_at`,
        },
      });
  }

  // Batch upsert PICK entries (use name as ID since no sleeperId)
  for (let i = 0; i < pickEntries.length; i += BATCH_SIZE) {
    const batch = pickEntries.slice(i, i + BATCH_SIZE);
    await db
      .insert(schema.fantasyCalcValues)
      .values(
        batch.map((v) => ({
          playerId: `PICK_${v.player.name.replace(/\s+/g, "_")}`,
          isSuperFlex,
          ppr,
          playerName: v.player.name,
          value: v.value,
          rank: v.overallRank,
          positionRank: v.positionRank,
          position: "PICK",
          team: null,
          fetchedAt,
        })),
      )
      .onConflictDoUpdate({
        target: [
          schema.fantasyCalcValues.playerId,
          schema.fantasyCalcValues.isSuperFlex,
          schema.fantasyCalcValues.ppr,
        ],
        set: {
          playerName: sql`excluded.player_name`,
          value: sql`excluded.value`,
          rank: sql`excluded.rank`,
          positionRank: sql`excluded.position_rank`,
          position: sql`excluded.position`,
          team: sql`excluded.team`,
          fetchedAt: sql`excluded.fetched_at`,
        },
      });
  }

  console.log(
    `[fantasyCalcSync] Synced ${withSleeperId.length} players + ${pickEntries.length} picks (ppr=${ppr}, sf=${isSuperFlex}, teams=${numTeams})`,
  );
  return fetchedAt;
}
