import { NextRequest, NextResponse } from "next/server";
import { getDb, schema } from "@/db";
import { eq, and, sql, inArray } from "drizzle-orm";
import { findOriginalSlot, calculatePickNumber } from "@/lib/draft";

export async function GET(
  req: NextRequest,
  { params }: { params: { familyId: string } }
) {
  const db = getDb();
  const familyId = params.familyId;
  const seasonParam = req.nextUrl.searchParams.get("season");
  const typeParam = req.nextUrl.searchParams.get("type"); // trade, waiver, free_agent
  const page = parseInt(req.nextUrl.searchParams.get("page") || "1", 10);
  const limit = Math.min(
    parseInt(req.nextUrl.searchParams.get("limit") || "50", 10),
    100
  );

  // Resolve family → league IDs
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

  // Get all league IDs in the family
  const members = await db
    .select()
    .from(schema.leagueFamilyMembers)
    .where(eq(schema.leagueFamilyMembers.familyId, resolvedFamilyId));

  // All league IDs in the family (needed for cross-season draft pick resolution)
  const allLeagueIds = members.map((m) => m.leagueId);

  // Filter by season if specified
  const filteredMembers = seasonParam
    ? members.filter((m) => m.season === seasonParam)
    : members;

  const leagueIds = filteredMembers.map((m) => m.leagueId);
  if (leagueIds.length === 0) {
    return NextResponse.json({ transactions: [], total: 0 });
  }

  // Build conditions
  const conditions = [inArray(schema.transactions.leagueId, leagueIds)];
  if (typeParam) {
    conditions.push(eq(schema.transactions.type, typeParam));
  }

  // Get total count
  const countResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.transactions)
    .where(and(...conditions));
  const total = Number(countResult[0]?.count || 0);

  // Get paginated transactions
  const offset = (page - 1) * limit;
  const transactions = await db
    .select()
    .from(schema.transactions)
    .where(and(...conditions))
    .orderBy(sql`${schema.transactions.createdAt} DESC`)
    .limit(limit)
    .offset(offset);

  // Collect all player IDs from adds/drops to fetch names
  const playerIds = new Set<string>();
  for (const tx of transactions) {
    const adds = (tx.adds || {}) as Record<string, number>;
    const drops = (tx.drops || {}) as Record<string, number>;
    Object.keys(adds).forEach((id) => playerIds.add(id));
    Object.keys(drops).forEach((id) => playerIds.add(id));
  }

  // Fetch player names
  const playerNames = new Map<string, string>();
  if (playerIds.size > 0) {
    const players = await db
      .select({ id: schema.players.id, name: schema.players.name })
      .from(schema.players)
      .where(inArray(schema.players.id, Array.from(playerIds)));
    for (const p of players) {
      playerNames.set(p.id, p.name);
    }
  }

  // Build league → season map
  const leagueSeasonMap = new Map(members.map((m) => [m.leagueId, m.season]));

  // Collect roster owner info for all relevant leagues (batched)
  const rosterOwnerMap = new Map<string, Map<number, string>>(); // leagueId → rosterId → displayName
  const allUsers = await db
    .select()
    .from(schema.leagueUsers)
    .where(inArray(schema.leagueUsers.leagueId, leagueIds));
  const allRosters = await db
    .select()
    .from(schema.rosters)
    .where(inArray(schema.rosters.leagueId, leagueIds));

  // Group users by league
  const usersByLeague = new Map<string, Map<string, string>>();
  for (const u of allUsers) {
    if (!usersByLeague.has(u.leagueId)) usersByLeague.set(u.leagueId, new Map());
    usersByLeague.get(u.leagueId)!.set(u.userId, u.displayName || u.userId);
  }

  // Build rosterOwnerMap from batched results
  for (const r of allRosters) {
    if (!r.ownerId) continue;
    if (!rosterOwnerMap.has(r.leagueId)) rosterOwnerMap.set(r.leagueId, new Map());
    const userMap = usersByLeague.get(r.leagueId);
    rosterOwnerMap.get(r.leagueId)!.set(r.rosterId, userMap?.get(r.ownerId) || r.ownerId);
  }

  // Fetch trade grades for trade transactions
  const tradeTransactionIds = transactions
    .filter((tx) => tx.type === "trade")
    .map((tx) => tx.id);

  const tradeGradesMap = new Map<
    string,
    Array<{
      rosterId: number;
      grade: string | null;
      blendedScore: number | null;
      productionWeight: number | null;
      productionWeeks: number | null;
      fantasyCalcValue: number | null;
    }>
  >();

  if (tradeTransactionIds.length > 0) {
    const grades = await db
      .select({
        transactionId: schema.tradeGrades.transactionId,
        rosterId: schema.tradeGrades.rosterId,
        grade: schema.tradeGrades.grade,
        blendedScore: schema.tradeGrades.blendedScore,
        productionWeight: schema.tradeGrades.productionWeight,
        productionWeeks: schema.tradeGrades.productionWeeks,
        fantasyCalcValue: schema.tradeGrades.fantasyCalcValue,
      })
      .from(schema.tradeGrades)
      .where(inArray(schema.tradeGrades.transactionId, tradeTransactionIds));

    for (const g of grades) {
      const existing = tradeGradesMap.get(g.transactionId) || [];
      existing.push({
        rosterId: g.rosterId,
        grade: g.grade,
        blendedScore: g.blendedScore,
        productionWeight: g.productionWeight,
        productionWeeks: g.productionWeeks,
        fantasyCalcValue: g.fantasyCalcValue,
      });
      tradeGradesMap.set(g.transactionId, existing);
    }
  }

  // Resolve draft picks to the players who were actually drafted
  // Collect all unique (season, roster_id, round) tuples from trade draft picks
  const pickTuples: Array<{ season: string; round: number; roster_id: number }> = [];
  const tradeTxs = transactions.filter((tx) => tx.type === "trade");
  const pickSeasons = new Set<string>();

  for (const tx of tradeTxs) {
    const dps = (tx.draftPicks || []) as Array<{
      season: string;
      round: number;
      roster_id: number;
      previous_owner_id: number;
      owner_id: number;
    }>;
    for (const dp of dps) {
      pickTuples.push({ season: dp.season, round: dp.round, roster_id: dp.roster_id });
      pickSeasons.add(dp.season);
    }
  }

  // Build a map: "season:round:roster_id" → { playerId, playerName }
  const resolvedPickMap = new Map<string, { playerId: string; playerName: string }>();
  // season → draft (hoisted for use in response formatting)
  type DraftInfo = { id: string; leagueId: string; season: string; type: string | null; status: string | null; slotToRosterId: unknown };
  const seasonToDraft = new Map<string, DraftInfo>();

  if (pickSeasons.size > 0) {
    // Get drafts for these seasons in these leagues
    const relevantDrafts = await db
      .select({
        id: schema.drafts.id,
        leagueId: schema.drafts.leagueId,
        season: schema.drafts.season,
        type: schema.drafts.type,
        status: schema.drafts.status,
        slotToRosterId: schema.drafts.slotToRosterId,
      })
      .from(schema.drafts)
      .where(
        and(
          inArray(schema.drafts.leagueId, allLeagueIds),
          inArray(schema.drafts.season, Array.from(pickSeasons))
        )
      );

    // Only use completed drafts
    const completeDrafts = relevantDrafts.filter((d) => d.status === "complete" && d.slotToRosterId);
    // Build season → draft info (key by the draft's own season field)
    for (const d of completeDrafts) {
      seasonToDraft.set(d.season, d);
    }

    if (completeDrafts.length > 0) {
      // Get all draft picks for these drafts
      const draftIds = completeDrafts.map((d) => d.id);
      const allDraftPicks = await db
        .select({
          draftId: schema.draftPicks.draftId,
          pickNo: schema.draftPicks.pickNo,
          playerId: schema.draftPicks.playerId,
        })
        .from(schema.draftPicks)
        .where(inArray(schema.draftPicks.draftId, draftIds));

      // draftId → pickNo → playerId
      const draftPicksMap = new Map<string, Map<number, string>>();
      for (const dp of allDraftPicks) {
        if (!dp.playerId) continue;
        if (!draftPicksMap.has(dp.draftId)) draftPicksMap.set(dp.draftId, new Map());
        draftPicksMap.get(dp.draftId)!.set(dp.pickNo, dp.playerId);
      }

      // Collect resolved player IDs to fetch names
      const resolvedPlayerIds = new Set<string>();

      for (const tuple of pickTuples) {
        const draft = seasonToDraft.get(tuple.season);
        if (!draft || !draft.slotToRosterId) continue;

        const slotMap = draft.slotToRosterId as Record<string, number>;
        const teams = Object.keys(slotMap).length;
        const isSnake = draft.type === "snake";

        const originalSlot = findOriginalSlot(slotMap, tuple.roster_id);
        if (originalSlot === null) continue;

        const pickNo = calculatePickNumber(tuple.round, originalSlot, teams, isSnake);

        const picksForDraft = draftPicksMap.get(draft.id);
        const resolvedPlayerId = picksForDraft?.get(pickNo);
        if (resolvedPlayerId) {
          resolvedPlayerIds.add(resolvedPlayerId);
          const key = `${tuple.season}:${tuple.round}:${tuple.roster_id}`;
          resolvedPickMap.set(key, { playerId: resolvedPlayerId, playerName: resolvedPlayerId });
        }
      }

      // Fetch player names for resolved picks
      if (resolvedPlayerIds.size > 0) {
        const resolvedPlayers = await db
          .select({ id: schema.players.id, name: schema.players.name })
          .from(schema.players)
          .where(inArray(schema.players.id, Array.from(resolvedPlayerIds)));
        const nameMap = new Map(resolvedPlayers.map((p) => [p.id, p.name]));
        for (const [key, val] of resolvedPickMap) {
          const name = nameMap.get(val.playerId);
          if (name) val.playerName = name;
        }
      }
    }
  }

  // Format response
  const formattedTxs = transactions.map((tx) => {
    const adds = (tx.adds || {}) as Record<string, number>;
    const drops = (tx.drops || {}) as Record<string, number>;
    const draftPicks = (tx.draftPicks || []) as Array<{
      season: string;
      round: number;
      roster_id: number;
      previous_owner_id: number;
      owner_id: number;
    }>;
    const rosterIds = (tx.rosterIds || []) as number[];
    const rosterMap = rosterOwnerMap.get(tx.leagueId) || new Map();

    return {
      id: tx.id,
      type: tx.type,
      week: tx.week,
      season: leagueSeasonMap.get(tx.leagueId) || "",
      createdAt: tx.createdAt,
      managers: rosterIds.map((rid) => ({
        rosterId: rid,
        name: rosterMap.get(rid) || `Roster ${rid}`,
      })),
      adds: Object.entries(adds).map(([playerId, rosterId]) => ({
        playerId,
        playerName: playerNames.get(playerId) || playerId,
        rosterId,
        managerName: rosterMap.get(rosterId) || `Roster ${rosterId}`,
      })),
      drops: Object.entries(drops).map(([playerId, rosterId]) => ({
        playerId,
        playerName: playerNames.get(playerId) || playerId,
        rosterId,
        managerName: rosterMap.get(rosterId) || `Roster ${rosterId}`,
      })),
      draftPicks: draftPicks.map((dp) => {
        const pickKey = `${dp.season}:${dp.round}:${dp.roster_id}`;
        const resolved = resolvedPickMap.get(pickKey);
        // Look up original owner name from the draft's league roster map
        const draft = seasonToDraft.get(dp.season);
        const draftLeagueRosterMap = draft ? rosterOwnerMap.get(draft.leagueId) : undefined;
        const originalOwnerName = draftLeagueRosterMap?.get(dp.roster_id) || null;
        return {
          season: dp.season,
          round: dp.round,
          originalRosterId: dp.roster_id,
          originalOwnerName,
          fromRosterId: dp.previous_owner_id,
          toRosterId: dp.owner_id,
          from: rosterMap.get(dp.previous_owner_id) || `Roster ${dp.previous_owner_id}`,
          to: rosterMap.get(dp.owner_id) || `Roster ${dp.owner_id}`,
          ...(resolved ? { resolvedPlayerId: resolved.playerId, resolvedPlayerName: resolved.playerName } : {}),
        };
      }),
      settings: tx.settings,
      ...(tx.type === "trade" && tradeGradesMap.has(tx.id)
        ? { grades: tradeGradesMap.get(tx.id) }
        : {}),
    };
  });

  return NextResponse.json({
    transactions: formattedTxs,
    total,
    page,
    limit,
    seasons: members
      .map((m) => m.season)
      .filter((v, i, a) => a.indexOf(v) === i)
      .sort((a, b) => Number(b) - Number(a)),
  });
}
