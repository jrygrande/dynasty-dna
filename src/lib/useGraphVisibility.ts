import { useMemo } from "react";
import type { Graph, GraphEdge, GraphNode } from "./assetGraph";

/**
 * Expansion entries:
 *   - "nodeId"                — legacy whole-node expansion (all neighbors)
 *   - "nodeId~player:<id>"    — expose this player's tenure edges incident to nodeId
 *   - "nodeId~pick:<leagueId>:<season>:<round>:<origRoster>" — same for picks
 *
 * The asset-keyed form reveals ONLY the tenure edges for that asset incident
 * to the node (both directions), not every neighbor. This supports the
 * "click asset row to trace its thread" interaction.
 */
export interface VisibilityState {
  seed: string[];
  expanded: Set<string>;
  removed: Set<string>;
  /** Asset key (e.g. "player:1234") of the originally-seeded asset, used to
   * compute which assets are "in-chain" at the seed node. */
  seedAssetKey?: string;
}

export interface Visibility {
  visibleNodes: GraphNode[];
  visibleEdges: GraphEdge[];
  isExpanded: (nodeId: string) => boolean;
  isAssetExpanded: (nodeId: string, assetKey: string) => boolean;
  isSeed: (nodeId: string) => boolean;
  /** For each visible transaction node, the set of asset keys that are in
   * the active chain (either the seed asset at the seed node, or assets on
   * incident expanded edges). */
  chainAssetsByNode: Map<string, Set<string>>;
}

const EMPTY: Visibility = {
  visibleNodes: [],
  visibleEdges: [],
  isExpanded: () => false,
  isAssetExpanded: () => false,
  isSeed: () => false,
  chainAssetsByNode: new Map(),
};

/** Compute the asset key for an edge (matches URL encoding used by asset-row clicks). */
export function edgeAssetKey(edge: GraphEdge): string {
  if (edge.assetKind === "player" && edge.playerId) return `player:${edge.playerId}`;
  if (
    edge.assetKind === "pick" &&
    edge.pickSeason !== null &&
    edge.pickRound !== null &&
    edge.pickOriginalRosterId !== null
  ) {
    // leagueId isn't on the edge directly — we rely on the event's pick tuple being
    // unique within the family for the scope of rendering. Encode what we have.
    return `pick:${edge.pickSeason}:${edge.pickRound}:${edge.pickOriginalRosterId}`;
  }
  return "";
}

export function useGraphVisibility(
  graph: Graph | null,
  { seed, expanded, removed, seedAssetKey }: VisibilityState,
): Visibility {
  return useMemo<Visibility>(() => {
    if (!graph) return EMPTY;

    const seedSet = new Set(seed);

    // Index edges by node id for fast incidence lookup.
    const edgesByNode = new Map<string, GraphEdge[]>();
    // Index edges by asset key for full-thread expansion.
    const edgesByAsset = new Map<string, GraphEdge[]>();
    for (const e of graph.edges) {
      let s = edgesByNode.get(e.source);
      if (!s) {
        s = [];
        edgesByNode.set(e.source, s);
      }
      s.push(e);
      if (e.target !== e.source) {
        let t = edgesByNode.get(e.target);
        if (!t) {
          t = [];
          edgesByNode.set(e.target, t);
        }
        t.push(e);
      }
      const aKey = edgeAssetKey(e);
      if (aKey) {
        let a = edgesByAsset.get(aKey);
        if (!a) {
          a = [];
          edgesByAsset.set(aKey, a);
        }
        a.push(e);
      }
    }

    const visible = new Set<string>(seedSet);
    const visibleEdgeIds = new Set<string>();

    // Seed nodes are always visible. For seed nodes, we also expose every
    // tenure edge incident to them (so a seed of [tradeNode, rosterNode]
    // naturally draws the tenure between them).
    for (const id of seedSet) {
      const incident = edgesByNode.get(id) ?? [];
      for (const e of incident) {
        if (seedSet.has(e.source) && seedSet.has(e.target)) {
          visibleEdgeIds.add(e.id);
        }
      }
    }

    // Track the set of asset keys that are "expanded" (full-thread) for chain
    // computation. Whole-node expansion entries don't contribute here.
    const expandedAssetKeySet = new Set<string>();

    for (const entry of expanded) {
      const sepIdx = entry.indexOf("~");
      if (sepIdx === -1) {
        // Whole-node expansion: add all neighbors.
        const incident = edgesByNode.get(entry) ?? [];
        for (const e of incident) {
          visible.add(e.source);
          visible.add(e.target);
          visibleEdgeIds.add(e.id);
        }
        visible.add(entry);
        continue;
      }
      // Per-asset expansion: nodeId ~ assetKey
      // Reveal ALL edges for this asset across the entire graph (full thread).
      const assetKey = entry.slice(sepIdx + 1);
      expandedAssetKeySet.add(assetKey);
      const matching = edgesByAsset.get(assetKey) ?? [];
      for (const e of matching) {
        visible.add(e.source);
        visible.add(e.target);
        visibleEdgeIds.add(e.id);
      }
    }

    for (const id of removed) visible.delete(id);

    const visibleNodes = graph.nodes
      .filter((n) => visible.has(n.id))
      .map((n) => ({ ...n, layout: undefined }));

    const visibleEdges = graph.edges.filter(
      (e) =>
        visibleEdgeIds.has(e.id) &&
        visible.has(e.source) &&
        visible.has(e.target),
    );

    // Compute chain-relevant asset keys per visible transaction node.
    // - Seed node: include the seed asset key (if defined).
    // - Any node: include each incident visible-edge's asset key whose
    //   thread is currently expanded.
    const chainAssetsByNode = new Map<string, Set<string>>();
    for (const n of visibleNodes) {
      if (n.kind !== "transaction") continue;
      const set = new Set<string>();
      if (seedSet.has(n.id) && seedAssetKey) set.add(seedAssetKey);
      chainAssetsByNode.set(n.id, set);
    }
    for (const e of visibleEdges) {
      const aKey = edgeAssetKey(e);
      if (!aKey || !expandedAssetKeySet.has(aKey)) continue;
      for (const nid of [e.source, e.target]) {
        const set = chainAssetsByNode.get(nid);
        if (set) set.add(aKey);
      }
    }

    return {
      visibleNodes,
      visibleEdges,
      isExpanded: (id) => expanded.has(id),
      isAssetExpanded: (nodeId, assetKey) => expanded.has(`${nodeId}~${assetKey}`),
      isSeed: (id) => seedSet.has(id),
      chainAssetsByNode,
    };
  }, [graph, seed, expanded, removed, seedAssetKey]);
}
