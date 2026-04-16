/**
 * Asset Graph Browser — frozen type/id contract.
 *
 * This file is the FROZEN type and id-helper contract for the Asset Graph
 * Browser feature (Issue #26). All downstream modules (API route, React Flow
 * adapter, filter UI, server aggregator) depend on these exact signatures.
 *
 * Rules:
 *   1. Id helpers (`assetNodeId`, `managerNodeId`, `pickKey`) MUST be used
 *      by every caller on every side of the wire. Never hand-concatenate
 *      the id strings — the API and the client rely on byte-for-byte
 *      identical ids to match nodes and edges.
 *   2. Transform function bodies (`buildGraphFromEvents`, `applyGraphFilters`,
 *      `focusSubgraph`, `computeHeaderStats`) are stubbed in Phase 0. Module A
 *      owns filling those bodies. Do NOT modify their signatures without
 *      coordinating — any signature change invalidates the parallel work
 *      downstream.
 *   3. Manager nodes are keyed by Sleeper `userId` (stable across seasons and
 *      league renames). Never key manager nodes by `rosterId` — roster ids
 *      are league-scoped and reused.
 *   4. Pick nodes are keyed by the league-scoped tuple
 *      `(leagueId, pickSeason, pickRound, pickOriginalRosterId)` because
 *      picks in the schema are league-scoped. The tuple is flattened into
 *      `pickKey` for maps and into `assetNodeId` for graph node ids.
 */

import type { EnrichedTransaction } from "./transactionEnrichment";

export type AssetRef =
  | { kind: "player"; playerId: string }
  | { kind: "pick"; leagueId: string; pickSeason: string; pickRound: number; pickOriginalRosterId: number };

// Stable ids — byte-for-byte identical between API and client.
// Callers MUST use these helpers; never hand-concatenate.
export function assetNodeId(a: AssetRef): string {
  if (a.kind === "player") return `player:${a.playerId}`;
  return `pick:${a.leagueId}:${a.pickSeason}:${a.pickRound}:${a.pickOriginalRosterId}`;
}

export function managerNodeId(userId: string): string {
  return `manager:${userId}`;
}

export function pickKey(p: Extract<AssetRef, { kind: "pick" }>): string {
  return `${p.leagueId}:${p.pickSeason}:${p.pickRound}:${p.pickOriginalRosterId}`;
}

export type GraphEdgeKind =
  | "trade_out"
  | "trade_in"
  | "pick_trade_out"
  | "pick_trade_in"
  | "draft_selected_mgr"
  | "draft_selected_pick"
  | "waiver_add"
  | "free_agent_add";

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: GraphEdgeKind;
  season: string;
  week: number;
  createdAt: number | null;
  transactionId: string | null;
  groupKey: string;
}

interface LayoutPos { x: number; y: number; }

interface ManagerNode {
  id: string;
  kind: "manager";
  userId: string;
  displayName: string;
  avatar: string | null;
  seasons: string[];
  tradeCount?: number;
  layout?: LayoutPos;
}

interface PlayerNode {
  id: string;
  kind: "player";
  playerId: string;
  name: string;
  position: string | null;
  team: string | null;
  layout?: LayoutPos;
}

interface PickNode {
  id: string;
  kind: "pick";
  leagueId: string;
  pickSeason: string;
  pickRound: number;
  pickOriginalRosterId: number;
  pickOriginalOwnerUserId: string | null;
  pickOriginalOwnerName: string | null;
  resolvedPlayerId?: string;
  resolvedPlayerName?: string;
  layout?: LayoutPos;
}

export type GraphNode = ManagerNode | PlayerNode | PickNode;

export interface GraphStats {
  totalTrades: number;
  totalDraftPicks: number;
  totalEdges: number;
  totalNodes: number;
  multiHopChains: number;
  picksTraded: number;
}

export interface GraphApiParams {
  seasons?: string[];
  managers?: string[];
  eventTypes?: GraphEdgeKind[];
  focusPlayerId?: string;
  focusPickKey?: string;
  focusManagerId?: string;
  focusHops?: number;
  layout?: "band" | "dagre";
}

export interface GraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: GraphStats;
  seasons: string[];
  managers: Array<{ userId: string; displayName: string; avatar: string | null }>;
  transactions: Record<string, EnrichedTransaction>;
  computedAt: number;
}

export type GraphSelection = { type: "node"; nodeId: string } | { type: "edge"; edgeId: string };

