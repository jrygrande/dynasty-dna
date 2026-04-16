import { layout, __LAYOUT_CONSTANTS__ } from "../layout";
import type { Graph, GraphEdge, GraphNode } from "@/lib/assetGraph";

const { BAND_HEIGHT, MANAGER_STRIP_X0, MANAGER_SLOT_WIDTH } = __LAYOUT_CONSTANTS__;

function mgr(userId: string): GraphNode {
  return {
    id: `manager:${userId}`,
    kind: "manager",
    userId,
    displayName: `M-${userId}`,
    avatar: null,
    seasons: [],
  };
}

function player(playerId: string): GraphNode {
  return {
    id: `player:${playerId}`,
    kind: "player",
    playerId,
    name: `Player-${playerId}`,
    position: "RB",
    team: "SF",
  };
}

function pick(leagueId: string, season: string, round: number, origRoster: number): GraphNode {
  return {
    id: `pick:${leagueId}:${season}:${round}:${origRoster}`,
    kind: "pick",
    leagueId,
    pickSeason: season,
    pickRound: round,
    pickOriginalRosterId: origRoster,
    pickOriginalOwnerUserId: null,
    pickOriginalOwnerName: null,
  };
}

function edge(
  id: string,
  source: string,
  target: string,
  season: string,
  transactionId: string | null,
): GraphEdge {
  return {
    id,
    source,
    target,
    kind: "trade_out",
    season,
    week: 1,
    createdAt: null,
    transactionId,
    groupKey: transactionId ?? `g:${id}`,
  };
}

describe("graph layout()", () => {
  it("returns an empty map for an empty graph", () => {
    const empty: Graph = {
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
    };
    expect(layout(empty, "band").size).toBe(0);
    expect(layout(empty, "dagre").size).toBe(0);
  });

  it("band: manager nodes sit in the top strip (y=0), spaced by MANAGER_SLOT_WIDTH, sorted by userId", () => {
    // Provide managers out-of-order; band sort should normalize by userId.
    const nodes = [mgr("c"), mgr("a"), mgr("b")];
    const graph: Graph = {
      nodes,
      edges: [],
      stats: {
        totalTrades: 0,
        totalDraftPicks: 0,
        totalEdges: 0,
        totalNodes: 3,
        multiHopChains: 0,
        picksTraded: 0,
      },
    };
    const pos = layout(graph, "band");
    expect(pos.get("manager:a")).toEqual({ x: MANAGER_STRIP_X0, y: 0 });
    expect(pos.get("manager:b")).toEqual({ x: MANAGER_STRIP_X0 + MANAGER_SLOT_WIDTH, y: 0 });
    expect(pos.get("manager:c")).toEqual({ x: MANAGER_STRIP_X0 + 2 * MANAGER_SLOT_WIDTH, y: 0 });
  });

  it("band: places assets in the correct season band (2024=band 1, 2025=band 2)", () => {
    const nodes = [mgr("a"), mgr("b"), mgr("c"), player("p1"), player("p2")];
    const edges: GraphEdge[] = [
      // p1 first seen in 2024 (band 1, y = BAND_HEIGHT).
      edge("e1", "manager:a", "player:p1", "2024", "t1"),
      // p2 first seen in 2025 (band 2, y = 2 * BAND_HEIGHT).
      edge("e2", "manager:b", "player:p2", "2025", "t2"),
    ];
    const graph: Graph = {
      nodes,
      edges,
      stats: {
        totalTrades: 0,
        totalDraftPicks: 0,
        totalEdges: 0,
        totalNodes: 5,
        multiHopChains: 0,
        picksTraded: 0,
      },
    };
    const pos = layout(graph, "band");

    // Managers at y=0.
    for (const id of ["manager:a", "manager:b", "manager:c"]) {
      expect(pos.get(id)?.y).toBe(0);
    }
    // p1 → band 1 (y = BAND_HEIGHT). Jitter 0 since first slot.
    expect(pos.get("player:p1")?.y).toBe(BAND_HEIGHT);
    // p2 → band 2 (y = 2 * BAND_HEIGHT). Jitter 0 — different band.
    expect(pos.get("player:p2")?.y).toBe(2 * BAND_HEIGHT);
  });

  it("band: deterministic — same input → identical positions on repeated runs", () => {
    const nodes = [mgr("a"), mgr("b"), player("p1"), pick("L1", "2025", 2, 3)];
    const edges: GraphEdge[] = [
      edge("e1", "manager:a", "player:p1", "2024", "t1"),
      edge("e2", "manager:b", "pick:L1:2025:2:3", "2024", "t2"),
    ];
    const graph: Graph = {
      nodes,
      edges,
      stats: {
        totalTrades: 0,
        totalDraftPicks: 0,
        totalEdges: 0,
        totalNodes: 4,
        multiHopChains: 0,
        picksTraded: 0,
      },
    };
    const a = layout(graph, "band");
    const b = layout(graph, "band");
    expect(a.size).toBe(b.size);
    for (const [id, pa] of a.entries()) {
      expect(b.get(id)).toEqual(pa);
    }
  });

  it("dagre: positions every node in a 3-node chain A→B→C with no coincident coordinates", () => {
    const a = mgr("a");
    const b = mgr("b");
    const c = mgr("c");
    const edges: GraphEdge[] = [
      edge("e-ab", "manager:a", "manager:b", "2024", "t1"),
      edge("e-bc", "manager:b", "manager:c", "2024", "t2"),
    ];
    const graph: Graph = {
      nodes: [a, b, c],
      edges,
      stats: {
        totalTrades: 0,
        totalDraftPicks: 0,
        totalEdges: 0,
        totalNodes: 3,
        multiHopChains: 0,
        picksTraded: 0,
      },
    };
    const pos = layout(graph, "dagre");
    expect(pos.size).toBe(3);
    const pa = pos.get("manager:a")!;
    const pb = pos.get("manager:b")!;
    const pc = pos.get("manager:c")!;
    expect(pa).toBeDefined();
    expect(pb).toBeDefined();
    expect(pc).toBeDefined();

    // With rankdir TB, A should be above B and B above C (strictly smaller y).
    expect(pa.y).toBeLessThan(pb.y);
    expect(pb.y).toBeLessThan(pc.y);

    // No two nodes should share the exact same (x, y).
    const serialized = [pa, pb, pc].map((p) => `${p.x},${p.y}`);
    expect(new Set(serialized).size).toBe(serialized.length);
  });

  it("dagre: deterministic for the same input", () => {
    const nodes = [mgr("a"), mgr("b"), player("p1")];
    const edges: GraphEdge[] = [
      edge("e1", "manager:a", "player:p1", "2024", "t1"),
      edge("e2", "player:p1", "manager:b", "2024", "t1"),
    ];
    const graph: Graph = {
      nodes,
      edges,
      stats: {
        totalTrades: 0,
        totalDraftPicks: 0,
        totalEdges: 0,
        totalNodes: 3,
        multiHopChains: 0,
        picksTraded: 0,
      },
    };
    const a = layout(graph, "dagre");
    const b = layout(graph, "dagre");
    for (const [id, pa] of a.entries()) {
      expect(b.get(id)).toEqual(pa);
    }
  });
});
