/**
 * Spawn-parent resolution for newly-revealed graph nodes.
 *
 * When the user expands a chain, new nodes appear connected to nodes that
 * were already on screen. Their "spawn parent" is the prior-rendered node
 * they share an edge with — used by both the layout (for anchor-relative
 * placement) and the tween hook (so new cards launch from the parent's
 * current position rather than fading in at their target).
 */

import type { GraphEdge, GraphNode } from "@/lib/assetGraph";

export function deriveSpawnParents(
  nodes: GraphNode[],
  edges: GraphEdge[],
  priorIds: Set<string>,
): Map<string, string> {
  const result = new Map<string, string>();
  for (const n of nodes) {
    if (priorIds.has(n.id)) continue;
    for (const e of edges) {
      if (e.source === n.id && priorIds.has(e.target)) {
        result.set(n.id, e.target);
        break;
      }
      if (e.target === n.id && priorIds.has(e.source)) {
        result.set(n.id, e.source);
        break;
      }
    }
  }
  return result;
}