export type GraphFocus =
  | { kind: "player"; playerId: string }
  | { kind: "pick"; leagueId: string; pickSeason: string; pickRound: number; pickOriginalRosterId: number }
  | { kind: "manager"; userId: string };

export interface GraphFilters {
  seasons: string[];
  managers: string[];
  eventTypes: GraphEdgeKind[];
  focus: GraphFocus | null;
  focusHops: number;
  layout: "band" | "dagre";
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: GraphStats;
}

// =====================================================================
// Transforms — STUBBED in Phase 0. Bodies filled by Module A's agent.
// DO NOT CHANGE the signatures below without coordinating.
// =====================================================================

export interface BuildGraphInput {
  assetEvents: ReadonlyArray<{
    id: string;
    leagueId: string;
    season: string;
    week: number;
    eventType: string;
    assetKind: string;
    playerId: string | null;
    pickSeason: string | null;
    pickRound: number | null;
    pickOriginalRosterId: number | null;
    fromRosterId: number | null;
    toRosterId: number | null;
    fromUserId: string | null;
    toUserId: string | null;
    transactionId: string | null;
    createdAt: number | null;
    details: unknown;
  }>;
  enrichedTransactions: Record<string, EnrichedTransaction>;
  // playerId -> {name, position, team}
  players: Map<string, { name: string; position: string | null; team: string | null }>;
  // userId -> {displayName, avatar, seasons}
  managers: Map<string, { displayName: string; avatar: string | null; seasons: string[] }>;
  // Resolved draft picks: pickKey -> {playerId, playerName}
  draftResolutions: Map<string, { playerId: string; playerName: string }>;
  // leagueId + rosterId -> userId
  rosterToUser: Map<string, string>;
}

// ---------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------

function rosterUserKey(leagueId: string, rosterId: number): string {
  return `${leagueId}:${rosterId}`;
}

function isManagerNode(n: GraphNode): n is ManagerNode {
  return n.kind === "manager";
}

/**
 * Recompute all stats for the given nodes/edges + original enriched transactions.
 * multiHopChains is computed from `enrichedTransactions`, falling back to 0 when
 * the map is not available (e.g. after filtering, when the caller just wants a
 * refresh against the same txs — which we thread through).
 */
function computeStats(
  nodes: GraphNode[],
  edges: GraphEdge[],
  enrichedTransactions: Record<string, EnrichedTransaction>,
  sourceAssetEvents: ReadonlyArray<{ id: string; eventType: string; transactionId: string | null }>,
): GraphStats {
  const tradeTxIds = new Set<string>();
  let draftSelectedEvents = 0;
  for (const e of sourceAssetEvents) {
    if ((e.eventType === "trade" || e.eventType === "pick_trade") && e.transactionId) {
      tradeTxIds.add(e.transactionId);
    }
    if (e.eventType === "draft_selected") draftSelectedEvents++;
  }

  let multiHopChains = 0;
  for (const txId of tradeTxIds) {
    const tx = enrichedTransactions[txId];
    if (!tx) continue;
    const legs = (tx.adds?.length ?? 0) + (tx.draftPicks?.length ?? 0);
    if (legs >= 3) multiHopChains++;
  }

  const picksTradedKeys = new Set<string>();
  for (const edge of edges) {
    if (edge.kind === "pick_trade_out" || edge.kind === "pick_trade_in") {
      const pickNode = nodes.find((n) => n.id === edge.source || n.id === edge.target);
      if (pickNode && pickNode.kind === "pick") {
        picksTradedKeys.add(
          pickKey({
            kind: "pick",
            leagueId: pickNode.leagueId,
            pickSeason: pickNode.pickSeason,
            pickRound: pickNode.pickRound,
            pickOriginalRosterId: pickNode.pickOriginalRosterId,
          }),
        );
      }
    }
  }

  return {
    totalTrades: tradeTxIds.size,
    totalDraftPicks: draftSelectedEvents,
    totalEdges: edges.length,
    totalNodes: nodes.length,
    multiHopChains,
    picksTraded: picksTradedKeys.size,
  };
}

/**
 * Recompute stats from an existing graph (used after filters / focus), by
 * re-walking edges/nodes. Multi-hop + trade counts are re-derived from the
 * remaining edges because we no longer have the raw assetEvents.
 */
