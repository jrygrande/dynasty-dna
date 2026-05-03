import { NextRequest, NextResponse } from "next/server";
import { getDb, schema } from "@/db";
import { eq, inArray } from "drizzle-orm";
import { resolveFamily } from "@/lib/familyResolution";
import { DEMO_LEAGUE_NAME, getDemoSwapForRequest } from "@/lib/demoServer";
import { swapLeagueUser } from "@/lib/demoTransforms";
import {
  compareStandings,
  getAllTimeStandings,
  getChampionRosterFromBracket,
} from "@/services/familyStandings";
import type { SleeperBracketMatchup } from "@/lib/sleeper";

export async function GET(
  req: NextRequest,
  { params }: { params: { familyId: string } }
) {
  const db = getDb();
  const familyId = params.familyId;
  const seasonParam = req.nextUrl.searchParams.get("season");
  const allTime = seasonParam === "all";

  const resolvedFamilyId = await resolveFamily(familyId);

  if (!resolvedFamilyId) {
    const leagues = await db
      .select()
      .from(schema.leagues)
      .where(eq(schema.leagues.id, familyId))
      .limit(1);

    if (leagues.length === 0) {
      return NextResponse.json({ error: "League not found" }, { status: 404 });
    }

    const league = leagues[0];
    const [rosters, users] = await Promise.all([
      db
        .select()
        .from(schema.rosters)
        .where(eq(schema.rosters.leagueId, league.id)),
      db
        .select({
          userId: schema.leagueUsers.userId,
          displayName: schema.leagueUsers.displayName,
          teamName: schema.leagueUsers.teamName,
          avatar: schema.leagueUsers.avatar,
        })
        .from(schema.leagueUsers)
        .where(eq(schema.leagueUsers.leagueId, league.id)),
    ]);

    return NextResponse.json({
      league: {
        id: league.id,
        name: league.name,
        season: league.season,
        totalRosters: league.totalRosters,
        status: league.status,
      },
      familyId: null,
      seasons: [{ leagueId: league.id, season: league.season }],
      rosters: rosters
        .map((r) => ({
          rosterId: r.rosterId,
          ownerId: r.ownerId,
          wins: r.wins || 0,
          losses: r.losses || 0,
          ties: r.ties || 0,
          fpts: r.fpts || 0,
          fptsAgainst: r.fptsAgainst || 0,
          seasonsPlayed: 1,
          championshipYears: [] as string[],
        }))
        .sort(compareStandings),
      users,
    });
  }

  const members = await db
    .select()
    .from(schema.leagueFamilyMembers)
    .where(eq(schema.leagueFamilyMembers.familyId, resolvedFamilyId));

  const seasons = members
    .map((m) => ({ leagueId: m.leagueId, season: m.season }))
    .sort((a, b) => Number(b.season) - Number(a.season));

  if (seasons.length === 0) {
    return NextResponse.json({ error: "League not found" }, { status: 404 });
  }

  const demoSwap = await getDemoSwapForRequest(req, resolvedFamilyId);

  if (allTime) {
    const headerLeagueId = seasons[0].leagueId;
    const seasonByLeague = new Map(seasons.map((s) => [s.leagueId, s.season]));

    const [standings, allUsers, headerLeagues] = await Promise.all([
      getAllTimeStandings(seasons),
      db
        .select({
          leagueId: schema.leagueUsers.leagueId,
          userId: schema.leagueUsers.userId,
          displayName: schema.leagueUsers.displayName,
          teamName: schema.leagueUsers.teamName,
          avatar: schema.leagueUsers.avatar,
        })
        .from(schema.leagueUsers)
        .where(
          inArray(
            schema.leagueUsers.leagueId,
            seasons.map((s) => s.leagueId),
          ),
        ),
      db
        .select()
        .from(schema.leagues)
        .where(eq(schema.leagues.id, headerLeagueId))
        .limit(1),
    ]);

    // Most recent season's record wins so each ownerId reflects their current
    // identity in the family.
    const userByOwner = new Map<
      string,
      {
        userId: string;
        displayName: string | null;
        teamName: string | null;
        avatar: string | null;
      }
    >();
    const seasonByOwner = new Map<string, number>();
    for (const u of allUsers) {
      const seasonNum = Number(seasonByLeague.get(u.leagueId) ?? 0);
      if ((seasonByOwner.get(u.userId) ?? -1) < seasonNum) {
        seasonByOwner.set(u.userId, seasonNum);
        userByOwner.set(u.userId, {
          userId: u.userId,
          displayName: u.displayName,
          teamName: u.teamName,
          avatar: u.avatar,
        });
      }
    }

    const renderedUsers = Array.from(userByOwner.values());
    const headerLeague = headerLeagues[0];

    return NextResponse.json({
      league: {
        id: headerLeague?.id ?? headerLeagueId,
        name: demoSwap ? DEMO_LEAGUE_NAME : (headerLeague?.name ?? "League"),
        season: "All-time",
        totalRosters: headerLeague?.totalRosters ?? null,
        status: headerLeague?.status ?? null,
      },
      familyId: resolvedFamilyId,
      seasons,
      rosters: standings,
      users: demoSwap
        ? renderedUsers.map((u) => swapLeagueUser(u, demoSwap))
        : renderedUsers,
    });
  }

  // Default to the most recent season rather than rootLeagueId, which can be
  // stale after a season rollover.
  const currentLeagueId =
    (seasonParam &&
      seasons.find((s) => s.season === seasonParam)?.leagueId) ||
    members.find((m) => m.leagueId === familyId)?.leagueId ||
    seasons[0]?.leagueId;

  if (!currentLeagueId) {
    return NextResponse.json({ error: "League not found" }, { status: 404 });
  }

  const [leagues, rosters, users] = await Promise.all([
    db
      .select()
      .from(schema.leagues)
      .where(eq(schema.leagues.id, currentLeagueId))
      .limit(1),
    db
      .select()
      .from(schema.rosters)
      .where(eq(schema.rosters.leagueId, currentLeagueId)),
    db
      .select({
        userId: schema.leagueUsers.userId,
        displayName: schema.leagueUsers.displayName,
        teamName: schema.leagueUsers.teamName,
        avatar: schema.leagueUsers.avatar,
      })
      .from(schema.leagueUsers)
      .where(eq(schema.leagueUsers.leagueId, currentLeagueId)),
  ]);

  if (leagues.length === 0) {
    return NextResponse.json({ error: "League not found" }, { status: 404 });
  }

  const league = leagues[0];
  const settings = league.settings as Record<string, unknown> | null;
  const numPlayoffTeams = (settings?.playoff_teams as number) ?? 6;
  const champRosterId = getChampionRosterFromBracket(
    league.winnersBracket as SleeperBracketMatchup[] | null,
    numPlayoffTeams,
  );

  return NextResponse.json({
    league: {
      id: league.id,
      name: demoSwap ? DEMO_LEAGUE_NAME : league.name,
      season: league.season,
      totalRosters: league.totalRosters,
      status: league.status,
    },
    familyId: resolvedFamilyId,
    seasons,
    rosters: rosters
      .map((r) => ({
        rosterId: r.rosterId,
        ownerId: r.ownerId,
        wins: r.wins || 0,
        losses: r.losses || 0,
        ties: r.ties || 0,
        fpts: r.fpts || 0,
        fptsAgainst: r.fptsAgainst || 0,
        seasonsPlayed: 1,
        championshipYears:
          champRosterId === r.rosterId ? [league.season] : [],
      }))
      .sort(compareStandings),
    users: demoSwap ? users.map((u) => swapLeagueUser(u, demoSwap)) : users,
  });
}
