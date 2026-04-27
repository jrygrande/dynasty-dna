/**
 * Lane assignment for thread-aware layout.
 *
 * Each visible asset thread (seed asset + every entry in `expanded`) gets
 * its own horizontal "lane" (y-band). Lanes are anchored on the *seed
 * asset*: that thread sits at lane 0, and other threads spread above
 * (negative) or below (positive) by the row distance from the seed asset
 * on the seed transaction card.
 *
 * Concretely, with N visible threads and the seed asset at row index R
 * on the seed card, a thread whose asset is at row index r gets
 * `lane = r − R`. Top-of-card threads sit above the seed line; bottom-of-
 * card threads sit below.
 *
 * Returns Map<nodeId, laneIndex>. First-thread-wins for nodes that
 * appear in multiple threads.
 */

import type { GraphEdge, GraphNode, TransactionNode } from "@/lib/assetGraph";
import { edgeAssetKey } from "@/lib/useGraphVisibility";

export function assignLanes(
  seedIds: string[],
  expanded: Set<string>,
  edges: GraphEdge[],
  nodes?: GraphNode[],
  seedAssetKey?: string,
): Map<string, number> {
  const lanes = new Map<string, number>();

  // Seeds always at lane 0.
  for (const id of seedIds) lanes.set(id, 0);

  // Index edges by asset key for thread lookup.
  const edgesByAsset = new Map<string, GraphEdge[]>();
  for (const e of edges) {
    const aKey = edgeAssetKey(e);
    if (!aKey) continue;
    let arr = edgesByAsset.get(aKey);
    if (!arr) { arr = []; edgesByAsset.set(aKey, arr); }
    arr.push(e);
  }

  // Build the visible-thread list: seed asset is implicit (auto-expanded);
  // explicit `expanded` entries follow.
  const visibleAssetKeys: string[] = [];
  const seen = new Set<string>();
  if (seedAssetKey) {
    visibleAssetKeys.push(seedAssetKey);
    seen.add(seedAssetKey);
  }
  for (const entry of expanded) {
    const sep = entry.indexOf("~");
    if (sep === -1) continue;
    const assetKey = entry.slice(sep + 1);
    if (!seen.has(assetKey)) {
      seen.add(assetKey);
      visibleAssetKeys.push(assetKey);
    }
  }

  if (visibleAssetKeys.length === 0) return lanes;

  // Sort threads by their visual row position on the seed card so the
  // lane stack mirrors the asset list (top of card → top of canvas).
  const seedNode = nodes?.find(
    (n): n is TransactionNode => n.kind === "transaction" && seedIds.includes(n.id),
  );
  const seedAssetOrder = seedNode ? buildSeedAssetVisualOrder(seedNode) : new Map<string, number>();
  // Pre-compute insertion-order index so the comparator stays O(1) per
  // call instead of O(n) via `indexOf`.
  const insertionIdx = new Map(visibleAssetKeys.map((k, i) => [k, i]));
  const orderedKeys = visibleAssetKeys.slice().sort((a, b) => {
    const aIdx = seedAssetOrder.get(a) ?? Number.POSITIVE_INFINITY;
    const bIdx = seedAssetOrder.get(b) ?? Number.POSITIVE_INFINITY;
    if (aIdx !== bIdx) return aIdx - bIdx;
    return (insertionIdx.get(a) ?? 0) - (insertionIdx.get(b) ?? 0);
  });

  // Sequential lane assignment anchored on the seed asset. Use position
  // within `orderedKeys` (already sorted by seed-card row), not row index
  // directly, so unexpanded rows don't leave vertical gaps between visible
  // threads. With seed asset at sorted position S:
  //   key at sorted i  →  lane = i − S
  // Top-most expanded thread → most negative lane; seed asset → 0; below → positive.
  const seedSortedIdx =
    seedAssetKey != null ? orderedKeys.indexOf(seedAssetKey) : -1;
  const anchorIdx =
    seedSortedIdx >= 0 ? seedSortedIdx : Math.floor((orderedKeys.length - 1) / 2);

  for (let i = 0; i < orderedKeys.length; i++) {
    const aKey = orderedKeys[i];
    const lane = i - anchorIdx;
    const threadEdges = edgesByAsset.get(aKey) ?? [];
    for (const e of threadEdges) {
      if (!lanes.has(e.source)) lanes.set(e.source, lane);
      if (!lanes.has(e.target)) lanes.set(e.target, lane);
    }
  }

  // Auto-trace: for each draft node that's been lane-assigned via a pick
  // thread, the player drafted by that pick should continue on the SAME
  // lane (so the pick → trades → draft → player → roster lineage flows
  // as one band). Mirrors the auto-trace logic in useGraphVisibility.
  if (nodes) {
    for (const node of nodes) {
      if (node.kind !== "transaction") continue;
      if (node.txKind !== "draft") continue;
      const draftLane = lanes.get(node.id);
      if (draftLane == null) continue;
      for (const asset of node.assets) {
        if (asset.kind !== "player" || !asset.playerId) continue;
        const playerKey = `player:${asset.playerId}`;
        const playerEdges = edgesByAsset.get(playerKey) ?? [];
        for (const e of playerEdges) {
          if (!lanes.has(e.source)) lanes.set(e.source, draftLane);
          if (!lanes.has(e.target)) lanes.set(e.target, draftLane);
        }
      }
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
  type Asset = TransactionNode["assets"][number];
  const buckets = new Map<string, Asset[]>();
  for (const a of node.assets) {
    const key = a.toUserId ?? "__none__";
    let arr = buckets.get(key);
    if (!arr) { arr = []; buckets.set(key, arr); }
    arr.push(a);
  }
  for (const arr of buckets.values()) arr.sort(compareAssets);

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