function recomputeStatsFromGraph(
  nodes: GraphNode[],
  edges: GraphEdge[],
  multiHopTxIds: Set<string>,
): GraphStats {
  const tradeTxIds = new Set<string>();
  let draftSelectedEdges = 0;

  for (const e of edges) {
    if (
      (e.kind === "trade_in" ||
        e.kind === "trade_out" ||
        e.kind === "pick_trade_in" ||
        e.kind === "pick_trade_out") &&
      e.transactionId
    ) {
      tradeTxIds.add(e.transactionId);
    }
    if (e.kind === "draft_selected_mgr") draftSelectedEdges++;
  }

  // Multi-hop: intersect the current trade set with the originally-computed
  // multi-hop set so filtering cannot falsely inflate the count.
  let multiHopChains = 0;
  for (const txId of tradeTxIds) {
    if (multiHopTxIds.has(txId)) multiHopChains++;
  }

  const picksTradedKeys = new Set<string>();
  for (const edge of edges) {
    if (edge.kind === "pick_trade_out" || edge.kind === "pick_trade_in") {
      const pickNode = nodes.find((n) => n.id === edge.source || n.id === edge.target);
      if (pickNode && pickNode.kind === "pick") {
        picksTradedKeys.add(
          pickKey({
            kind: "pick",
            leagueId: pickNode.leagueId,
            pickSeason: pickNode.pickSeason,
            pickRound: pickNode.pickRound,
            pickOriginalRosterId: pickNode.pickOriginalRosterId,
          }),
        );
      }
    }
  }

  return {
    totalTrades: tradeTxIds.size,
    totalDraftPicks: draftSelectedEdges,
    totalEdges: edges.length,
    totalNodes: nodes.length,
    multiHopChains,
    picksTraded: picksTradedKeys.size,
  };
}

/**
 * Carry forward which transactions were multi-hop by stamping a property on
 * the graph. We keep this non-exported and informally typed: the stats object
 * is the source of truth for consumers.
 */
interface InternalGraph extends Graph {
  __multiHopTxIds?: Set<string>;
}

// ---------------------------------------------------------------------
// Transforms
// ---------------------------------------------------------------------

