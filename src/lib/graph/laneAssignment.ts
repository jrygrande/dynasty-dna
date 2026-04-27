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

  // Each unique expanded asset gets its own lane (vertical band). Lanes
  // alternate around the seed: 0, +1, -1, +2, -2, … so multiple expanded
  // threads spread above and below the seed line. The first thread to
  // claim a node wins (subsequent threads passing through that node
  // don't relocate it).
  for (let i = 0; i < assetKeyOrder.length; i++) {
    const lane = laneIndexFor(i);
    const threadEdges = edgesByAsset.get(assetKeyOrder[i]) ?? [];
    for (const e of threadEdges) {
      if (!lanes.has(e.source)) lanes.set(e.source, lane);
      if (!lanes.has(e.target)) lanes.set(e.target, lane);
    }
  }

  return lanes;
}

/** Lane indices in fan order: 0, +1, -1, +2, -2, +3, -3, … */
function laneIndexFor(i: number): number {
  if (i === 0) return 0;
  const half = Math.ceil(i / 2);
  return i % 2 === 1 ? half : -half;
}
