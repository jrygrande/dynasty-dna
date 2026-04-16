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
 *   - Manager nodes are keyed by Sleeper `userId` (stable across seasons).
 *     NEVER use `rosterId` — rosterId is league-scoped and churns across seasons.
 *   - Pick nodes are keyed by (leagueId, pickSeason, pickRound, pickOriginalRosterId).
 *     Picks are league-scoped in schema.
 */

import { NextRequest, NextResponse } from "next/server";
import { getDb, schema } from "@/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { buildRosterOwnerMap, enrichTransactions } from "@/lib/transactionEnrichment";
import type { EnrichedTransaction } from "@/lib/transactionEnrichment";
import { resolveFamily } from "@/lib/familyResolution";
import { resolveDraftPicks, findOriginalSlot, calculatePickNumber } from "@/lib/draft";
import {
  buildGraphFromEvents,
  focusSubgraph,
  pickKey,
  type BuildGraphInput,
  type GraphEdgeKind,
  type GraphFocus,
  type GraphNode,
  type GraphResponse,
  type Graph,
} from "@/lib/assetGraph";

const ALLOWED_EVENT_TYPES: ReadonlyArray<string> = [
  "trade",
  "pick_trade",
  "draft_selected",
  "waiver_add",
  "free_agent_add",
];

const VALID_EDGE_KINDS = new Set<GraphEdgeKind>([
  "trade_out",
  "trade_in",
  "pick_trade_out",
  "pick_trade_in",
  "draft_selected_mgr",
  "draft_selected_pick",
  "waiver_add",
  "free_agent_add",
]);

