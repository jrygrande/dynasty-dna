import { NextRequest, NextResponse } from "next/server";
import { getDb, schema } from "@/db";
import { eq, inArray } from "drizzle-orm";
import { scoreToGrade } from "@/services/gradingCore";

export async function GET(
  req: NextRequest,
  { params }: { params: { familyId: string } }
) {
  const db = getDb();
  const familyId = params.familyId;
  const seasonParam = req.nextUrl.searchParams.get("season");

  // Resolve family
  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      familyId
    );

  let resolvedFamilyId: string | null = null;

  if (isUuid) {
    const family = await db
      .select()
      .from(schema.leagueFamilies)
      .where(eq(schema.leagueFamilies.id, familyId))
      .limit(1);
    if (family.length > 0) resolvedFamilyId = family[0].id;
  }

  if (!resolvedFamilyId) {
    const family = await db
      .select()
      .from(schema.leagueFamilies)
      .where(eq(schema.leagueFamilies.rootLeagueId, familyId))
      .limit(1);
    if (family.length > 0) resolvedFamilyId = family[0].id;
  }

  if (!resolvedFamilyId) {
    return NextResponse.json(
      { error: "League family not found" },
      { status: 404 }
    );
  }

  // Get all league IDs
  const members = await db
    .select()
    .from(schema.leagueFamilyMembers)
    .where(eq(schema.leagueFamilyMembers.familyId, resolvedFamilyId));

  const filteredMembers = seasonParam
    ? members.filter((m) => m.season === seasonParam)
    : members;

  const leagueIds = filteredMembers.map((m) => m.leagueId);
  if (leagueIds.length === 0) {
    return NextResponse.json({ drafts: [], seasons: [] });
  }

  // Get drafts
  const drafts = await db
    .select()
    .from(schema.drafts)
    .where(inArray(schema.drafts.leagueId, leagueIds));

  // Build result per draft
  const result = [];

  for (const draft of drafts) {
    if (draft.status !== "complete") continue;

    const picks = await db
      .select()
      .from(schema.draftPicks)
      .where(eq(schema.draftPicks.draftId, draft.id));

    // Load draft grades for this draft
    const grades = await db
      .select()
      .from(schema.draftGrades)
      .where(eq(schema.draftGrades.draftId, draft.id));

    const gradeByPick = new Map(
      grades.map((g) => [g.pickNo, g]),
    );

    // Get player names
    const playerIds = picks
      .map((p) => p.playerId)
      .filter((id): id is string => id !== null);

    const playerNames = new Map<string, { name: string; position: string | null }>();
    if (playerIds.length > 0) {
      const players = await db
        .select({
          id: schema.players.id,
          name: schema.players.name,
          position: schema.players.position,
        })
        .from(schema.players)
        .where(inArray(schema.players.id, playerIds));
      for (const p of players) {
        playerNames.set(p.id, { name: p.name, position: p.position });
      }
    }

    // Get roster owners for this league
    const rosters = await db
      .select()
      .from(schema.rosters)
      .where(eq(schema.rosters.leagueId, draft.leagueId));
    const users = await db
      .select()
      .from(schema.leagueUsers)
      .where(eq(schema.leagueUsers.leagueId, draft.leagueId));

    const userMap = new Map(users.map((u) => [u.userId, u.displayName]));
    const rosterOwnerMap = new Map<number, string>();
    for (const r of rosters) {
      if (r.ownerId) {
        rosterOwnerMap.set(r.rosterId, userMap.get(r.ownerId) || r.ownerId);
      }
    }

    // Format picks
    const formattedPicks = picks
      .sort((a, b) => a.pickNo - b.pickNo)
      .map((pick) => {
        const player = pick.playerId
          ? playerNames.get(pick.playerId)
          : null;
        const grade = gradeByPick.get(pick.pickNo);
        return {
          pickNo: pick.pickNo,
          round: pick.round,
          rosterId: pick.rosterId,
          managerName:
            rosterOwnerMap.get(pick.rosterId) || `Roster ${pick.rosterId}`,
          playerId: pick.playerId,
          playerName: player?.name || pick.playerId || "Unknown",
          position: player?.position || null,
          isKeeper: pick.isKeeper,
          grade: grade
            ? {
                grade: grade.grade,
                blendedScore: grade.blendedScore,
                valueScore: grade.valueScore,
                productionScore: grade.productionScore,
              }
            : null,
        };
      });

    // Compute per-manager draft grade summaries
    const managerGrades = new Map<
      number,
      { totalScore: number; count: number }
    >();
    for (const pick of formattedPicks) {
      if (!pick.grade) continue;
      const agg = managerGrades.get(pick.rosterId) ?? {
        totalScore: 0,
        count: 0,
      };
      agg.totalScore += pick.grade.blendedScore ?? 0;
      agg.count++;
      managerGrades.set(pick.rosterId, agg);
    }

    const managerGradeSummaries = Array.from(managerGrades.entries())
      .map(([rosterId, agg]) => {
        const avgScore = agg.count > 0 ? agg.totalScore / agg.count : 0;
        return {
          rosterId,
          managerName:
            rosterOwnerMap.get(rosterId) || `Roster ${rosterId}`,
          avgScore: Math.round(avgScore * 10) / 10,
          grade: scoreToGrade(avgScore),
          picksGraded: agg.count,
        };
      })
      .sort((a, b) => b.avgScore - a.avgScore);

    const maxRound = Math.max(...picks.map((p) => p.round), 0);

    result.push({
      id: draft.id,
      season: draft.season,
      type: draft.type,
      rounds: maxRound,
      picks: formattedPicks,
      rosterNames: Object.fromEntries(rosterOwnerMap),
      managerGrades: managerGradeSummaries,
    });
  }

  // Sort drafts by season (newest first)
  result.sort((a, b) => Number(b.season) - Number(a.season));

  return NextResponse.json({
    drafts: result,
    seasons: [...new Set(members.map((m) => m.season))]
      .sort((a, b) => Number(b) - Number(a)),
  });
}
