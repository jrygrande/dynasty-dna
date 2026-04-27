/**
 * Lane assignment for thread-aware layout.
 *
 * Each expanded asset thread gets its own horizontal "lane" (y-band).
 * Lane 0 is centered on the seed; lanes spread above (negative) and
 * below (positive) so multiple threads create a vertical fan.
 *
 * To prevent edge crossings, lane order mirrors the visual row order on
 * the seed card: an asset that's higher on the seed card gets a more
 * negative lane (rendered higher on the canvas).
 *
 * Returns a Map<nodeId, laneIndex>. Nodes in multiple threads keep the
 * lane of the first thread to claim them (first-thread-wins).
 */

import type { GraphEdge, GraphNode, TransactionNode } from "@/lib/assetGraph";
import { edgeAssetKey } from "@/lib/useGraphVisibility";

export function assignLanes(
  seedIds: string[],
  expanded: Set<string>,
  edges: GraphEdge[],
  nodes?: GraphNode[],
): Map<string, number> {
  const lanes = new Map<string, number>();

  // Seeds always at lane 0.
  for (const id of seedIds) lanes.set(id, 0);

  if (expanded.size === 0) return lanes;

  // Index edges by asset key for thread lookup.
  const edgesByAsset = new Map<string, GraphEdge[]>();
  for (const e of edges) {
    const aKey = edgeAssetKey(e);
    if (!aKey) continue;
    let arr = edgesByAsset.get(aKey);
    if (!arr) { arr = []; edgesByAsset.set(aKey, arr); }
    arr.push(e);
  }

  // Unique expanded asset keys, in URL insertion order.
  const expandedKeys: string[] = [];
  const seen = new Set<string>();
  for (const entry of expanded) {
    const sep = entry.indexOf("~");
    if (sep === -1) continue;
    const assetKey = entry.slice(sep + 1);
    if (!seen.has(assetKey)) {
      seen.add(assetKey);
      expandedKeys.push(assetKey);
    }
  }

  // Sort expanded keys by their visual row position on the seed card so the
  // top-most asset row gets the top-most (most negative) lane and lines
  // don't have to cross. Falls back to URL insertion order for any expanded
  // asset that isn't on the seed card (rare).
  const seedNode = nodes?.find(
    (n): n is TransactionNode => n.kind === "transaction" && seedIds.includes(n.id),
  );
  const seedAssetOrder = seedNode ? buildSeedAssetVisualOrder(seedNode) : new Map<string, number>();
  const orderedKeys = expandedKeys.slice().sort((a, b) => {
    const aIdx = seedAssetOrder.get(a) ?? Number.POSITIVE_INFINITY;
    const bIdx = seedAssetOrder.get(b) ?? Number.POSITIVE_INFINITY;
    if (aIdx !== bIdx) return aIdx - bIdx;
    return expandedKeys.indexOf(a) - expandedKeys.indexOf(b);
  });

  // Lane index = visual row position − floor((N-1)/2). Centers the fan so
  // top assets are negative lanes (above seed) and bottom assets are
  // positive (below).
  const N = orderedKeys.length;
  const midOffset = Math.floor((N - 1) / 2);
  for (let i = 0; i < N; i++) {
    const lane = i - midOffset;
    const threadEdges = edgesByAsset.get(orderedKeys[i]) ?? [];
    for (const e of threadEdges) {
      if (!lanes.has(e.source)) lanes.set(e.source, lane);
      if (!lanes.has(e.target)) lanes.set(e.target, lane);
    }
  }

  return lanes;
}

/**
 * Visual asset row order on a transaction card. Mirrors the bucket
 * grouping + per-bucket sort done by `TransactionCardChrome`: assets are
 * grouped by recipient (insertion order); within each bucket players
 * come first (sorted by position then label), then picks (alphabetical).
 *
 * Returns Map<assetKey, rowIndex>.
 */
const POSITION_ORDER: Record<string, number> = {
  QB: 0, RB: 1, WR: 2, TE: 3, K: 4, DEF: 5,
};

function buildSeedAssetVisualOrder(node: TransactionNode): Map<string, number> {
  // Group assets by recipient bucket; preserve first-seen order.
  type Asset = TransactionNode["assets"][number];
  const buckets = new Map<string, Asset[]>();
  for (const a of node.assets) {
    const key = a.toUserId ?? "__none__";
    let arr = buckets.get(key);
    if (!arr) { arr = []; buckets.set(key, arr); }
    arr.push(a);
  }
  for (const arr of buckets.values()) arr.sort(compareAssets);

  // Flatten in bucket-iteration order, assigning sequential row indices.
  const order = new Map<string, number>();
  let idx = 0;
  for (const arr of buckets.values()) {
    for (const a of arr) {
      const key =
        a.kind === "player"
          ? `player:${a.playerId}`
          : `pick:${a.pickSeason}:${a.pickRound}:${a.pickOriginalRosterId}`;
      order.set(key, idx++);
    }
  }
  return order;
}

function compareAssets(a: TransactionNode["assets"][number], b: TransactionNode["assets"][number]): number {
  if (a.kind !== b.kind) return a.kind === "player" ? -1 : 1;
  if (a.kind === "player" && b.kind === "player") {
    const aP = POSITION_ORDER[a.playerPosition ?? ""] ?? 99;
    const bP = POSITION_ORDER[b.playerPosition ?? ""] ?? 99;
    if (aP !== bP) return aP - bP;
    return (a.playerName ?? "").localeCompare(b.playerName ?? "");
  }
  return (a.pickLabel ?? "").localeCompare(b.pickLabel ?? "");
}
