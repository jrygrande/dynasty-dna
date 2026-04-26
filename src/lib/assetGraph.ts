/**
 * Asset Graph Browser — transaction-node + tenure-edge model.
 *
 * Each node is a transaction (draft pick, trade, waiver add, FA add) or a
 * pseudo-anchor (a manager's current roster). Each edge is a single
 * continuous span of "player X on manager Y's roster" — its source is the
 * transaction that put the player there, its target is the transaction that
 * took them off (or the current-roster anchor if the player is still
 * rostered).
 *
 * Pick tenures follow the same shape: the edge represents "manager Y held
 * pick P," sourced at the pick_trade that delivered the pick (or the first
 * visible owner) and sunk at the next pick_trade, the draft_selected that
 * resolved it, or the current-roster anchor.
 */

import type { EnrichedTransaction } from "./transactionEnrichment";

// ---------------------------------------------------------------------------
// Id helpers
// ---------------------------------------------------------------------------

/**
 * Stable id for a pick within a league family.
 *
 * Pick trades may happen in one season's league while the draft resolution
 * happens in another, so leagueId is intentionally omitted — within a
 * family, (pickSeason, pickRound, pickOriginalRosterId) is unique.
 */
export function pickKey(p: {
  leagueId?: string;
  pickSeason: string;
  pickRound: number;
  pickOriginalRosterId: number;
}): string {
  return `${p.pickSeason}:${p.pickRound}:${p.pickOriginalRosterId}`;
}

/** Node id for a transaction with a real transactionId (trade, waiver, FA). */
export function transactionNodeId(transactionId: string): string {
  return `tx:${transactionId}`;
}

/** Node id for a draft selection (draft events have no transactionId). */
export function draftNodeId(eventId: string): string {
  return `draft:${eventId}`;
}

/** Node id for a manager's current-roster anchor. */
export function currentRosterNodeId(userId: string): string {
  return `current:${userId}`;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TransactionKind =
  | "draft"
  | "trade"
  | "waiver"
  | "free_agent"
  | "commissioner";

interface LayoutPos {
  x: number;
  y: number;
}

interface TransactionManagerRef {
  userId: string;
  displayName: string;
}

interface TransactionAssetRef {
  kind: "player" | "pick";
  playerId?: string;
  playerName?: string;
  playerPosition?: string | null;
  playerTeam?: string | null;
  pickSeason?: string;
  pickRound?: number;
  pickOriginalRosterId?: number;
  pickLabel?: string;
  /** Manager userId who received the asset at this transaction. */
  toUserId: string | null;
  /** Manager userId who gave up the asset at this transaction. null for draft/waiver/FA adds. */
  fromUserId: string | null;
}

export interface TransactionNode {
  id: string;
  kind: "transaction";
  txKind: TransactionKind;
  transactionId: string | null;
  leagueId: string;
  season: string;
  week: number;
  createdAt: number;
  /** Managers participating in this transaction. 1 for draft/waiver/FA, 2 for trade. */
  managers: TransactionManagerRef[];
  /** Assets touched by this transaction. */
  assets: TransactionAssetRef[];
  layout?: LayoutPos;
}

export interface CurrentRosterNode {
  id: string;
  kind: "current_roster";
  userId: string;
  displayName: string;
  avatar: string | null;
  layout?: LayoutPos;
}

export type GraphNode = TransactionNode | CurrentRosterNode;

export interface TenureEdge {
  id: string;
  source: string;
  target: string;
  /** The manager who held the asset during this tenure. */
  managerUserId: string;
  managerName: string;
  assetKind: "player" | "pick";
  /** For player tenures. */
  playerId: string | null;
  playerName: string | null;
  playerPosition: string | null;
  playerTeam: string | null;
  /** For pick tenures. */
  pickSeason: string | null;
  pickRound: number | null;
  pickOriginalRosterId: number | null;
  pickLabel: string | null;
  /** Span start (when manager acquired the asset). */
  startSeason: string;
  startWeek: number;
  /** Span end. null when the tenure is still open (anchored to current_roster). */
  endSeason: string | null;
  endWeek: number | null;
  /** True if target is a current_roster node. */
  isOpen: boolean;
}

export type GraphEdge = TenureEdge;

export interface GraphStats {
  totalTransactions: number;
  totalTenures: number;
  openTenures: number;
  playersInvolved: number;
  picksInvolved: number;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: GraphStats;
}

export type GraphSelection =
  | { type: "node"; nodeId: string }
  | { type: "edge"; edgeId: string };

/** Seed focus for the graph — which asset to anchor the view on. */
export type GraphFocus =
  | { kind: "player"; playerId: string }
  | { kind: "pick"; leagueId: string; pickSeason: string; pickRound: number; pickOriginalRosterId: number };

export interface GraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: GraphStats;
  seasons: string[];
  managers: Array<{ userId: string; displayName: string; avatar: string | null }>;
  transactions: Record<string, EnrichedTransaction>;
  computedAt: number;
}

