/**
 * GET /api/leagues/:familyId/graph
 *
 * Returns the asset movement graph (nodes + edges) for a league family.
 *
 * PUBLIC-BY-DESIGN: no session check. Matches the other /api/leagues/:familyId/*
 * routes. Enables shareable deep-link previews which is central to the
 * `share rate` success metric for the ASSET_GRAPH_BROWSER experiment.
 *
 * IDENTITY INVARIANTS:
 *   - Transaction nodes are keyed by transactionId (or event.id for draft
 *     selections which have no transactionId).
 *   - Pick tenure spans are keyed by (leagueId, pickSeason, pickRound,
 *     pickOriginalRosterId).
 */

import { NextRequest, NextResponse } from "next/server";
import { getDb, schema } from "@/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { buildRosterOwnerMap, enrichTransactions } from "@/lib/transactionEnrichment";
import type { EnrichedTransaction } from "@/lib/transactionEnrichment";
import { resolveFamily } from "@/lib/familyResolution";
import {
  buildGraphFromEvents,
  pickKey,
  type BuildGraphInput,
  type GraphResponse,
} from "@/lib/assetGraph";

const ALLOWED_EVENT_TYPES: ReadonlyArray<string> = [
  "trade",
  "pick_trade",
  "draft_selected",
  "waiver_add",
  "waiver_drop",
  "free_agent_add",
  "free_agent_drop",
];

