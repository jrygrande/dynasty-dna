/**
 * Lane assignment for thread-aware layout.
 *
 * Each expanded asset thread gets its own horizontal "lane" (y-band).
 * Seed nodes sit in lane 0. ALL nodes in an expanded asset's thread
 * are assigned to that asset's lane — the entire chain shares a y-band.
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

  // Index edges by asset key for full-thread lookup.
  const edgesByAsset = new Map<string, GraphEdge[]>();
  for (const e of edges) {
    const aKey = edgeAssetKey(e);
    if (!aKey) continue;
    let arr = edgesByAsset.get(aKey);
    if (!arr) { arr = []; edgesByAsset.set(aKey, arr); }
    arr.push(e);
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

  // Assign ALL nodes in each expanded asset's thread to that lane.
  for (const assetKey of assetKeyOrder) {
    const lane = laneByAssetKey.get(assetKey) ?? 0;
    const threadEdges = edgesByAsset.get(assetKey) ?? [];
    for (const e of threadEdges) {
      if (!lanes.has(e.source)) lanes.set(e.source, lane);
      if (!lanes.has(e.target)) lanes.set(e.target, lane);
    }
  }

  return lanes;
}
