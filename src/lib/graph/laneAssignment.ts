/**
 * Lane assignment for thread-aware layout.
 *
 * Each expanded asset thread gets its own horizontal "lane" (y-band).
 * Seed nodes sit in lane 0. Nodes revealed by expanding an asset row
 * are assigned to that asset's lane. If a node belongs to multiple
 * threads (shared transaction), it goes in the lowest-numbered lane.
 *
 * Returns a Map<nodeId, laneIndex> where lane 0 is the seed lane
 * and other lanes fan out: 1, -1, 2, -2, ... (alternating above/below).
 */

import type { GraphEdge } from "@/lib/assetGraph";
import { edgeAssetKey } from "@/lib/useGraphVisibility";

/**
 * Assign each visible node to a lane based on which expansion made it visible.
 *
 * @param seedIds - Node IDs that are seeds (always lane 0)
 * @param expanded - The expansion entries set (e.g. "nodeId~assetKey")
 * @param edges - All visible edges
 * @returns Map from nodeId to lane index (0 = center, positive = below, negative = above)
 */
export function assignLanes(
  seedIds: string[],
  expanded: Set<string>,
  edges: GraphEdge[],
): Map<string, number> {
  const lanes = new Map<string, number>();

  // Seeds are always lane 0.
  for (const id of seedIds) {
    lanes.set(id, 0);
  }

  if (expanded.size === 0) return lanes;

  // Index edges by node id for fast lookup.
  const edgesByNode = new Map<string, GraphEdge[]>();
  for (const e of edges) {
    let s = edgesByNode.get(e.source);
    if (!s) { s = []; edgesByNode.set(e.source, s); }
    s.push(e);
    if (e.target !== e.source) {
      let t = edgesByNode.get(e.target);
      if (!t) { t = []; edgesByNode.set(e.target, t); }
      t.push(e);
    }
  }

  // Collect unique asset keys from expansion entries, in order.
  const assetKeyOrder: string[] = [];
  const seen = new Set<string>();
  for (const entry of expanded) {
    const sep = entry.indexOf("~");
    if (sep === -1) continue;
    const assetKey = entry.slice(sep + 1);
    if (!seen.has(assetKey)) {
      seen.add(assetKey);
      assetKeyOrder.push(assetKey);
    }
  }

  // Assign lane indices: alternate above/below the seed lane.
  // First expansion → lane 1, second → lane -1, third → lane 2, etc.
  const laneByAssetKey = new Map<string, number>();
  assetKeyOrder.forEach((key, i) => {
    const half = Math.floor(i / 2) + 1;
    const lane = i % 2 === 0 ? half : -half;
    laneByAssetKey.set(key, lane);
  });

  // For each expansion entry, trace which nodes belong to that asset's thread.
  for (const entry of expanded) {
    const sep = entry.indexOf("~");
    if (sep === -1) continue;
    const nodeId = entry.slice(0, sep);
    const assetKey = entry.slice(sep + 1);
    const lane = laneByAssetKey.get(assetKey) ?? 0;

    // Find all edges incident to nodeId matching this asset key.
    const incident = edgesByNode.get(nodeId) ?? [];
    for (const e of incident) {
      if (edgeAssetKey(e) !== assetKey) continue;
      // The other endpoint of this edge goes into this lane (if not already in a closer-to-center lane).
      const other = e.source === nodeId ? e.target : e.source;
      if (!lanes.has(other)) {
        lanes.set(other, lane);
      }
    }

    // The expanded node itself belongs in this lane too (if not a seed).
    if (!lanes.has(nodeId)) {
      lanes.set(nodeId, lane);
    }
  }

  return lanes;
}
