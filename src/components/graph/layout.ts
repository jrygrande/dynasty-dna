/**
 * Asset Graph Browser — temporal layout with anchor-relative placement.
 *
 * Two modes, gated on whether `priorPositions` is provided:
 *
 *  1. Initial layout (no prior positions): each unique transaction `createdAt`
 *     gets its own column, placed left-to-right. Same-`createdAt` events stack
 *     within the column. Current-roster pseudo-nodes pin to the far-right
 *     column.
 *
 *  2. Subsequent layout (prior positions present): existing nodes stay where
 *     they were. New nodes are placed adjacent to a "spawn parent" — an
 *     existing node they share an edge with — fanning vertically around the
 *     parent for siblings. A collision pass shifts overlapping new nodes down.
 *     Current-roster nodes still pin to the far-right column so they remain
 *     structural anchors.
 *
 * Layout is pure and deterministic: same input → same positions.
 */

import type { Graph, GraphNode } from "@/lib/assetGraph";

export type LayoutMode = "band" | "dagre";

const COLUMN_WIDTH = 320;
const ROW_HEIGHT = 200;
const COLUMN_X0 = 80;
const ROW_Y0 = 40;
const CURRENT_ROSTER_GAP = 120;

// Card bounding-box estimate used for the collision pass on newly-placed
// nodes. Real cards vary (collapsed vs expanded), but this is a conservative
// rectangle that lines up with `obstacleRects` in AssetGraph.tsx.
const CARD_WIDTH = 260;
const CARD_HEIGHT = 200;

export type Pos = { x: number; y: number };