export async function GET(
  _req: NextRequest,
  { params }: { params: { familyId: string } },
) {
  const db = getDb();
  const familyId = params.familyId;

  const resolvedFamilyId = await resolveFamily(familyId);
  if (!resolvedFamilyId) {
    return NextResponse.json({ error: "League family not found" }, { status: 404 });
  }

  const members = await db
    .select()
    .from(schema.leagueFamilyMembers)
    .where(eq(schema.leagueFamilyMembers.familyId, resolvedFamilyId));
  const allLeagueIds = members.map((m) => m.leagueId);
  const leagueSeasonMap = new Map<string, string>(
    members.map((m) => [m.leagueId, m.season] as const),
  );

  if (allLeagueIds.length === 0) {
    const empty: GraphResponse = {
      nodes: [],
      edges: [],
      stats: {
        totalTransactions: 0,
        totalTenures: 0,
        openTenures: 0,
        playersInvolved: 0,
        picksInvolved: 0,
      },
      seasons: [],
      managers: [],
      transactions: {},
      computedAt: Date.now(),
    };
    return NextResponse.json(empty);
  }

  const rosterOwnerMap = await buildRosterOwnerMap(allLeagueIds);

  const [allLeagueUsers, allRosters] = await Promise.all([
    db
      .select()
      .from(schema.leagueUsers)
      .where(inArray(schema.leagueUsers.leagueId, allLeagueIds)),
    db
      .select()
      .from(schema.rosters)
      .where(inArray(schema.rosters.leagueId, allLeagueIds)),
  ]);

  // userId -> {displayName, avatar, seasons[]}
  const managerMeta = new Map<
    string,
    { displayName: string; avatar: string | null; seasons: Set<string> }
  >();
  for (const lu of allLeagueUsers) {
    const season = leagueSeasonMap.get(lu.leagueId);
    const existing = managerMeta.get(lu.userId);
    if (existing) {
      if (lu.displayName && !existing.displayName) existing.displayName = lu.displayName;
      if (lu.avatar && !existing.avatar) existing.avatar = lu.avatar;
      if (season) existing.seasons.add(season);
    } else {
      managerMeta.set(lu.userId, {
        displayName: lu.displayName || lu.userId,
        avatar: lu.avatar ?? null,
        seasons: new Set(season ? [season] : []),
      });
    }
  }

  // rosterToUser: "{leagueId}:{rosterId}" -> userId
  const rosterToUser = new Map<string, string>();
  for (const r of allRosters) {
    if (!r.ownerId) continue;
    rosterToUser.set(`${r.leagueId}:${r.rosterId}`, r.ownerId);
  }

  // Current-season rosters: userId -> Set<playerId> currently rostered.
  const mostRecentSeason = Array.from(new Set(members.map((m) => m.season))).sort().pop();
  const currentLeagueIds = mostRecentSeason
    ? members.filter((m) => m.season === mostRecentSeason).map((m) => m.leagueId)
    : [];
  const currentRosters = new Map<string, Set<string>>();
  for (const r of allRosters) {
    if (!r.ownerId) continue;
    if (!currentLeagueIds.includes(r.leagueId)) continue;
    const playerArr = Array.isArray(r.players) ? (r.players as string[]) : [];
    const existing = currentRosters.get(r.ownerId) ?? new Set<string>();
    for (const pid of playerArr) existing.add(pid);
    currentRosters.set(r.ownerId, existing);
  }

  // Query asset events for all leagues.
  const events = await db
    .select()
    .from(schema.assetEvents)
    .where(
      and(
        inArray(schema.assetEvents.leagueId, allLeagueIds),
        inArray(schema.assetEvents.eventType, ALLOWED_EVENT_TYPES as string[]),
      ),
    )
    .orderBy(
      sql`${schema.assetEvents.season} ASC`,
      sql`${schema.assetEvents.week} ASC`,
      sql`${schema.assetEvents.createdAt} ASC`,
    );

  // Fetch referenced transactions for enrichment (drawer rendering).
  const transactionIds = Array.from(
    new Set(events.filter((e) => e.transactionId).map((e) => e.transactionId!)),
  );
  let rawTransactions: (typeof schema.transactions.$inferSelect)[] = [];
  if (transactionIds.length > 0) {
    rawTransactions = await db
      .select()
      .from(schema.transactions)
      .where(inArray(schema.transactions.id, transactionIds));
  }
  const enrichedList = await enrichTransactions(
    rawTransactions,
    allLeagueIds,
    leagueSeasonMap,
    rosterOwnerMap,
  );
  const enrichedByTxId: Record<string, EnrichedTransaction> = {};
  for (const tx of enrichedList) {
    enrichedByTxId[tx.id] = tx;
  }

  // Resolve player metadata for all playerIds touched by events or transactions.
  const allPlayerIds = new Set<string>();
  for (const ev of events) {
    if (ev.playerId) allPlayerIds.add(ev.playerId);
  }
  for (const tx of enrichedList) {
    for (const a of tx.adds) allPlayerIds.add(a.playerId);
    for (const d of tx.drops) allPlayerIds.add(d.playerId);
    for (const dp of tx.draftPicks) {
      if (dp.resolvedPlayerId) allPlayerIds.add(dp.resolvedPlayerId);
    }
  }

  const playerRows =
    allPlayerIds.size > 0
      ? await db
          .select({
            id: schema.players.id,
            name: schema.players.name,
            position: schema.players.position,
            team: schema.players.team,
          })
          .from(schema.players)
          .where(inArray(schema.players.id, Array.from(allPlayerIds)))
      : [];

  const playersMap: BuildGraphInput["players"] = new Map(
    playerRows.map((p) => [
      p.id,
      { name: p.name, position: p.position, team: p.team },
    ]),
  );

  const managersMap: BuildGraphInput["managers"] = new Map();
  for (const [userId, meta] of managerMeta) {
    managersMap.set(userId, {
      displayName: meta.displayName,
      avatar: meta.avatar,
      seasons: Array.from(meta.seasons).sort(),
    });
  }

  // Current pick owners: walk pick_trade events chronologically per pick key,
  // track the latest to-user. Picks resolved via draft_selected are dropped.
  const latestPickOwner = new Map<string, string>();
  const resolvedPicks = new Set<string>();
  for (const ev of events) {
    if (
      ev.pickSeason === null ||
      ev.pickRound === null ||
      ev.pickOriginalRosterId === null
    ) {
      continue;
    }
    const key = pickKey({
      leagueId: ev.leagueId,
      pickSeason: ev.pickSeason,
      pickRound: ev.pickRound,
      pickOriginalRosterId: ev.pickOriginalRosterId,
    });
    if (ev.eventType === "draft_selected") {
      resolvedPicks.add(key);
      latestPickOwner.delete(key);
      continue;
    }
    if (ev.eventType === "pick_trade" && ev.toUserId) {
      if (!resolvedPicks.has(key)) latestPickOwner.set(key, ev.toUserId);
    }
  }
  const currentPickOwners = new Map<string, Set<string>>();
  for (const [key, owner] of latestPickOwner) {
    const existing = currentPickOwners.get(owner) ?? new Set<string>();
    existing.add(key);
    currentPickOwners.set(owner, existing);
  }

  const graph = buildGraphFromEvents({
    assetEvents: events.map((e) => ({
      id: e.id,
      leagueId: e.leagueId,
      season: e.season,
      week: e.week,
      eventType: e.eventType,
      assetKind: e.assetKind,
      playerId: e.playerId,
      pickSeason: e.pickSeason,
      pickRound: e.pickRound,
      pickOriginalRosterId: e.pickOriginalRosterId,
      fromRosterId: e.fromRosterId,
      toRosterId: e.toRosterId,
      fromUserId: e.fromUserId,
      toUserId: e.toUserId,
      transactionId: e.transactionId,
      createdAt: e.createdAt,
      details: e.details,
    })),
    enrichedTransactions: enrichedByTxId,
    players: playersMap,
    managers: managersMap,
    rosterToUser,
    currentRosters,
    currentPickOwners,
  });

  const distinctSeasons = Array.from(new Set(members.map((m) => m.season))).sort(
    (a, b) => Number(a) - Number(b),
  );

  const managersList = Array.from(managerMeta.entries())
    .map(([userId, meta]) => ({
      userId,
      displayName: meta.displayName,
      avatar: meta.avatar,
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  const response: GraphResponse = {
    nodes: graph.nodes,
    edges: graph.edges,
    stats: graph.stats,
    seasons: distinctSeasons,
    managers: managersList,
    transactions: enrichedByTxId,
    computedAt: Date.now(),
  };

  return NextResponse.json(response);
}
