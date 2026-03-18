import { NextRequest, NextResponse } from "next/server";
import { getDb, schema } from "@/db";
import { eq, and, sql, inArray } from "drizzle-orm";
import { enrichTransactions, buildRosterOwnerMap } from "@/lib/transactionEnrichment";

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

  // Build shared maps
  const leagueSeasonMap = new Map(members.map((m) => [m.leagueId, m.season]));
  const rosterOwnerMap = await buildRosterOwnerMap(allLeagueIds);

  // Enrich transactions using shared logic
  const formattedTxs = await enrichTransactions(
    transactions,
    allLeagueIds,
    leagueSeasonMap,
    rosterOwnerMap,
  );

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
