import { NextRequest, NextResponse } from "next/server";
import { getDb, schema } from "@/db";
import { eq, and, inArray, sql } from "drizzle-orm";

export async function GET(
  req: NextRequest,
  { params }: { params: { familyId: string } }
) {
  const db = getDb();
  const familyId = params.familyId;
  const playerId = req.nextUrl.searchParams.get("playerId");
  const pickSeason = req.nextUrl.searchParams.get("pickSeason");
  const pickRound = req.nextUrl.searchParams.get("pickRound");
  const pickOriginalRosterId = req.nextUrl.searchParams.get("pickOriginalRosterId");

  if (!playerId && !(pickSeason && pickRound && pickOriginalRosterId)) {
    return NextResponse.json(
      { error: "Provide playerId or pickSeason+pickRound+pickOriginalRosterId" },
      { status: 400 }
    );
  }

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
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Get all league IDs
  const members = await db
    .select()
    .from(schema.leagueFamilyMembers)
    .where(eq(schema.leagueFamilyMembers.familyId, resolvedFamilyId));
  const leagueIds = members.map((m) => m.leagueId);

  if (leagueIds.length === 0) {
    return NextResponse.json({ events: [], asset: null });
  }

  // Build query conditions
  const conditions = [inArray(schema.assetEvents.leagueId, leagueIds)];

  if (playerId) {
    conditions.push(eq(schema.assetEvents.playerId, playerId));
  } else {
    conditions.push(eq(schema.assetEvents.pickSeason, pickSeason!));
    conditions.push(eq(schema.assetEvents.pickRound, parseInt(pickRound!, 10)));
    conditions.push(
      eq(
        schema.assetEvents.pickOriginalRosterId,
        parseInt(pickOriginalRosterId!, 10)
      )
    );
  }

  const events = await db
    .select()
    .from(schema.assetEvents)
    .where(and(...conditions))
    .orderBy(
      sql`${schema.assetEvents.season} ASC`,
      sql`${schema.assetEvents.week} ASC`,
      sql`${schema.assetEvents.createdAt} ASC`
    );

  // Get roster owner names across all leagues
  const rosterOwnerMaps = new Map<string, Map<number, string>>();
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
      if (r.ownerId) rosterMap.set(r.rosterId, userMap.get(r.ownerId) || r.ownerId);
    }
    rosterOwnerMaps.set(leagueId, rosterMap);
  }

  // Get player info if querying by player
  let asset = null;
  if (playerId) {
    const players = await db
      .select()
      .from(schema.players)
      .where(eq(schema.players.id, playerId))
      .limit(1);
    if (players.length > 0) {
      const p = players[0];
      asset = {
        kind: "player" as const,
        playerId: p.id,
        name: p.name,
        position: p.position,
        team: p.team,
      };
    }
  } else {
    asset = {
      kind: "pick" as const,
      pickSeason,
      pickRound: parseInt(pickRound!, 10),
      pickOriginalRosterId: parseInt(pickOriginalRosterId!, 10),
    };
  }

  // Format events
  const formattedEvents = events.map((e) => {
    const rosterMap = rosterOwnerMaps.get(e.leagueId) || new Map();
    return {
      id: e.id,
      season: e.season,
      week: e.week,
      eventType: e.eventType,
      assetKind: e.assetKind,
      playerId: e.playerId,
      pickSeason: e.pickSeason,
      pickRound: e.pickRound,
      fromManager: e.fromRosterId
        ? rosterMap.get(e.fromRosterId) || `Roster ${e.fromRosterId}`
        : null,
      toManager: e.toRosterId
        ? rosterMap.get(e.toRosterId) || `Roster ${e.toRosterId}`
        : null,
      createdAt: e.createdAt,
      details: e.details,
    };
  });

  return NextResponse.json({ events: formattedEvents, asset });
}
