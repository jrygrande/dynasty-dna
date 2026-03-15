import { NextRequest, NextResponse } from "next/server";
import { getDb, schema } from "@/db";
import { eq, and, sql, inArray } from "drizzle-orm";

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

  // Collect roster owner info for all relevant leagues
  const rosterOwnerMap = new Map<string, Map<number, string>>(); // leagueId → rosterId → displayName
  for (const leagueId of leagueIds) {
    const users = await db
      .select()
      .from(schema.leagueUsers)
      .where(eq(schema.leagueUsers.leagueId, leagueId));
    const rosters = await db
      .select()
      .from(schema.rosters)
      .where(eq(schema.rosters.leagueId, leagueId));

    const userMap = new Map(users.map((u) => [u.userId, u.displayName]));
    const rosterMap = new Map<number, string>();
    for (const r of rosters) {
      if (r.ownerId) {
        rosterMap.set(r.rosterId, userMap.get(r.ownerId) || r.ownerId);
      }
    }
    rosterOwnerMap.set(leagueId, rosterMap);
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
      draftPicks: draftPicks.map((dp) => ({
        season: dp.season,
        round: dp.round,
        originalRosterId: dp.roster_id,
        from: rosterMap.get(dp.previous_owner_id) || `Roster ${dp.previous_owner_id}`,
        to: rosterMap.get(dp.owner_id) || `Roster ${dp.owner_id}`,
      })),
      settings: tx.settings,
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
