/**
 * @jest-environment node
 *
 * Layout invariants for the dagre-driven graph layout. These guard the
 * "qualities" called out by issue #76:
 *   - chronological flow within a thread (source.x < target.x for every
 *     tenure edge),
 *   - deterministic output (same input → same positions),
 *   - reasonable compactness on graph sizes seen in the reference
 *     scenarios (up to 27 nodes for `saquon-deep`).
 */

import type { GraphEdge, GraphNode } from "@/lib/assetGraph";
import { layout, nodeDimensions } from "../layout";

// Minimal ambient declarations so this file typechecks before
// @types/jest is installed (mirrors src/lib/__tests__/analytics.test.ts).
declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (value: unknown) => {
  toBe: (expected: unknown) => void;
  toBeLessThan: (expected: number) => void;
  toBeGreaterThanOrEqual: (expected: number) => void;
  toBeLessThanOrEqual: (expected: number) => void;
};

function tx(id: string, assetCount = 1): GraphNode {
  return {
    id,
    kind: "transaction",
    txKind: "trade",
    transactionId: id.replace(/^tx:/, ""),
    leagueId: "L",
    season: "2024",
    week: 1,
    createdAt: 0,
    managers: [{ userId: "u1", displayName: "u1" }],
    assets: Array.from({ length: assetCount }, (_, i) => ({
      kind: "player",
      playerId: `p${i}`,
      playerName: `P${i}`,
      playerPosition: "WR",
      playerTeam: null,
      toUserId: "u1",
      fromUserId: null,
    })),
  };
}

function draft(id: string): GraphNode {
  return {
    id,
    kind: "transaction",
    txKind: "draft",
    transactionId: null,
    leagueId: "L",
    season: "2024",
    week: 0,
    createdAt: 0,
    managers: [{ userId: "u1", displayName: "u1" }],
    assets: [
      {
        kind: "player",
        playerId: "p0",
        playerName: "P0",
        playerPosition: "WR",
        playerTeam: null,
        toUserId: "u1",
        fromUserId: null,
      },
    ],
  };
}

function roster(id: string): GraphNode {
  return {
    id,
    kind: "current_roster",
    userId: id.replace(/^current:/, ""),
    displayName: "manager",
    avatar: null,
  };
}

function playerEdge(id: string, source: string, target: string): GraphEdge {
  return {
    id,
    source,
    target,
    managerUserId: "u1",
    managerName: "u1",
    assetKind: "player",
    playerId: "p0",
    playerName: "P0",
    playerPosition: "WR",
    playerTeam: null,
    pickSeason: null,
    pickRound: null,
    pickOriginalRosterId: null,
    pickLabel: null,
    startSeason: "2024",
    startWeek: 1,
    endSeason: null,
    endWeek: null,
    isOpen: target.startsWith("current:"),
  };
}

