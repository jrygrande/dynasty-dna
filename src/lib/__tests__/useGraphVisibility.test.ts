/**
 * @jest-environment node
 *
 * Visibility invariants for `useGraphVisibility`. These guard the
 * auto-expand rules called out by issue #78 — when a draft node is
 * visible (because it sits in another revealed thread), both its
 * outgoing player tenure and any incoming pick lineage must auto-render
 * without an explicit click on the asset row.
 *
 * Tests run the hook's pure reducer logic via a tiny renderer: we drive
 * the same `useMemo` shape by calling the underlying compute in a
 * minimal React harness.
 */

import type { GraphEdge, GraphNode, GraphStats } from "@/lib/assetGraph";
import { computeVisibility } from "@/lib/useGraphVisibility";

declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (value: unknown) => {
  toBe: (expected: unknown) => void;
  toContain: (expected: unknown) => void;
  toEqual: (expected: unknown) => void;
  toBeGreaterThan: (expected: number) => void;
};

const NO_STATS: GraphStats = {
  totalTransactions: 0,
  totalTenures: 0,
  openTenures: 0,
  playersInvolved: 0,
  picksInvolved: 0,
};

function pickTrade(id: string): GraphNode {
  return {
    id,
    kind: "transaction",
    txKind: "trade",
    transactionId: id,
    leagueId: "L",
    season: "2024",
    week: 1,
    createdAt: 0,
    managers: [],
    assets: [],
  };
}

function draft(id: string, playerId: string): GraphNode {
  return {
    id,
    kind: "transaction",
    txKind: "draft",
    transactionId: null,
    leagueId: "L",
    season: "2024",
    week: 0,
    createdAt: 0,
    managers: [],
    assets: [
      {
        kind: "player",
        playerId,
        playerName: `P${playerId}`,
        playerPosition: null,
        playerTeam: null,
        fromUserId: null,
        toUserId: "U1",
      },
    ],
  };
}

function rosterAnchor(id: string): GraphNode {
  return {
    id,
    kind: "current_roster",
    userId: "U1",
    displayName: "U1",
    avatar: null,
    layout: undefined,
  };
}

function pickEdge(id: string, source: string, target: string): GraphEdge {
  return {
    id,
    source,
    target,
    managerUserId: "U2",
    managerName: "U2",
    assetKind: "pick",
    playerId: null,
    playerName: null,
    playerPosition: null,
    playerTeam: null,
    pickSeason: "2024",
    pickRound: 1,
    pickOriginalRosterId: 5,
    pickLabel: "2024 R1",
    startSeason: "2024",
    startWeek: 0,
    endSeason: "2024",
    endWeek: 0,
    isOpen: false,
  };
}

function playerEdge(
  id: string,
  source: string,
  target: string,
  playerId: string,
  isOpen = false,
): GraphEdge {
  return {
    id,
    source,
    target,
    managerUserId: "U1",
    managerName: "U1",
    assetKind: "player",
    playerId,
    playerName: `P${playerId}`,
    playerPosition: null,
    playerTeam: null,
    pickSeason: null,
    pickRound: null,
    pickOriginalRosterId: null,
    pickLabel: null,
    startSeason: "2024",
    startWeek: 0,
    endSeason: isOpen ? null : "2024",
    endWeek: isOpen ? null : 1,
    isOpen,
  };
}

describe("useGraphVisibility — auto-expand on visible drafts", () => {
  it("reveals the player tenure when a draft node is visible via pick lineage", () => {
    // Pick "2024 R1 origRoster=5" was traded once: trade → draft.
    // The draft selected playerX, who was then traded to the roster.
    // Seeding by the pick should reveal: trade → draft (pick lineage)
    // AND draft → trade2 → roster (player lineage), all without clicks.
    const trade1 = pickTrade("trade1");
    const draftNode = draft("draft1", "playerX");
    const trade2 = pickTrade("trade2");
    const roster = rosterAnchor("roster1");

    const nodes: GraphNode[] = [trade1, draftNode, trade2, roster];
    const edges: GraphEdge[] = [
      // pick lineage closes at draft
      pickEdge("p1", "trade1", "draft1"),
      // player lineage opens at draft
      playerEdge("e1", "draft1", "trade2", "playerX"),
      playerEdge("e2", "trade2", "roster1", "playerX", true),
    ];

    const result = computeVisibility(
      { nodes, edges, stats: NO_STATS },
      {
        // Seed = endpoints of the latest pick tenure (trade1 → draft).
        seed: ["trade1", "draft1"],
        expanded: new Set(),
        removed: new Set(),
        seedAssetKey: "pick:2024:1:5",
      },
    );

    const visibleNodeIds = result.visibleNodes.map((n) => n.id).sort();
    const visibleEdgeIds = result.visibleEdges.map((e) => e.id).sort();

    // The auto-expand should bring in the full player lineage.
    expect(visibleNodeIds).toEqual(["draft1", "roster1", "trade1", "trade2"]);
    expect(visibleEdgeIds).toEqual(["e1", "e2", "p1"]);

    // The draft's chainAssetKeys must include the auto-revealed player so
    // its row stays visible when the card is collapsed (the row is what
    // the user looks at to confirm "yes, this draft selected playerX").
    const draftChain = Array.from(result.chainAssetsByNode.get("draft1") ?? []).sort();
    expect(draftChain).toContain("player:playerX");
  });

  it("reveals the originating pick when a draft is visible via player lineage", () => {
    // Symmetric to the prior test: seed by playerX, expect the pick chain
    // (trade1 → draft) to come along, including the pick edge p1.
    const trade1 = pickTrade("trade1");
    const draftNode = draft("draft1", "playerX");
    const trade2 = pickTrade("trade2");
    const roster = rosterAnchor("roster1");

    const nodes: GraphNode[] = [trade1, draftNode, trade2, roster];
    const edges: GraphEdge[] = [
      pickEdge("p1", "trade1", "draft1"),
      playerEdge("e1", "draft1", "trade2", "playerX"),
      playerEdge("e2", "trade2", "roster1", "playerX", true),
    ];

    const result = computeVisibility(
      { nodes, edges, stats: NO_STATS },
      {
        // Seed = endpoints of the latest player tenure (trade2 → roster).
        seed: ["trade2", "roster1"],
        expanded: new Set(),
        removed: new Set(),
        seedAssetKey: "player:playerX",
      },
    );

    const visibleNodeIds = result.visibleNodes.map((n) => n.id).sort();
    const visibleEdgeIds = result.visibleEdges.map((e) => e.id).sort();

    expect(visibleNodeIds).toEqual(["draft1", "roster1", "trade1", "trade2"]);
    expect(visibleEdgeIds).toEqual(["e1", "e2", "p1"]);
  });
});
