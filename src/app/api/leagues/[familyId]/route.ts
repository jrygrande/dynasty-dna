import { NextRequest, NextResponse } from "next/server";
import { getDb, schema } from "@/db";
import { eq } from "drizzle-orm";
import { resolveFamily } from "@/lib/familyResolution";
import { DEMO_LEAGUE_NAME, getDemoSwapForRequest } from "@/lib/demoServer";
import { swapLeagueUser } from "@/lib/demoTransforms";

export async function GET(
  req: NextRequest,
  { params }: { params: { familyId: string } }
) {
  const db = getDb();
  const familyId = params.familyId;
  const seasonParam = req.nextUrl.searchParams.get("season");

  const resolvedFamilyId = await resolveFamily(familyId);

  if (!resolvedFamilyId) {
    // No family yet — try to return basic league data if a matching league row exists
    const leagues = await db
      .select()
      .from(schema.leagues)
      .where(eq(schema.leagues.id, familyId))
      .limit(1);

    if (leagues.length === 0) {
      return NextResponse.json({ error: "League not found" }, { status: 404 });
    }

    const league = leagues[0];
    const rosters = await db
      .select()
      .from(schema.rosters)
      .where(eq(schema.rosters.leagueId, league.id));

    const users = await db
      .select()
      .from(schema.leagueUsers)
      .where(eq(schema.leagueUsers.leagueId, league.id));

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
      rosters: rosters.map((r) => ({
        rosterId: r.rosterId,
        ownerId: r.ownerId,
        wins: r.wins || 0,
        losses: r.losses || 0,
        ties: r.ties || 0,
        fpts: r.fpts || 0,
        fptsAgainst: r.fptsAgainst || 0,
      })),
      users: users.map((u) => ({
        userId: u.userId,
        displayName: u.displayName,
        teamName: u.teamName,
        avatar: u.avatar,
      })),
    });
  }

  // Got the family — load all seasons
  const members = await db
    .select()
    .from(schema.leagueFamilyMembers)
    .where(eq(schema.leagueFamilyMembers.familyId, resolvedFamilyId));

  const seasons = members
    .map((m) => ({ leagueId: m.leagueId, season: m.season }))
    .sort((a, b) => Number(b.season) - Number(a.season));

  // Pick the season to render. Default to the most recent season rather
  // than rootLeagueId, which can be stale after a season rollover.
  const currentLeagueId =
    (seasonParam &&
      seasons.find((s) => s.season === seasonParam)?.leagueId) ||
    members.find((m) => m.leagueId === familyId)?.leagueId ||
    seasons[0]?.leagueId;

  if (!currentLeagueId) {
    return NextResponse.json({ error: "League not found" }, { status: 404 });
  }

  const leagues = await db
    .select()
    .from(schema.leagues)
    .where(eq(schema.leagues.id, currentLeagueId))
    .limit(1);

  if (leagues.length === 0) {
    return NextResponse.json({ error: "League not found" }, { status: 404 });
  }

  const league = leagues[0];
  const rosters = await db
    .select()
    .from(schema.rosters)
    .where(eq(schema.rosters.leagueId, currentLeagueId));

  const users = await db
    .select()
    .from(schema.leagueUsers)
    .where(eq(schema.leagueUsers.leagueId, currentLeagueId));

  const demoSwap = await getDemoSwapForRequest(req, resolvedFamilyId);
  const renderedUsers = users.map((u) => ({
    userId: u.userId,
    displayName: u.displayName,
    teamName: u.teamName,
    avatar: u.avatar,
  }));

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
    rosters: rosters.map((r) => ({
      rosterId: r.rosterId,
      ownerId: r.ownerId,
      wins: r.wins || 0,
      losses: r.losses || 0,
      ties: r.ties || 0,
      fpts: r.fpts || 0,
      fptsAgainst: r.fptsAgainst || 0,
    })),
    users: demoSwap
      ? renderedUsers.map((u) => swapLeagueUser(u, demoSwap))
      : renderedUsers,
  });
}
