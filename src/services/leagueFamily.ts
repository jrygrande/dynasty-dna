import { Sleeper, type SleeperLeague } from "@/lib/sleeper";
import { getDb, schema } from "@/db";
import { eq, sql } from "drizzle-orm";
import { BATCH_SIZE } from "@/services/batchHelper";

/**
 * Traverse the league chain via previous_league_id to discover all seasons
 * of a dynasty league family.
 */
export async function discoverLeagueFamily(
  rootLeagueId: string
): Promise<SleeperLeague[]> {
  const chain: SleeperLeague[] = [];
  const visited = new Set<string>();
  let currentId: string | null = rootLeagueId;

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    try {
      const league = await Sleeper.getLeague(currentId);
      chain.push(league);
      currentId = league.previous_league_id;
    } catch {
      break;
    }
  }

  // Sort oldest to newest
  chain.sort((a, b) => Number(a.season) - Number(b.season));
  return chain;
}


/**
 * Ensure a league family exists in the database, creating it if needed.
 * Uses INSERT...ON CONFLICT DO NOTHING + fallback SELECT to avoid TOCTOU races.
 * Returns the family ID.
 */
export async function ensureLeagueFamily(
  rootLeagueId: string
): Promise<string> {
  const db = getDb();

  // Check if family already exists for this root league
  const existing = await db
    .select({ id: schema.leagueFamilies.id })
    .from(schema.leagueFamilies)
    .where(eq(schema.leagueFamilies.rootLeagueId, rootLeagueId))
    .limit(1);

  if (existing.length > 0) {
    return existing[0].id;
  }

  // Discover the full chain
  const chain = await discoverLeagueFamily(rootLeagueId);
  if (chain.length === 0) {
    throw new Error(`No leagues found for root ID ${rootLeagueId}`);
  }

  // The root league is the most recent
  const mostRecent = chain[chain.length - 1];

  // Batch upsert league records
  const leagueValues = chain.map((league) => ({
    id: league.league_id,
    name: league.name,
    season: league.season,
    previousLeagueId: league.previous_league_id,
    status: league.status,
    settings: league.settings,
    scoringSettings: league.scoring_settings,
    rosterPositions: league.roster_positions,
    totalRosters: league.total_rosters,
  }));

  for (let i = 0; i < leagueValues.length; i += BATCH_SIZE) {
    await db
      .insert(schema.leagues)
      .values(leagueValues.slice(i, i + BATCH_SIZE))
      .onConflictDoUpdate({
        target: schema.leagues.id,
        set: {
          name: sql`excluded.name`,
          status: sql`excluded.status`,
          settings: sql`excluded.settings`,
          scoringSettings: sql`excluded.scoring_settings`,
          rosterPositions: sql`excluded.roster_positions`,
          totalRosters: sql`excluded.total_rosters`,
        },
      });
  }

  // Atomic upsert: INSERT...ON CONFLICT DO NOTHING prevents duplicate families
  const [family] = await db
    .insert(schema.leagueFamilies)
    .values({
      rootLeagueId: mostRecent.league_id,
      name: mostRecent.name,
    })
    .onConflictDoNothing({
      target: schema.leagueFamilies.rootLeagueId,
    })
    .returning();

  // If we lost the race, another insert won — just SELECT it
  const familyId =
    family?.id ??
    (await db
      .select({ id: schema.leagueFamilies.id })
      .from(schema.leagueFamilies)
      .where(eq(schema.leagueFamilies.rootLeagueId, mostRecent.league_id))
      .then((r) => r[0]!.id));

  // Batch upsert family members
  const memberValues = chain.map((league) => ({
    familyId,
    leagueId: league.league_id,
    season: league.season,
  }));

  for (let i = 0; i < memberValues.length; i += BATCH_SIZE) {
    await db
      .insert(schema.leagueFamilyMembers)
      .values(memberValues.slice(i, i + BATCH_SIZE))
      .onConflictDoNothing();
  }

  return familyId;
}