export function layout(
  graph: Pick<Graph, "nodes" | "edges">,
  _mode: LayoutMode = "band",
  // `lanes` is retained for backwards compatibility but unused by the new
  // anchor-relative algorithm; the per-asset-row handle routing in
  // routeEdgePath.ts handles thread separation visually.
  _lanes?: Map<string, number>,
  priorPositions?: Map<string, Pos>,
): Map<string, Pos> {
  const positions = new Map<string, Pos>();
  if (graph.nodes.length === 0) return positions;

  const transactions = graph.nodes.filter(
    (n): n is Extract<GraphNode, { kind: "transaction" }> => n.kind === "transaction",
  );
  const currentRosters = graph.nodes.filter(
    (n): n is Extract<GraphNode, { kind: "current_roster" }> => n.kind === "current_roster",
  );

  const hasPrior = priorPositions !== undefined && priorPositions.size > 0;

  if (!hasPrior) {
    // ---------------------------------------------------------------------
    // Initial layout: chronological columns.
    // ---------------------------------------------------------------------
    placeChronologicalColumns(transactions, positions);
  } else {
    // ---------------------------------------------------------------------
    // Subsequent layout: anchor-relative.
    // ---------------------------------------------------------------------

    // 1. Carry over prior positions for nodes still present.
    const priorIds = new Set<string>();
    for (const n of transactions) {
      const prior = priorPositions.get(n.id);
      if (prior) {
        positions.set(n.id, { x: prior.x, y: prior.y });
        priorIds.add(n.id);
      }
    }

    // 2. Identify new transaction nodes.
    const newNodes = transactions.filter((n) => !priorIds.has(n.id));

    // 3. Resolve a spawn parent for each new node — the prior-positioned
    //    neighbor it shares an edge with. First-edge-match (the v1 simple
    //    rule); BFS-from-seed could refine this but isn't needed for the
    //    typical "click +" interaction where the parent is the only prior
    //    neighbor.
    const spawnParentByNew = new Map<string, string>();
    const unanchored: typeof newNodes = [];
    for (const n of newNodes) {
      let parentId: string | undefined;
      for (const e of graph.edges) {
        if (e.source === n.id && priorIds.has(e.target)) { parentId = e.target; break; }
        if (e.target === n.id && priorIds.has(e.source)) { parentId = e.source; break; }
      }
      if (parentId) {
        spawnParentByNew.set(n.id, parentId);
      } else {
        unanchored.push(n);
      }
    }

    // 4. Group new nodes by spawn parent + direction, fan vertically.
    type Bucket = { parentId: string; right: typeof newNodes; left: typeof newNodes };
    const buckets = new Map<string, Bucket>();
    const nodeById = new Map(transactions.map((n) => [n.id, n] as const));

    for (const n of newNodes) {
      const parentId = spawnParentByNew.get(n.id);
      if (!parentId) continue;
      const parent = nodeById.get(parentId);
      if (!parent) continue;
      let bucket = buckets.get(parentId);
      if (!bucket) {
        bucket = { parentId, right: [], left: [] };
        buckets.set(parentId, bucket);
      }
      if (n.createdAt > parent.createdAt) bucket.right.push(n);
      else bucket.left.push(n);
    }

    for (const bucket of buckets.values()) {
      const parentPos = positions.get(bucket.parentId);
      if (!parentPos) continue;
      bucket.right.sort(compareTransactionNodes);
      bucket.left.sort(compareTransactionNodes);

      placeFan(bucket.right, parentPos, COLUMN_WIDTH, positions);
      placeFan(bucket.left, parentPos, -COLUMN_WIDTH, positions);
    }

    // 5. Collision pass: push newly-placed nodes down until they clear
    //    everything already placed. Existing-prior-positioned nodes are not
    //    moved; later iterations treat earlier newcomers as fixed obstacles.
    const newlyPlaced = newNodes
      .filter((n) => positions.has(n.id))
      .sort(compareTransactionNodes);
    const placedRects = Array.from(positions, ([id, p]) => ({ id, x: p.x, y: p.y }));
    for (const n of newlyPlaced) {
      let pos = positions.get(n.id);
      if (!pos) continue;
      let safety = 0;
      while (collides(pos, placedRects, n.id) && safety < 50) {
        pos = { x: pos.x, y: pos.y + ROW_HEIGHT };
        safety++;
      }
      positions.set(n.id, pos);
      const idx = placedRects.findIndex((r) => r.id === n.id);
      if (idx >= 0) placedRects[idx] = { id: n.id, x: pos.x, y: pos.y };
    }

    // 6. Unanchored new nodes (no edge to a prior node) → fall back to the
    //    chronological-column algorithm so they at least land somewhere
    //    reasonable. This is rare in practice (only happens if the visibility
    //    layer surfaces an island).
    if (unanchored.length > 0) {
      const fallback = new Map<string, Pos>();
      placeChronologicalColumns(unanchored, fallback);
      for (const [id, p] of fallback) {
        if (!positions.has(id)) positions.set(id, p);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Current-roster nodes: pin to one column past the rightmost transaction.
  // Same in both initial and subsequent layouts.
  // -------------------------------------------------------------------------
  let maxX = COLUMN_X0;
  for (const p of positions.values()) {
    if (p.x > maxX) maxX = p.x;
  }
  const currentX = maxX + COLUMN_WIDTH + CURRENT_ROSTER_GAP;

  // Preserve prior positions for current_roster nodes — they shouldn't jump
  // just because a new transaction column was added. Place fresh ones into
  // the next-available row slot to avoid stacking on existing rosters.
  const sortedRosters = [...currentRosters].sort((a, b) =>
    a.displayName.localeCompare(b.displayName),
  );
  let nextRosterRow = 0;
  for (const n of sortedRosters) {
    const prior = priorPositions?.get(n.id);
    if (prior) {
      positions.set(n.id, { x: prior.x, y: prior.y });
    } else {
      positions.set(n.id, { x: currentX, y: ROW_Y0 + nextRosterRow * ROW_HEIGHT });
      nextRosterRow++;
    }
  }

  return positions;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type TxNode = Extract<GraphNode, { kind: "transaction" }>;

function compareTransactionNodes(a: TxNode, b: TxNode): number {
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return a.id.localeCompare(b.id);
}

function placeChronologicalColumns(
  transactions: TxNode[],
  out: Map<string, Pos>,
): void {
  const sorted = [...transactions].sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
    if (a.season !== b.season) return a.season.localeCompare(b.season);
    if (a.week !== b.week) return a.week - b.week;
    return a.id.localeCompare(b.id);
  });

  const colByCreatedAt = new Map<number, number>();
  let nextCol = 0;
  for (const n of sorted) {
    if (!colByCreatedAt.has(n.createdAt)) {
      colByCreatedAt.set(n.createdAt, nextCol++);
    }
  }

  const stackCount = new Map<number, number>();
  for (const n of sorted) {
    const colIdx = colByCreatedAt.get(n.createdAt) ?? 0;
    const rowIdx = stackCount.get(colIdx) ?? 0;
    stackCount.set(colIdx, rowIdx + 1);
    out.set(n.id, {
      x: COLUMN_X0 + colIdx * COLUMN_WIDTH,
      y: ROW_Y0 + rowIdx * ROW_HEIGHT,
    });
  }
}

/**
 * Place children fanned vertically around `parentPos`, all sharing the same
 * x-offset. Order: 0, +1, -1, +2, -2, ... (centered on the parent).
 */
function placeFan(
  children: TxNode[],
  parentPos: Pos,
  dx: number,
  out: Map<string, Pos>,
): void {
  for (let i = 0; i < children.length; i++) {
    const sign = i === 0 ? 0 : i % 2 === 1 ? 1 : -1;
    const magnitude = Math.ceil(i / 2);
    const yOffset = sign * magnitude * ROW_HEIGHT;
    out.set(children[i].id, {
      x: parentPos.x + dx,
      y: parentPos.y + yOffset,
    });
  }
}

/** True if `pos` overlaps any rect in `rects` (excluding the rect with `selfId`). */
function collides(
  pos: Pos,
  rects: Array<{ id: string; x: number; y: number }>,
  selfId: string,
): boolean {
  for (const r of rects) {
    if (r.id === selfId) continue;
    const overlapsX = pos.x < r.x + CARD_WIDTH && pos.x + CARD_WIDTH > r.x;
    const overlapsY = pos.y < r.y + CARD_HEIGHT && pos.y + CARD_HEIGHT > r.y;
    if (overlapsX && overlapsY) return true;
  }
  return false;
}