// ---------------------------------------------------------------------------
// Build input
// ---------------------------------------------------------------------------

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
  players: Map<string, { name: string; position: string | null; team: string | null }>;
  managers: Map<string, { displayName: string; avatar: string | null; seasons: string[] }>;
  /** rosterKey "leagueId:rosterId" -> userId. */
  rosterToUser: Map<string, string>;
  /** userId -> set of playerIds currently on their roster. */
  currentRosters: Map<string, Set<string>>;
  /** userId -> set of pickKeys currently owned by them (pre-draft picks that haven't been used). */
  currentPickOwners: Map<string, Set<string>>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Ev = BuildGraphInput["assetEvents"][number];

function eventNodeId(ev: Ev): string {
  return ev.transactionId
    ? transactionNodeId(ev.transactionId)
    : draftNodeId(ev.id);
}

function eventTxKind(ev: Ev): TransactionKind {
  if (ev.eventType === "draft_selected") return "draft";
  if (ev.eventType === "trade" || ev.eventType === "pick_trade") return "trade";
  if (ev.eventType === "waiver_add" || ev.eventType === "waiver_drop") return "waiver";
  if (ev.eventType === "free_agent_add" || ev.eventType === "free_agent_drop") return "free_agent";
  return "commissioner";
}

function pickLabel(ev: Ev, fromUserName: string | null): string {
  if (ev.pickSeason === null || ev.pickRound === null) return "Pick";
  const base = `${ev.pickSeason} R${ev.pickRound}`;
  return fromUserName ? `${base} (${fromUserName})` : base;
}

/** Events that confer new ownership (toUserId set). */
function isEntry(ev: Ev): boolean {
  return (
    ev.toUserId !== null &&
    (ev.eventType === "draft_selected" ||
      ev.eventType === "trade" ||
      ev.eventType === "pick_trade" ||
      ev.eventType === "waiver_add" ||
      ev.eventType === "free_agent_add")
  );
}

/** Events that end ownership (fromUserId set). Trade/pick_trade are both entry AND exit. */
function isExit(ev: Ev): boolean {
  return (
    ev.fromUserId !== null &&
    (ev.eventType === "trade" ||
      ev.eventType === "pick_trade" ||
      ev.eventType === "waiver_drop" ||
      ev.eventType === "free_agent_drop")
  );
}

/** Event type priority: draft_selected sorts AFTER pick_trade so that the
 *  tenure walk sees the trade that delivered the pick before the draft
 *  that resolves it (they may share the same season/week/createdAt). */
const EVENT_ORDER: Record<string, number> = {
  pick_trade: 0,
  trade: 1,
  waiver_add: 2,
  waiver_drop: 2,
  free_agent_add: 2,
  free_agent_drop: 2,
  commissioner: 3,
  draft_selected: 4,
};

function compareEvents(a: Ev, b: Ev): number {
  const seasonCmp = a.season.localeCompare(b.season);
  if (seasonCmp !== 0) return seasonCmp;
  // Use createdAt as the primary chronological sort within a season.
  // Week numbers are unreliable across event types — Sleeper records
  // draft_selected as week 0 even when offseason pick_trade events
  // that delivered picks to the drafter are week 1+.
  const ac = a.createdAt ?? 0;
  const bc = b.createdAt ?? 0;
  if (ac !== bc) return ac - bc;
  if (a.week !== b.week) return a.week - b.week;
  // Same timestamp tiebreak: draft_selected sorts after pick_trade.
  return (EVENT_ORDER[a.eventType] ?? 5) - (EVENT_ORDER[b.eventType] ?? 5);
}

