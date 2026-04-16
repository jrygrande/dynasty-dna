"use client";

/**
 * DEV-ONLY graph fixture harness.
 *
 * This page lets the Module C author (and reviewers) see <AssetGraph/> rendering
 * against hardcoded fixtures without waiting for the real API (Module A). Module D
 * will delete this page or convert it to a Jest snapshot at merge time.
 */

import { useState } from "react";

import { AssetGraph } from "@/components/graph/AssetGraph";
import type {
  GraphEdge,
  GraphNode,
  GraphSelection,
} from "@/lib/assetGraph";
import { assetNodeId, managerNodeId } from "@/lib/assetGraph";

function mgr(userId: string, name: string): GraphNode {
  return {
    id: managerNodeId(userId),
    kind: "manager",
    userId,
    displayName: name,
    avatar: null,
    seasons: ["2024"],
    tradeCount: 0,
  };
}

function player(id: string, name: string, pos: string, team: string): GraphNode {
  return {
    id: assetNodeId({ kind: "player", playerId: id }),
    kind: "player",
    playerId: id,
    name,
    position: pos,
    team,
  };
}

function pick(
  leagueId: string,
  season: string,
  round: number,
  origRosterId: number,
  origOwnerName: string | null,
  resolvedPlayerName?: string,
): GraphNode {
  return {
    id: assetNodeId({
      kind: "pick",
      leagueId,
      pickSeason: season,
      pickRound: round,
      pickOriginalRosterId: origRosterId,
    }),
    kind: "pick",
    leagueId,
    pickSeason: season,
    pickRound: round,
    pickOriginalRosterId: origRosterId,
    pickOriginalOwnerUserId: null,
    pickOriginalOwnerName: origOwnerName,
    resolvedPlayerName,
  };
}

function edge(
  id: string,
  source: string,
  target: string,
  kind: GraphEdge["kind"],
  transactionId: string | null,
  season = "2024",
): GraphEdge {
  return {
    id,
    source,
    target,
    kind,
    season,
    week: 1,
    createdAt: null,
    transactionId,
    groupKey: transactionId ?? `g:${id}`,
  };
}

// ---- Fixture 1: 3-manager trade with 2 players + 1 pick --------------------
const FIX_1 = (() => {
  const A = mgr("u1", "Alice");
  const B = mgr("u2", "Bob");
  const C = mgr("u3", "Carol");
  const pA = player("p1", "Josh Allen", "QB", "BUF");
  const pB = player("p2", "CeeDee Lamb", "WR", "DAL");
  const pk = pick("L1", "2025", 1, 4, "Dave");
  const tx = "T1";
  const nodes: GraphNode[] = [A, B, C, pA, pB, pk];
  const edges: GraphEdge[] = [
    edge("e1", A.id, pA.id, "trade_out", tx),
    edge("e2", pA.id, B.id, "trade_in", tx),
    edge("e3", B.id, pB.id, "trade_out", tx),
    edge("e4", pB.id, C.id, "trade_in", tx),
    edge("e5", C.id, pk.id, "pick_trade_out", tx),
    edge("e6", pk.id, A.id, "pick_trade_in", tx),
  ];
  return { nodes, edges };
})();

// ---- Fixture 2: Same pick traded then drafted (chain) ----------------------
const FIX_2 = (() => {
  const A = mgr("u1", "Alice");
  const B = mgr("u2", "Bob");
  const C = mgr("u3", "Carol");
  const drafted = player("p10", "Marvin Harrison Jr.", "WR", "ARI");
  const pk = pick("L1", "2024", 1, 2, "Alice", "Marvin Harrison Jr.");
  const tx1 = "T-first-trade";
  const tx2 = "T-second-trade";
  const nodes: GraphNode[] = [A, B, C, drafted, pk];
  const edges: GraphEdge[] = [
    // Trade 1: A trades pick to B.
    edge("e-a", A.id, pk.id, "pick_trade_out", tx1, "2023"),
    edge("e-b", pk.id, B.id, "pick_trade_in", tx1, "2023"),
    // Trade 2: B trades pick to C.
    edge("e-c", B.id, pk.id, "pick_trade_out", tx2, "2024"),
    edge("e-d", pk.id, C.id, "pick_trade_in", tx2, "2024"),
    // Draft: C uses the pick to select Marvin Harrison Jr.
    edge("e-e", C.id, drafted.id, "draft_selected_mgr", null, "2024"),
    edge("e-f", pk.id, drafted.id, "draft_selected_pick", null, "2024"),
  ];
  return { nodes, edges };
})();

// ---- Fixture 3: Focus-on-player subgraph (hops=1) --------------------------
const FIX_3 = (() => {
  const A = mgr("u1", "Alice");
  const B = mgr("u2", "Bob");
  const focal = player("p20", "Bijan Robinson", "RB", "ATL");
  const tx = "T-focus";
  const nodes: GraphNode[] = [A, B, focal];
  const edges: GraphEdge[] = [
    edge("e-1", A.id, focal.id, "trade_out", tx),
    edge("e-2", focal.id, B.id, "trade_in", tx),
  ];
  return { nodes, edges };
})();

export default function GraphDemoPage() {
  return (
    <div className="space-y-8 p-6">
      <p className="text-yellow-500">DEV-ONLY fixture harness — not shipped.</p>
      <h1 className="text-xl font-semibold">Asset Graph — component harness</h1>

      <FixtureSection title="Fixture 1 — 3-manager trade (2 players + 1 pick)" fixture={FIX_1} />
      <FixtureSection title="Fixture 2 — same pick traded then drafted (chain)" fixture={FIX_2} />
      <FixtureSection
        title="Fixture 3 — focus-on-player subgraph (hops=1)"
        fixture={FIX_3}
      />
    </div>
  );
}

interface FixtureSectionProps {
  title: string;
  fixture: { nodes: GraphNode[]; edges: GraphEdge[] };
}

function FixtureSection({ title, fixture }: FixtureSectionProps) {
  const [selection, setSelection] = useState<GraphSelection | null>(null);
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold">{title}</h2>
      <div className="h-[420px] w-full rounded-md border bg-card">
        <AssetGraph
          nodes={fixture.nodes}
          edges={fixture.edges}
          selection={selection}
          onSelect={setSelection}
          layoutMode="band"
        />
      </div>
      {selection ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Selected: {selection.type === "node" ? selection.nodeId : selection.edgeId}
        </p>
      ) : null}
    </section>
  );
}
