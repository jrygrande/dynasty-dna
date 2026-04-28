import { NextRequest, NextResponse } from "next/server";
import { getDb, schema } from "@/db";
import { eq, inArray } from "drizzle-orm";
import { scoreToGrade } from "@/services/gradingCore";
import { resolveFamily } from "@/lib/familyResolution";

export async function GET(
  req: NextRequest,
  { params }: { params: { familyId: string } }
) {
  try {
  const db = getDb();
  const familyId = params.familyId;
  const seasonParam = req.nextUrl.searchParams.get("season");

  const resolvedFamilyId = await resolveFamily(familyId);
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

  const completeDrafts = drafts.filter((d) => d.status === "complete");
  if (completeDrafts.length === 0) {
    return NextResponse.json({
      drafts: [],
      seasons: [...new Set(members.map((m) => m.season))]
        .sort((a, b) => Number(b) - Number(a)),
    });
  }

  const draftIds = completeDrafts.map((d) => d.id);

  // Batch all queries upfront to avoid N+1
  const [allPicks, allGrades, allRosters, allUsers] = await Promise.all([
    db
      .select()
      .from(schema.draftPicks)
      .where(inArray(schema.draftPicks.draftId, draftIds)),
    db
      .select()
      .from(schema.draftGrades)
      .where(inArray(schema.draftGrades.draftId, draftIds)),
    db
      .select()
      .from(schema.rosters)
      .where(inArray(schema.rosters.leagueId, leagueIds)),
    db
      .select()
      .from(schema.leagueUsers)
      .where(inArray(schema.leagueUsers.leagueId, leagueIds)),
  ]);

  // Collect all player IDs across all picks
  const allPlayerIds = [
    ...new Set(
      allPicks
        .map((p) => p.playerId)
        .filter((id): id is string => id !== null)
    ),
  ];

  const playerNames = new Map<string, { name: string; position: string | null }>();
  if (allPlayerIds.length > 0) {
    const players = await db
      .select({
        id: schema.players.id,
        name: schema.players.name,
        position: schema.players.position,
      })
      .from(schema.players)
      .where(inArray(schema.players.id, allPlayerIds));
    for (const p of players) {
      playerNames.set(p.id, { name: p.name, position: p.position });
    }
  }

  // Group picks and grades by draftId
  const picksByDraft = new Map<string, typeof allPicks>();
  for (const pick of allPicks) {
    const arr = picksByDraft.get(pick.draftId) || [];
    arr.push(pick);
    picksByDraft.set(pick.draftId, arr);
  }

  const gradesByDraft = new Map<string, Map<number, (typeof allGrades)[0]>>();
  for (const g of allGrades) {
    let map = gradesByDraft.get(g.draftId);
    if (!map) {
      map = new Map();
      gradesByDraft.set(g.draftId, map);
    }
    map.set(g.pickNo, g);
  }

  // Build roster owner maps by leagueId
  const usersByLeague = new Map<string, Map<string, string | null>>();
  for (const u of allUsers) {
    let map = usersByLeague.get(u.leagueId);
    if (!map) {
      map = new Map();
      usersByLeague.set(u.leagueId, map);
    }
    map.set(u.userId, u.displayName);
  }

  const rosterOwnerByLeague = new Map<string, Map<number, string>>();
  for (const r of allRosters) {
    let map = rosterOwnerByLeague.get(r.leagueId);
    if (!map) {
      map = new Map();
      rosterOwnerByLeague.set(r.leagueId, map);
    }
    if (r.ownerId) {
      const userMap = usersByLeague.get(r.leagueId);
      map.set(r.rosterId, userMap?.get(r.ownerId) || r.ownerId);
    }
  }

  // Build result per draft
  const result = [];

  for (const draft of completeDrafts) {
    const picks = picksByDraft.get(draft.id) || [];
    const gradeByPick = gradesByDraft.get(draft.id) || new Map();
    const rosterOwnerMap = rosterOwnerByLeague.get(draft.leagueId) || new Map();

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
  } catch (err) {
    console.error("[drafts API] Error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