export function buildGraphFromEvents(input: BuildGraphInput): Graph {
  const {
    assetEvents,
    enrichedTransactions,
    players,
    managers,
    draftResolutions,
    rosterToUser,
  } = input;

  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];

  const ensureManagerNode = (userId: string): string | null => {
    const id = managerNodeId(userId);
    if (!nodes.has(id)) {
      const mgr = managers.get(userId);
      nodes.set(id, {
        id,
        kind: "manager",
        userId,
        displayName: mgr?.displayName ?? userId,
        avatar: mgr?.avatar ?? null,
        seasons: mgr?.seasons ?? [],
      });
    }
    return id;
  };

  const ensurePlayerNode = (playerId: string): string => {
    const id = assetNodeId({ kind: "player", playerId });
    if (!nodes.has(id)) {
      const p = players.get(playerId);
      nodes.set(id, {
        id,
        kind: "player",
        playerId,
        name: p?.name ?? playerId,
        position: p?.position ?? null,
        team: p?.team ?? null,
      });
    }
    return id;
  };

  const ensurePickNode = (
    leagueId: string,
    pickSeason: string,
    pickRound: number,
    pickOriginalRosterId: number,
  ): string => {
    const id = assetNodeId({
      kind: "pick",
      leagueId,
      pickSeason,
      pickRound,
      pickOriginalRosterId,
    });
    if (!nodes.has(id)) {
      const origUserId = rosterToUser.get(rosterUserKey(leagueId, pickOriginalRosterId)) ?? null;
      const origOwner = origUserId ? managers.get(origUserId) : undefined;
      const key = pickKey({
        kind: "pick",
        leagueId,
        pickSeason,
        pickRound,
        pickOriginalRosterId,
      });
      const resolved = draftResolutions.get(key);
      const pickNode: PickNode = {
        id,
        kind: "pick",
        leagueId,
        pickSeason,
        pickRound,
        pickOriginalRosterId,
        pickOriginalOwnerUserId: origUserId,
        pickOriginalOwnerName: origOwner?.displayName ?? null,
        ...(resolved
          ? { resolvedPlayerId: resolved.playerId, resolvedPlayerName: resolved.playerName }
          : {}),
      };
      nodes.set(id, pickNode);
    }
    return id;
  };

  const managerIdForRoster = (leagueId: string, rosterId: number): string | null => {
    const userId = rosterToUser.get(rosterUserKey(leagueId, rosterId));
    return userId ?? null;
  };

  // Track multi-hop transactions for stats (transactions with >= 3 legs).
  const multiHopTxIds = new Set<string>();

  for (const ev of assetEvents) {
    const ts = ev.createdAt;

    const fromUserId = ev.fromRosterId !== null
      ? managerIdForRoster(ev.leagueId, ev.fromRosterId)
      : null;
    const toUserId = ev.toRosterId !== null
      ? managerIdForRoster(ev.leagueId, ev.toRosterId)
      : null;

    if (ev.eventType === "trade" && ev.assetKind === "player") {
      if (!ev.playerId) {
        console.warn(`[buildGraphFromEvents] trade event ${ev.id} missing playerId; skipping`);
        continue;
      }
      const playerNodeIdStr = ensurePlayerNode(ev.playerId);

      const groupKey = ev.transactionId ?? `trade:${ev.id}`;

      if (fromUserId && ev.fromRosterId !== null) {
        const mgrId = ensureManagerNode(fromUserId);
        if (mgrId) {
          edges.push({
            id: `trade_out:${ev.id}`,
            source: mgrId,
            target: playerNodeIdStr,
            kind: "trade_out",
            season: ev.season,
            week: ev.week,
            createdAt: ts,
            transactionId: ev.transactionId,
            groupKey,
          });
        }
      } else {
        console.warn(
          `[buildGraphFromEvents] trade event ${ev.id} has null fromRosterId/fromUser; skipping trade_out edge`,
        );
      }

      if (toUserId && ev.toRosterId !== null) {
        const mgrId = ensureManagerNode(toUserId);
        if (mgrId) {
          edges.push({
            id: `trade_in:${ev.id}`,
            source: playerNodeIdStr,
            target: mgrId,
            kind: "trade_in",
            season: ev.season,
            week: ev.week,
            createdAt: ts,
            transactionId: ev.transactionId,
            groupKey,
          });
        }
      } else {
        console.warn(
          `[buildGraphFromEvents] trade event ${ev.id} has null toRosterId/toUser; skipping trade_in edge`,
        );
      }
      continue;
    }

    if (
      (ev.eventType === "trade" || ev.eventType === "pick_trade") &&
      ev.assetKind === "pick"
    ) {
      if (
        ev.pickSeason === null ||
        ev.pickRound === null ||
        ev.pickOriginalRosterId === null
      ) {
        console.warn(
          `[buildGraphFromEvents] pick_trade event ${ev.id} missing pick tuple (season=${ev.pickSeason}, round=${ev.pickRound}, origRoster=${ev.pickOriginalRosterId}); skipping`,
        );
        continue;
      }
      const pickNodeIdStr = ensurePickNode(
        ev.leagueId,
        ev.pickSeason,
        ev.pickRound,
        ev.pickOriginalRosterId,
      );

      const groupKey = ev.transactionId ?? `pick_trade:${ev.id}`;

      if (fromUserId && ev.fromRosterId !== null) {
        const mgrId = ensureManagerNode(fromUserId);
        if (mgrId) {
          edges.push({
            id: `pick_trade_out:${ev.id}`,
            source: mgrId,
            target: pickNodeIdStr,
            kind: "pick_trade_out",
            season: ev.season,
            week: ev.week,
            createdAt: ts,
            transactionId: ev.transactionId,
            groupKey,
          });
        }
      } else {
        console.warn(
          `[buildGraphFromEvents] pick_trade event ${ev.id} has null fromRosterId/fromUser; skipping pick_trade_out edge`,
        );
      }

      if (toUserId && ev.toRosterId !== null) {
        const mgrId = ensureManagerNode(toUserId);
        if (mgrId) {
          edges.push({
            id: `pick_trade_in:${ev.id}`,
            source: pickNodeIdStr,
            target: mgrId,
            kind: "pick_trade_in",
            season: ev.season,
            week: ev.week,
            createdAt: ts,
            transactionId: ev.transactionId,
            groupKey,
          });
        }
      } else {
        console.warn(
          `[buildGraphFromEvents] pick_trade event ${ev.id} has null toRosterId/toUser; skipping pick_trade_in edge`,
        );
      }
      continue;
    }

    if (ev.eventType === "draft_selected" && ev.assetKind === "player") {
      if (!ev.playerId) {
        console.warn(`[buildGraphFromEvents] draft_selected event ${ev.id} missing playerId; skipping`);
        continue;
      }
      const playerNodeIdStr = ensurePlayerNode(ev.playerId);
      const groupKey = `draft:${ev.playerId}:${ev.season}`;

      // manager -> player edge
      if (toUserId && ev.toRosterId !== null) {
        const mgrId = ensureManagerNode(toUserId);
        if (mgrId) {
          edges.push({
            id: `draft_selected_mgr:${ev.id}`,
            source: mgrId,
            target: playerNodeIdStr,
            kind: "draft_selected_mgr",
            season: ev.season,
            week: ev.week,
            createdAt: ts,
            transactionId: null,
            groupKey,
          });
        }
      } else {
        console.warn(
          `[buildGraphFromEvents] draft_selected event ${ev.id} has null toRosterId/toUser; skipping manager edge`,
        );
      }

      // pick -> player edge if we can identify the pick (event carries pick metadata)
      if (
        ev.pickSeason !== null &&
        ev.pickRound !== null &&
        ev.pickOriginalRosterId !== null
      ) {
        const pickNodeIdStr = ensurePickNode(
          ev.leagueId,
          ev.pickSeason,
          ev.pickRound,
          ev.pickOriginalRosterId,
        );
        edges.push({
          id: `draft_selected_pick:${ev.id}`,
          source: pickNodeIdStr,
          target: playerNodeIdStr,
          kind: "draft_selected_pick",
          season: ev.season,
          week: ev.week,
          createdAt: ts,
          transactionId: null,
          groupKey,
        });
      }
      continue;
    }

    if (ev.eventType === "waiver_add") {
      if (!ev.playerId) {
        console.warn(`[buildGraphFromEvents] waiver_add event ${ev.id} missing playerId; skipping`);
        continue;
      }
      if (!toUserId || ev.toRosterId === null) {
        console.warn(
          `[buildGraphFromEvents] waiver_add event ${ev.id} has null toRosterId/toUser; skipping`,
        );
        continue;
      }
      const playerNodeIdStr = ensurePlayerNode(ev.playerId);
      const mgrId = ensureManagerNode(toUserId);
      if (mgrId) {
        edges.push({
          id: `waiver_add:${ev.id}`,
          source: mgrId,
          target: playerNodeIdStr,
          kind: "waiver_add",
          season: ev.season,
          week: ev.week,
          createdAt: ts,
          transactionId: ev.transactionId,
          groupKey: ev.transactionId ?? `waiver_add:${ev.id}`,
        });
      }
      continue;
    }

    if (ev.eventType === "free_agent_add") {
      if (!ev.playerId) {
        console.warn(`[buildGraphFromEvents] free_agent_add event ${ev.id} missing playerId; skipping`);
        continue;
      }
      if (!toUserId || ev.toRosterId === null) {
        console.warn(
          `[buildGraphFromEvents] free_agent_add event ${ev.id} has null toRosterId/toUser; skipping`,
        );
        continue;
      }
      const playerNodeIdStr = ensurePlayerNode(ev.playerId);
      const mgrId = ensureManagerNode(toUserId);
      if (mgrId) {
        edges.push({
          id: `free_agent_add:${ev.id}`,
          source: mgrId,
          target: playerNodeIdStr,
          kind: "free_agent_add",
          season: ev.season,
          week: ev.week,
          createdAt: ts,
          transactionId: ev.transactionId,
          groupKey: ev.transactionId ?? `free_agent_add:${ev.id}`,
        });
      }
      continue;
    }

    // Drops + commissioner are not rendered in MVP.
  }

  // Identify multi-hop transactions from enrichedTransactions.
  for (const [txId, tx] of Object.entries(enrichedTransactions)) {
    const legs = (tx.adds?.length ?? 0) + (tx.draftPicks?.length ?? 0);
    if (legs >= 3) multiHopTxIds.add(txId);
  }

  const nodeList = Array.from(nodes.values());
  const stats = computeStats(nodeList, edges, enrichedTransactions, assetEvents);

  const out: InternalGraph = { nodes: nodeList, edges, stats };
  out.__multiHopTxIds = multiHopTxIds;
  return out;
}

