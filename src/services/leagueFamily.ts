import { Sleeper, type SleeperLeague } from "@/lib/sleeper";
import { getDb, schema } from "@/db";
import { eq } from "drizzle-orm";

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
 * Returns the family ID.
 */
export async function ensureLeagueFamily(
  rootLeagueId: string
): Promise<string> {
  const db = getDb();

  // Check if family already exists for this root league
  const existing = await db
    .select()
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

  // Insert league records
  for (const league of chain) {
    await db
      .insert(schema.leagues)
      .values({
        id: league.league_id,
        name: league.name,
        season: league.season,
        previousLeagueId: league.previous_league_id,
        status: league.status,
        settings: league.settings,
        scoringSettings: league.scoring_settings,
        rosterPositions: league.roster_positions,
        totalRosters: league.total_rosters,
      })
      .onConflictDoUpdate({
        target: schema.leagues.id,
        set: {
          name: league.name,
          status: league.status,
          settings: league.settings,
          scoringSettings: league.scoring_settings,
          rosterPositions: league.roster_positions,
          totalRosters: league.total_rosters,
        },
      });
  }

  // Create the family
  const [family] = await db
    .insert(schema.leagueFamilies)
    .values({
      rootLeagueId: mostRecent.league_id,
      name: mostRecent.name,
    })
    .returning();

  // Link all leagues to the family
  for (const league of chain) {
    await db
      .insert(schema.leagueFamilyMembers)
      .values({
        familyId: family.id,
        leagueId: league.league_id,
        season: league.season,
      })
      .onConflictDoNothing();
  }

  return family.id;
}
