import { NextRequest, NextResponse } from "next/server";
import { getDb, schema } from "@/db";
import { eq } from "drizzle-orm";
import { resolveFamily } from "@/lib/familyResolution";
import { gradeLeagueLineups } from "@/services/lineupGrading";

export async function GET(
  req: NextRequest,
  { params }: { params: { familyId: string } },
) {
  const db = getDb();
  const familyId = params.familyId;
  const seasonParam = req.nextUrl.searchParams.get("season");

  // Resolve family
  const resolvedFamilyId = await resolveFamily(familyId);
  if (!resolvedFamilyId) {
    return NextResponse.json(
      { error: "League family not found" },
      { status: 404 },
    );
  }

  // Get all leagues in family
  const members = await db
    .select()
    .from(schema.leagueFamilyMembers)
    .where(eq(schema.leagueFamilyMembers.familyId, resolvedFamilyId));

  if (members.length === 0) {
    return NextResponse.json(
      { error: "No leagues in family" },
      { status: 404 },
    );
  }

  // Pick the target season (requested or latest)
  const sortedMembers = [...members].sort(
    (a, b) => Number(b.season) - Number(a.season),
  );
  const targetMember = seasonParam
    ? sortedMembers.find((m) => m.season === seasonParam) || sortedMembers[0]
    : sortedMembers[0];

  const leagueId = targetMember.leagueId;

  // Load league info
  const [league] = await db
    .select({
      id: schema.leagues.id,
      name: schema.leagues.name,
      season: schema.leagues.season,
    })
    .from(schema.leagues)
    .where(eq(schema.leagues.id, leagueId))
    .limit(1);

  if (!league) {
    return NextResponse.json({ error: "League not found" }, { status: 404 });
  }

  // Run grading
  const rosterGrades = await gradeLeagueLineups(leagueId);

  // Enrich with display names
  const leagueUsers = await db
    .select({
      userId: schema.leagueUsers.userId,
      displayName: schema.leagueUsers.displayName,
      teamName: schema.leagueUsers.teamName,
    })
    .from(schema.leagueUsers)
    .where(eq(schema.leagueUsers.leagueId, leagueId));

  const userMap = new Map(
    leagueUsers.map((u) => [u.userId, u]),
  );

  const rosters = rosterGrades.map((r) => {
    const user = userMap.get(r.ownerId);
    return {
      ...r,
      displayName:
        user?.teamName || user?.displayName || r.ownerId || "Unknown",
    };
  });

  return NextResponse.json({
    leagueId: league.id,
    season: league.season,
    rosters,
  });
}
