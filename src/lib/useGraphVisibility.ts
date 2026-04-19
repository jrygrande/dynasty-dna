import { useMemo } from "react";
import type { Graph, GraphEdge, GraphNode } from "./assetGraph";

export interface VisibilityState {
  seed: string[];
  expanded: Set<string>;
  removed: Set<string>;
}

export interface Visibility {
  visibleNodes: GraphNode[];
  visibleEdges: GraphEdge[];
  isExpanded: (nodeId: string) => boolean;
  isSeed: (nodeId: string) => boolean;
}

const EMPTY: Visibility = {
  visibleNodes: [],
  visibleEdges: [],
  isExpanded: () => false,
  isSeed: () => false,
};

export function useGraphVisibility(
  graph: Graph | null,
  { seed, expanded, removed }: VisibilityState,
): Visibility {
  return useMemo<Visibility>(() => {
    if (!graph) return EMPTY;

    const seedSet = new Set(seed);

    const adjacency = new Map<string, string[]>();
    for (const e of graph.edges) {
      let a = adjacency.get(e.source);
      if (!a) {
        a = [];
        adjacency.set(e.source, a);
      }
      a.push(e.target);
      let b = adjacency.get(e.target);
      if (!b) {
        b = [];
        adjacency.set(e.target, b);
      }
      b.push(e.source);
    }

    const visible = new Set<string>(seedSet);
    for (const nodeId of expanded) {
      const neighbors = adjacency.get(nodeId);
      if (!neighbors) continue;
      for (const nid of neighbors) visible.add(nid);
      visible.add(nodeId);
    }

    for (const id of removed) visible.delete(id);

    const visibleNodes = graph.nodes
      .filter((n) => visible.has(n.id))
      .map((n) => ({ ...n, layout: undefined }));

    const visibleEdges = graph.edges.filter(
      (e) => visible.has(e.source) && visible.has(e.target),
    );

    return {
      visibleNodes,
      visibleEdges,
      isExpanded: (id) => expanded.has(id),
      isSeed: (id) => seedSet.has(id),
    };
  }, [graph, seed, expanded, removed]);
}