describe("layout (dagre)", () => {
  it("returns an empty map for an empty graph", () => {
    const positions = layout({ nodes: [], edges: [] });
    expect(positions.size).toBe(0);
  });

  it("places source strictly left of target for every tenure edge", () => {
    // Linear chain: draft → trade → trade → roster
    const nodes: GraphNode[] = [
      draft("draft:1"),
      tx("tx:2"),
      tx("tx:3"),
      roster("current:R1"),
    ];
    const edges: GraphEdge[] = [
      playerEdge("e1", "draft:1", "tx:2"),
      playerEdge("e2", "tx:2", "tx:3"),
      playerEdge("e3", "tx:3", "current:R1"),
    ];
    const positions = layout({ nodes, edges });
    for (const e of edges) {
      const s = positions.get(e.source);
      const t = positions.get(e.target);
      expect(Boolean(s && t)).toBe(true);
      expect((s!.x)).toBeLessThan(t!.x);
    }
  });

  it("is deterministic — same input produces the same positions", () => {
    const nodes: GraphNode[] = [
      draft("draft:1"),
      tx("tx:2", 2),
      tx("tx:3", 3),
      tx("tx:4", 1),
      roster("current:R1"),
      roster("current:R2"),
    ];
    const edges: GraphEdge[] = [
      playerEdge("e1", "draft:1", "tx:2"),
      playerEdge("e2", "tx:2", "tx:3"),
      playerEdge("e3", "tx:3", "tx:4"),
      playerEdge("e4", "tx:2", "current:R2"),
      playerEdge("e5", "tx:4", "current:R1"),
    ];
    const a = layout({ nodes, edges });
    const b = layout({ nodes, edges });
    expect(a.size).toBe(b.size);
    for (const [id, pos] of a) {
      const other = b.get(id);
      expect(Boolean(other)).toBe(true);
      expect(other!.x).toBe(pos.x);
      expect(other!.y).toBe(pos.y);
    }
  });

  it("preserves chronological flow when many threads merge", () => {
    // Two parallel threads sharing one trade — like scenario-2 where the
    // seed transaction sits at the chain's apex with multiple incoming
    // and outgoing tenures.
    const nodes: GraphNode[] = [
      draft("draft:1"),
      draft("draft:2"),
      tx("tx:trade", 4),
      tx("tx:later1", 2),
      tx("tx:later2", 2),
      roster("current:R1"),
      roster("current:R2"),
    ];
    const edges: GraphEdge[] = [
      playerEdge("e1", "draft:1", "tx:trade"),
      playerEdge("e2", "draft:2", "tx:trade"),
      playerEdge("e3", "tx:trade", "tx:later1"),
      playerEdge("e4", "tx:trade", "tx:later2"),
      playerEdge("e5", "tx:later1", "current:R1"),
      playerEdge("e6", "tx:later2", "current:R2"),
    ];
    const positions = layout({ nodes, edges });
    for (const e of edges) {
      const s = positions.get(e.source);
      const t = positions.get(e.target);
      expect((s!.x)).toBeLessThan(t!.x);
    }
  });

  it("survives the saquon-deep stress test (27 nodes) with bounded width", () => {
    // Linear backbone: every transaction passes its asset to the next.
    // 22 transactions + 5 rosters = 27 nodes. Mirrors scenario-4's size
    // without claiming to reproduce its exact topology.
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    for (let i = 0; i < 22; i++) {
      nodes.push(i === 0 ? draft(`draft:${i}`) : tx(`tx:${i}`, 2));
      if (i > 0) {
        edges.push(
          playerEdge(`e${i}`, i === 1 ? `draft:0` : `tx:${i - 1}`, `tx:${i}`),
        );
      }
    }
    for (let r = 0; r < 5; r++) {
      const id = `current:R${r}`;
      nodes.push(roster(id));
      // Each roster anchored to a different point on the backbone.
      const sourceIdx = 4 + r * 4;
      const source = sourceIdx === 0 ? "draft:0" : `tx:${sourceIdx}`;
      edges.push(playerEdge(`er${r}`, source, id));
    }

    const positions = layout({ nodes, edges });
    expect(positions.size).toBe(nodes.length);
    for (const e of edges) {
      const s = positions.get(e.source);
      const t = positions.get(e.target);
      expect((s!.x)).toBeLessThan(t!.x);
    }
    // Compactness: 22-step backbone × ~340px per column ≈ 7500px upper
    // bound. The reference scenario-4 manual layout spans ~3800px wide;
    // this synthetic backbone has no parallelism, so a tighter bound is
    // unrealistic. We just guard against runaway stretching.
    let minX = Infinity;
    let maxX = -Infinity;
    for (const p of positions.values()) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
    }
    expect(maxX - minX).toBeLessThanOrEqual(8000);
  });

  it("matches obstacle dimensions to layout dimensions", () => {
    // Both code paths funnel through `nodeDimensions` so an expanded card
    // can't overlap edges that the layout thought were clear.
    const node = tx("tx:1", 4);
    const collapsedDim = nodeDimensions(node, { assetRows: 1 });
    const expandedDim = nodeDimensions(node, { assetRows: 4 });
    expect(expandedDim.height > collapsedDim.height).toBe(true);
    expect(expandedDim.width).toBe(collapsedDim.width);
  });
});