function parseCsvParam(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function parseEdgeKinds(value: string | null): GraphEdgeKind[] {
  return parseCsvParam(value).filter((k): k is GraphEdgeKind =>
    VALID_EDGE_KINDS.has(k as GraphEdgeKind),
  );
}

function parsePickKey(key: string):
  | { leagueId: string; pickSeason: string; pickRound: number; pickOriginalRosterId: number }
  | null {
  // Format: "{leagueId}:{season}:{round}:{origRosterId}"
  // leagueId can contain no colons (Sleeper ids are numeric), so split on last
  // 3 colons.
  const parts = key.split(":");
  if (parts.length < 4) return null;
  const pickOriginalRosterId = parseInt(parts[parts.length - 1], 10);
  const pickRound = parseInt(parts[parts.length - 2], 10);
  const pickSeason = parts[parts.length - 3];
  const leagueId = parts.slice(0, parts.length - 3).join(":");
  if (Number.isNaN(pickOriginalRosterId) || Number.isNaN(pickRound)) return null;
  return { leagueId, pickSeason, pickRound, pickOriginalRosterId };
}

type LayoutFn = (graph: Graph, mode: "band" | "dagre") => Map<string, { x: number; y: number }>;

async function tryApplyLayout(graph: Graph, mode: "band" | "dagre"): Promise<void> {
  // Graceful dynamic import — Module C may not be merged yet. We obfuscate the
  // specifier with a variable + eval-style require so webpack's static analysis
  // doesn't fail to resolve it at build time.
  try {
    // Use an indirect require through `eval` so Next/webpack doesn't try to
    // statically resolve "@/components/graph/layout" at build time when the
    // module doesn't exist yet. At runtime, Node's require handles the miss
    // by throwing — we catch + warn, same as the dynamic-import path.
    const specifier = "../../../../../components/graph/layout";
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = eval("require")(specifier) as { layout?: LayoutFn };
    if (typeof mod.layout !== "function") {
      console.warn(
        "[graph-api] components/graph/layout loaded but does not export `layout`; skipping layout",
      );
      return;
    }
    const positions = mod.layout(graph, mode);
    for (const n of graph.nodes) {
      const pos = positions.get(n.id);
      if (pos) (n as GraphNode & { layout?: { x: number; y: number } }).layout = pos;
    }
  } catch {
    // Module not available — this is expected when Module C hasn't merged yet.
    console.warn(
      "[graph-api] components/graph/layout not available; skipping server-side layout",
    );
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: { familyId: string } },
) {
  const db = getDb();
  const familyId = params.familyId;

  // ---------------------------------------------------------------
  // 1. Parse query params
  // ---------------------------------------------------------------
  const url = req.nextUrl;
  const seasonsParam = parseCsvParam(url.searchParams.get("seasons"));
  const managersParam = parseCsvParam(url.searchParams.get("managers"));
  const eventTypesParam = parseEdgeKinds(url.searchParams.get("eventTypes"));
  const focusPlayerId = url.searchParams.get("focusPlayerId") || undefined;
  const focusPickKey = url.searchParams.get("focusPickKey") || undefined;
  const focusManagerId = url.searchParams.get("focusManagerId") || undefined;
  const focusHopsRaw = url.searchParams.get("focusHops");
  const focusHops = focusHopsRaw ? Math.max(0, parseInt(focusHopsRaw, 10) || 0) : 2;
  const layoutRaw = url.searchParams.get("layout");
  const layoutMode: "band" | "dagre" = layoutRaw === "dagre" ? "dagre" : "band";

  // ---------------------------------------------------------------
  // 2. Resolve family
  // ---------------------------------------------------------------
  const resolvedFamilyId = await resolveFamily(familyId);
  if (!resolvedFamilyId) {
    return NextResponse.json({ error: "League family not found" }, { status: 404 });
  }

  // ---------------------------------------------------------------
  // 3. Family members → leagueIds + leagueSeasonMap
  // ---------------------------------------------------------------
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
        totalTrades: 0,
        totalDraftPicks: 0,
        totalEdges: 0,
        totalNodes: 0,
        multiHopChains: 0,
        picksTraded: 0,
      },
      seasons: [],
      managers: [],
      transactions: {},
      computedAt: Date.now(),
    };
    return NextResponse.json(empty);
  }

  // ---------------------------------------------------------------
  // 4. buildRosterOwnerMap (roster → name per league)
  // ---------------------------------------------------------------
  const rosterOwnerMap = await buildRosterOwnerMap(allLeagueIds);

  // ---------------------------------------------------------------
  // 5. leagueUsers → rosterToUser map + manager metadata
  // ---------------------------------------------------------------
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

  // ---------------------------------------------------------------
  // 6. Query assetEvents
  // ---------------------------------------------------------------
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

  // ---------------------------------------------------------------
  // 7. Fetch referenced transactions
  // ---------------------------------------------------------------
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

  // ---------------------------------------------------------------
  // 8. Enrich transactions
  // ---------------------------------------------------------------
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

  // ---------------------------------------------------------------
  // 9. Resolve draft picks → Map<pickKey, {playerId, playerName}>
  // ---------------------------------------------------------------
  const { draftsBySeason, draftPicksMap } = await resolveDraftPicks(allLeagueIds);

  // Build draftResolutions map: "{leagueId}:{season}:{round}:{origRosterId}" -> {playerId, playerName}
  const draftResolutions = new Map<string, { playerId: string; playerName: string }>();
  const resolvedPlayerIds = new Set<string>();

  // Iterate over pick events that have pick tuples.
  const pickCandidates = new Set<string>();
  for (const ev of events) {
    if (
      ev.pickSeason !== null &&
      ev.pickRound !== null &&
      ev.pickOriginalRosterId !== null
    ) {
      pickCandidates.add(
        pickKey({
          kind: "pick",
          leagueId: ev.leagueId,
          pickSeason: ev.pickSeason,
          pickRound: ev.pickRound,
          pickOriginalRosterId: ev.pickOriginalRosterId,
        }),
      );
    }
  }

  for (const key of pickCandidates) {
    const parsed = parsePickKey(key);
    if (!parsed) continue;
    const draftInfo = draftsBySeason.get(parsed.pickSeason);
    if (!draftInfo || !draftInfo.slotToRosterId || draftInfo.status !== "complete") continue;
    const originalSlot = findOriginalSlot(draftInfo.slotToRosterId, parsed.pickOriginalRosterId);
    if (originalSlot === null) continue;
    const pickNo = calculatePickNumber(
      parsed.pickRound,
      originalSlot,
      draftInfo.totalRosters,
      draftInfo.type === "snake",
    );
    const picksForDraft = draftPicksMap.get(draftInfo.draftId);
    const playerId = picksForDraft?.get(pickNo);
    if (playerId) {
      resolvedPlayerIds.add(playerId);
      draftResolutions.set(key, { playerId, playerName: playerId });
    }
  }

  // ---------------------------------------------------------------
  // 10. Gather playerIds from assetEvents + enriched txns + pick resolutions
  //     Then query `players` for names/positions/teams.
  // ---------------------------------------------------------------
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
  for (const pid of resolvedPlayerIds) allPlayerIds.add(pid);

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

  // Enrich draftResolutions with real player names.
  for (const [key, val] of draftResolutions) {
    const player = playersMap.get(val.playerId);
    if (player) draftResolutions.set(key, { playerId: val.playerId, playerName: player.name });
  }

  // ---------------------------------------------------------------
  // 11. Build managers map (userId -> {displayName, avatar, seasons[]})
  // ---------------------------------------------------------------
  const managersMap: BuildGraphInput["managers"] = new Map();
  for (const [userId, meta] of managerMeta) {
    managersMap.set(userId, {
      displayName: meta.displayName,
      avatar: meta.avatar,
      seasons: Array.from(meta.seasons).sort(),
    });
  }

  // ---------------------------------------------------------------
  // 12. Build the graph
  // ---------------------------------------------------------------
  let graph: Graph = buildGraphFromEvents({
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
    draftResolutions,
    rosterToUser,
  });

  // ---------------------------------------------------------------
  // 13. Apply focus subgraph if requested
  // ---------------------------------------------------------------
  const focus: GraphFocus | null = (() => {
    if (focusPlayerId) return { kind: "player", playerId: focusPlayerId };
    if (focusManagerId) return { kind: "manager", userId: focusManagerId };
    if (focusPickKey) {
      const parsed = parsePickKey(focusPickKey);
      if (parsed) return { kind: "pick", ...parsed };
    }
    return null;
  })();
  if (focus) {
    graph = focusSubgraph(graph, focus, focusHops);
  }

  // ---------------------------------------------------------------
  // 14. Apply server-side layout (gracefully skip if Module C missing)
  // ---------------------------------------------------------------
  await tryApplyLayout(graph, layoutMode);

  // Noop-touch of filter params (for future in-query filtering). The current
  // MVP applies filters client-side via applyGraphFilters(); we simply echo
  // unused params here to keep the route contract consistent.
  void seasonsParam;
  void managersParam;
  void eventTypesParam;

  // ---------------------------------------------------------------
  // 15. Build response
  // ---------------------------------------------------------------
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