// ---------------------------------------------------------------------------
// buildGraphFromEvents
// ---------------------------------------------------------------------------

export function buildGraphFromEvents(input: BuildGraphInput): Graph {
  const {
    assetEvents,
    players,
    managers,
    currentRosters,
    currentPickOwners,
  } = input;

  const managerName = (userId: string): string =>
    managers.get(userId)?.displayName ?? userId;

  const transactionNodes = new Map<string, TransactionNode>();
  const currentRosterNodes = new Map<string, CurrentRosterNode>();
  const edges: TenureEdge[] = [];

  // Sort events for deterministic walk.
  const sortedEvents = [...assetEvents].sort(compareEvents);

  // -------------------------------------------------------------------------
  // 1. Materialize transaction nodes (deduped by nodeId).
  // -------------------------------------------------------------------------
  // Walk once to build the node set + gather per-transaction manager+asset
  // summaries. Multiple events can share a transactionId (a trade moves 3
  // players = 3 events sharing one tx); we want one node per transactionId
  // summarizing all of them.

  for (const ev of sortedEvents) {
    const nodeId = eventNodeId(ev);

    let node = transactionNodes.get(nodeId);
    if (!node) {
      node = {
        id: nodeId,
        kind: "transaction",
        txKind: eventTxKind(ev),
        transactionId: ev.transactionId,
        leagueId: ev.leagueId,
        season: ev.season,
        week: ev.week,
        createdAt: ev.createdAt ?? 0,
        managers: [],
        assets: [],
      };
      transactionNodes.set(nodeId, node);
    }

    // Record managers participating.
    const participantIds = new Set(node.managers.map((m) => m.userId));
    if (ev.fromUserId && !participantIds.has(ev.fromUserId)) {
      node.managers.push({ userId: ev.fromUserId, displayName: managerName(ev.fromUserId) });
    }
    if (ev.toUserId && !participantIds.has(ev.toUserId)) {
      node.managers.push({ userId: ev.toUserId, displayName: managerName(ev.toUserId) });
    }

    // Record asset touched by this event.
    if (ev.assetKind === "player" && ev.playerId) {
      const p = players.get(ev.playerId);
      const existing = node.assets.find(
        (a) => a.kind === "player" && a.playerId === ev.playerId,
      );
      if (!existing) {
        node.assets.push({
          kind: "player",
          playerId: ev.playerId,
          playerName: p?.name ?? ev.playerId,
          playerPosition: p?.position ?? null,
          playerTeam: p?.team ?? null,
          fromUserId: ev.fromUserId,
          toUserId: ev.toUserId,
        });
      }
    } else if (
      ev.assetKind === "pick" &&
      ev.pickSeason !== null &&
      ev.pickRound !== null &&
      ev.pickOriginalRosterId !== null
    ) {
      const existing = node.assets.find(
        (a) =>
          a.kind === "pick" &&
          a.pickSeason === ev.pickSeason &&
          a.pickRound === ev.pickRound &&
          a.pickOriginalRosterId === ev.pickOriginalRosterId,
      );
      if (!existing) {
        const origUser = input.rosterToUser.get(
          `${ev.leagueId}:${ev.pickOriginalRosterId}`,
        );
        const origUserName = origUser ? managerName(origUser) : null;
        node.assets.push({
          kind: "pick",
          pickSeason: ev.pickSeason,
          pickRound: ev.pickRound,
          pickOriginalRosterId: ev.pickOriginalRosterId,
          pickLabel: pickLabel(ev, origUserName),
          fromUserId: ev.fromUserId,
          toUserId: ev.toUserId,
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // 2. Walk events per-asset to emit tenure edges.
  // -------------------------------------------------------------------------
  // For each asset (player or pick), walk its events chronologically.
  // Maintain a "pending tenure" (the currently-open span). Each event
  // potentially closes the pending tenure (emitting an edge) and/or opens a
  // new one.

  const playerEvents = new Map<string, Ev[]>();
  const pickEvents = new Map<string, Ev[]>();

  for (const ev of sortedEvents) {
    if (ev.assetKind === "player" && ev.playerId) {
      const arr = playerEvents.get(ev.playerId) ?? [];
      arr.push(ev);
      playerEvents.set(ev.playerId, arr);
    }
    if (
      ev.pickSeason !== null &&
      ev.pickRound !== null &&
      ev.pickOriginalRosterId !== null
    ) {
      const key = pickKey({
        leagueId: ev.leagueId,
        pickSeason: ev.pickSeason,
        pickRound: ev.pickRound,
        pickOriginalRosterId: ev.pickOriginalRosterId,
      });
      const arr = pickEvents.get(key) ?? [];
      arr.push(ev);
      pickEvents.set(key, arr);
    }
  }

  const ensureCurrentRoster = (userId: string): string => {
    const id = currentRosterNodeId(userId);
    if (!currentRosterNodes.has(id)) {
      const mgr = managers.get(userId);
      currentRosterNodes.set(id, {
        id,
        kind: "current_roster",
        userId,
        displayName: mgr?.displayName ?? userId,
        avatar: mgr?.avatar ?? null,
      });
    }
    return id;
  };

  // Player tenures.
  for (const [playerId, events] of playerEvents) {
    const player = players.get(playerId);
    const playerName = player?.name ?? playerId;
    const playerPosition = player?.position ?? null;
    const playerTeam = player?.team ?? null;

    let tenureOwner: string | null = null;
    let tenureStart: { nodeId: string; season: string; week: number } | null = null;

    for (const ev of events) {
      const nodeId = eventNodeId(ev);
      const entry = isEntry(ev);
      const exit = isExit(ev);

      if (exit && tenureOwner && tenureStart && tenureOwner === ev.fromUserId) {
        edges.push({
          id: `tenure:player:${playerId}:${tenureStart.nodeId}->${nodeId}`,
          source: tenureStart.nodeId,
          target: nodeId,
          managerUserId: tenureOwner,
          managerName: managerName(tenureOwner),
          assetKind: "player",
          playerId,
          playerName,
          playerPosition,
          playerTeam,
          pickSeason: null,
          pickRound: null,
          pickOriginalRosterId: null,
          pickLabel: null,
          startSeason: tenureStart.season,
          startWeek: tenureStart.week,
          endSeason: ev.season,
          endWeek: ev.week,
          isOpen: false,
        });
        tenureOwner = null;
        tenureStart = null;
      }

      if (entry && ev.toUserId) {
        tenureOwner = ev.toUserId;
        tenureStart = { nodeId, season: ev.season, week: ev.week };
      }
    }

    // Close open tenure against current roster (if still owned).
    if (tenureOwner && tenureStart) {
      const ownerRoster = currentRosters.get(tenureOwner);
      if (ownerRoster?.has(playerId)) {
        const anchorId = ensureCurrentRoster(tenureOwner);
        edges.push({
          id: `tenure:player:${playerId}:${tenureStart.nodeId}->${anchorId}`,
          source: tenureStart.nodeId,
          target: anchorId,
          managerUserId: tenureOwner,
          managerName: managerName(tenureOwner),
          assetKind: "player",
          playerId,
          playerName,
          playerPosition,
          playerTeam,
          pickSeason: null,
          pickRound: null,
          pickOriginalRosterId: null,
          pickLabel: null,
          startSeason: tenureStart.season,
          startWeek: tenureStart.week,
          endSeason: null,
          endWeek: null,
          isOpen: true,
        });
      }
      // If player is not on the current owner's roster (data gap, or dropped
      // without an explicit drop event), we silently truncate the open tenure.
    }
  }

  // Pick tenures. Events for picks are pick_trade (from/to) and draft_selected
  // (pick resolved into player — closes the pick tenure at the draft node).
  for (const [key, events] of pickEvents) {
    const first = events[0];
    if (!first) continue;

    // Label for edge display — "2024 R1 (Andrew)"
    const origUser = input.rosterToUser.get(`${first.leagueId}:${first.pickOriginalRosterId}`);
    const origUserName = origUser ? managerName(origUser) : null;
    const label = pickLabel(first, origUserName);

    let tenureOwner: string | null = null;
    let tenureStart: { nodeId: string; season: string; week: number } | null = null;

    for (const ev of events) {
      const nodeId = eventNodeId(ev);

      if (ev.eventType === "draft_selected") {
        // Pick resolves — close any open tenure at the draft node.
        if (tenureOwner && tenureStart) {
          edges.push({
            id: `tenure:pick:${key}:${tenureStart.nodeId}->${nodeId}`,
            source: tenureStart.nodeId,
            target: nodeId,
            managerUserId: tenureOwner,
            managerName: managerName(tenureOwner),
            assetKind: "pick",
            playerId: null,
            playerName: null,
            playerPosition: null,
            playerTeam: null,
            pickSeason: ev.pickSeason,
            pickRound: ev.pickRound,
            pickOriginalRosterId: ev.pickOriginalRosterId,
            pickLabel: label,
            startSeason: tenureStart.season,
            startWeek: tenureStart.week,
            endSeason: ev.season,
            endWeek: ev.week,
            isOpen: false,
          });
          tenureOwner = null;
          tenureStart = null;
        }
        continue;
      }

      // pick_trade: both exit and entry.
      if (tenureOwner && tenureStart && tenureOwner === ev.fromUserId) {
        edges.push({
          id: `tenure:pick:${key}:${tenureStart.nodeId}->${nodeId}`,
          source: tenureStart.nodeId,
          target: nodeId,
          managerUserId: tenureOwner,
          managerName: managerName(tenureOwner),
          assetKind: "pick",
          playerId: null,
          playerName: null,
          playerPosition: null,
          playerTeam: null,
          pickSeason: ev.pickSeason,
          pickRound: ev.pickRound,
          pickOriginalRosterId: ev.pickOriginalRosterId,
          pickLabel: label,
          startSeason: tenureStart.season,
          startWeek: tenureStart.week,
          endSeason: ev.season,
          endWeek: ev.week,
          isOpen: false,
        });
        tenureOwner = null;
        tenureStart = null;
      }

      if (ev.toUserId) {
        tenureOwner = ev.toUserId;
        tenureStart = { nodeId, season: ev.season, week: ev.week };
      }
    }

    // Close open pick tenure against current pick owner (if still owned).
    if (tenureOwner && tenureStart) {
      const ownerPicks = currentPickOwners.get(tenureOwner);
      if (ownerPicks?.has(key)) {
        const anchorId = ensureCurrentRoster(tenureOwner);
        edges.push({
          id: `tenure:pick:${key}:${tenureStart.nodeId}->${anchorId}`,
          source: tenureStart.nodeId,
          target: anchorId,
          managerUserId: tenureOwner,
          managerName: managerName(tenureOwner),
          assetKind: "pick",
          playerId: null,
          playerName: null,
          playerPosition: null,
          playerTeam: null,
          pickSeason: first.pickSeason,
          pickRound: first.pickRound,
          pickOriginalRosterId: first.pickOriginalRosterId,
          pickLabel: label,
          startSeason: tenureStart.season,
          startWeek: tenureStart.week,
          endSeason: null,
          endWeek: null,
          isOpen: true,
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // 3. Emit the graph.
  // -------------------------------------------------------------------------

  const allNodes: GraphNode[] = [
    ...transactionNodes.values(),
    ...currentRosterNodes.values(),
  ];

  const stats: GraphStats = {
    totalTransactions: transactionNodes.size,
    totalTenures: edges.length,
    openTenures: edges.filter((e) => e.isOpen).length,
    playersInvolved: new Set(
      edges.filter((e) => e.assetKind === "player").map((e) => e.playerId),
    ).size,
    picksInvolved: new Set(
      edges.filter((e) => e.assetKind === "pick").map((e) => {
        if (e.pickSeason === null || e.pickRound === null || e.pickOriginalRosterId === null) {
          return null;
        }
        return `${e.pickSeason}:${e.pickRound}:${e.pickOriginalRosterId}`;
      }).filter((k): k is string => k !== null),
    ).size,
  };

  return { nodes: allNodes, edges, stats };
}
