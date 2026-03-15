import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getDb, schema } from "@/db";
import { Sleeper } from "@/lib/sleeper";
import { eq } from "drizzle-orm";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getDb();
  const links = await db
    .select()
    .from(schema.sleeperLinks)
    .where(eq(schema.sleeperLinks.userId, session.user.id))
    .limit(1);

  if (links.length === 0) {
    return NextResponse.json(
      { error: "No Sleeper account linked" },
      { status: 400 }
    );
  }

  const sleeperId = links[0].sleeperId;

  // Get current NFL state to know what season to query
  const nflState = await Sleeper.getNFLState();
  const currentSeason = nflState.season;

  // Fetch leagues for current and previous seasons
  const seasonsToCheck = [
    String(currentSeason),
    String(currentSeason - 1),
    String(currentSeason - 2),
  ];

  const allLeagues: Array<{
    league_id: string;
    name: string;
    season: string;
    total_rosters: number;
    status: string;
    previous_league_id: string | null;
  }> = [];

  for (const season of seasonsToCheck) {
    try {
      const leagues = await Sleeper.getLeaguesByUser(sleeperId, season);
      if (leagues) {
        // Only include dynasty leagues (have previous_league_id or are the first season)
        for (const league of leagues) {
          // Deduplicate by league_id
          if (!allLeagues.find((l) => l.league_id === league.league_id)) {
            allLeagues.push({
              league_id: league.league_id,
              name: league.name,
              season: league.season,
              total_rosters: league.total_rosters,
              status: league.status,
              previous_league_id: league.previous_league_id,
            });
          }
        }
      }
    } catch {
      // Season might not exist yet
    }
  }

  // Group leagues into families (chains of previous_league_id)
  const families = groupIntoFamilies(allLeagues);

  return NextResponse.json({ families, sleeperId });
}

interface LeagueSummary {
  league_id: string;
  name: string;
  season: string;
  total_rosters: number;
  status: string;
  previous_league_id: string | null;
}

interface LeagueFamily {
  name: string;
  currentLeagueId: string;
  currentSeason: string;
  seasons: LeagueSummary[];
}

function groupIntoFamilies(leagues: LeagueSummary[]): LeagueFamily[] {
  const byId = new Map(leagues.map((l) => [l.league_id, l]));
  const visited = new Set<string>();
  const families: LeagueFamily[] = [];

  // For each league, trace back through previous_league_id to find the chain
  for (const league of leagues) {
    if (visited.has(league.league_id)) continue;

    // Find the most recent league in this chain
    let current = league;
    const chain: LeagueSummary[] = [];

    // First, collect the chain going backward
    const seen = new Set<string>();
    let cursor: LeagueSummary | undefined = current;
    while (cursor && !seen.has(cursor.league_id)) {
      seen.add(cursor.league_id);
      chain.push(cursor);
      visited.add(cursor.league_id);
      if (cursor.previous_league_id) {
        cursor = byId.get(cursor.previous_league_id);
      } else {
        break;
      }
    }

    // Also check if any league points to this one (forward chain)
    for (const l of leagues) {
      if (l.previous_league_id === league.league_id && !visited.has(l.league_id)) {
        chain.unshift(l);
        visited.add(l.league_id);
      }
    }

    // Sort by season descending
    chain.sort((a, b) => Number(b.season) - Number(a.season));
    const mostRecent = chain[0];

    families.push({
      name: mostRecent.name,
      currentLeagueId: mostRecent.league_id,
      currentSeason: mostRecent.season,
      seasons: chain,
    });
  }

  // Sort families by name
  families.sort((a, b) => a.name.localeCompare(b.name));
  return families;
}