export function applyGraphFilters(graph: Graph, filters: GraphFilters): Graph {
  const eventTypeSet = new Set(filters.eventTypes);
  const seasonSet = new Set(filters.seasons);
  const managerSet = new Set(filters.managers);

  // Build a quick manager-node lookup (id -> userId).
  const managerIdToUserId = new Map<string, string>();
  for (const n of graph.nodes) {
    if (n.kind === "manager") managerIdToUserId.set(n.id, n.userId);
  }

  const filteredEdges = graph.edges.filter((e) => {
    if (eventTypeSet.size > 0 && !eventTypeSet.has(e.kind)) return false;
    if (seasonSet.size > 0 && !seasonSet.has(e.season)) return false;
    if (managerSet.size > 0) {
      const srcUser = managerIdToUserId.get(e.source);
      const tgtUser = managerIdToUserId.get(e.target);
      const matchesMgr = (srcUser && managerSet.has(srcUser)) || (tgtUser && managerSet.has(tgtUser));
      if (!matchesMgr) return false;
    }
    return true;
  });

  // Keep nodes that are:
  //  - manager nodes (always — preserves structure), OR
  //  - nodes that have at least one incident edge in the filtered set.
  const incident = new Set<string>();
  for (const e of filteredEdges) {
    incident.add(e.source);
    incident.add(e.target);
  }

  const filteredNodes = graph.nodes.filter((n) => {
    if (isManagerNode(n)) return true;
    return incident.has(n.id);
  });

  const multiHopTxIds = (graph as InternalGraph).__multiHopTxIds ?? new Set<string>();
  const stats = recomputeStatsFromGraph(filteredNodes, filteredEdges, multiHopTxIds);

  const out: InternalGraph = { nodes: filteredNodes, edges: filteredEdges, stats };
  out.__multiHopTxIds = multiHopTxIds;
  return out;
}

