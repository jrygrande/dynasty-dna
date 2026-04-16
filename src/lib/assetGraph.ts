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

export function buildGraphFromEvents(_input: BuildGraphInput): Graph {
  throw new Error("buildGraphFromEvents not implemented — Module A owns this body");
}

export function applyGraphFilters(_graph: Graph, _filters: GraphFilters): Graph {
  throw new Error("applyGraphFilters not implemented — Module A owns this body");
}

export function focusSubgraph(_graph: Graph, _focus: GraphFocus, _hops: number): Graph {
  throw new Error("focusSubgraph not implemented — Module A owns this body");
}

export function computeHeaderStats(_graph: Graph): {
  trades: number;
  multiHopChains: number;
  picksTraded: number;
} {
  throw new Error("computeHeaderStats not implemented — Module A owns this body");
}
