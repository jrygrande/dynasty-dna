import { NextRequest, NextResponse } from "next/server";
import { getDb, schema } from "@/db";
import { eq } from "drizzle-orm";

export async function GET(
  _req: NextRequest,
  { params }: { params: { familyId: string } }
) {
  const db = getDb();
  const familyId = params.familyId;

  // UUID format check — only query the UUID column if it looks like a UUID
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(familyId);

  // First try to find as a family ID (only if it's a valid UUID)
  let family: (typeof schema.leagueFamilies.$inferSelect)[] = [];
  if (isUuid) {
    family = await db
      .select()
      .from(schema.leagueFamilies)
      .where(eq(schema.leagueFamilies.id, familyId))
      .limit(1);
  }

  // If not found, treat familyId as a league ID (for direct navigation)
  if (family.length === 0) {
    family = await db
      .select()
      .from(schema.leagueFamilies)
      .where(eq(schema.leagueFamilies.rootLeagueId, familyId))
      .limit(1);
  }

  if (family.length === 0) {
    // League exists but no family yet — return basic league data
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
    .where(eq(schema.leagueFamilyMembers.familyId, family[0].id));

  const seasons = members
    .map((m) => ({ leagueId: m.leagueId, season: m.season }))
    .sort((a, b) => Number(b.season) - Number(a.season));

  // Load the current (most recent) league data
  const currentLeagueId = family[0].rootLeagueId;
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

  return NextResponse.json({
    league: {
      id: league.id,
      name: league.name,
      season: league.season,
      totalRosters: league.totalRosters,
      status: league.status,
    },
    familyId: family[0].id,
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
    users: users.map((u) => ({
      userId: u.userId,
      displayName: u.displayName,
      teamName: u.teamName,
      avatar: u.avatar,
    })),
  });
}