export function focusSubgraph(graph: Graph, focus: GraphFocus, hops: number): Graph {
  let focusNodeId: string;
  if (focus.kind === "manager") {
    focusNodeId = managerNodeId(focus.userId);
  } else if (focus.kind === "player") {
    focusNodeId = assetNodeId({ kind: "player", playerId: focus.playerId });
  } else {
    focusNodeId = assetNodeId({
      kind: "pick",
      leagueId: focus.leagueId,
      pickSeason: focus.pickSeason,
      pickRound: focus.pickRound,
      pickOriginalRosterId: focus.pickOriginalRosterId,
    });
  }

  if (!graph.nodes.some((n) => n.id === focusNodeId)) {
    // Focus target not present — return an empty graph (keeps invariants clean).
    const multiHopTxIds = (graph as InternalGraph).__multiHopTxIds ?? new Set<string>();
    const stats = recomputeStatsFromGraph([], [], multiHopTxIds);
    const out: InternalGraph = { nodes: [], edges: [], stats };
    out.__multiHopTxIds = multiHopTxIds;
    return out;
  }

  // Build adjacency (undirected).
  const adjacency = new Map<string, Set<string>>();
  for (const e of graph.edges) {
    if (!adjacency.has(e.source)) adjacency.set(e.source, new Set());
    if (!adjacency.has(e.target)) adjacency.set(e.target, new Set());
    adjacency.get(e.source)!.add(e.target);
    adjacency.get(e.target)!.add(e.source);
  }

  // BFS
  const reachable = new Set<string>([focusNodeId]);
  let frontier: string[] = [focusNodeId];
  for (let h = 0; h < Math.max(0, hops); h++) {
    const next: string[] = [];
    for (const id of frontier) {
      const neigh = adjacency.get(id);
      if (!neigh) continue;
      for (const nid of neigh) {
        if (!reachable.has(nid)) {
          reachable.add(nid);
          next.push(nid);
        }
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }

  const filteredNodes = graph.nodes.filter((n) => reachable.has(n.id));
  const filteredEdges = graph.edges.filter(
    (e) => reachable.has(e.source) && reachable.has(e.target),
  );

  const multiHopTxIds = (graph as InternalGraph).__multiHopTxIds ?? new Set<string>();
  const stats = recomputeStatsFromGraph(filteredNodes, filteredEdges, multiHopTxIds);

  const out: InternalGraph = { nodes: filteredNodes, edges: filteredEdges, stats };
  out.__multiHopTxIds = multiHopTxIds;
  return out;
}

export function computeHeaderStats(graph: Graph): {
  trades: number;
  multiHopChains: number;
  picksTraded: number;
} {
  return {
    trades: graph.stats.totalTrades,
    multiHopChains: graph.stats.multiHopChains,
    picksTraded: graph.stats.picksTraded,
  };
}
