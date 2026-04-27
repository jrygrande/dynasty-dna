/**
 * Asset Graph Browser — chronological column layout.
 *
 * Each unique transaction `createdAt` gets its own column placed strictly
 * left-to-right. Same-`createdAt` events stack vertically within their
 * column. Current-roster pseudo-nodes pin to the column past the rightmost
 * transaction so they always sit as the right-edge anchor.
 *
 * Smooth motion across renders is the responsibility of `useGraphPositionTween`,
 * NOT the layout: when a new card slots into the chronological order between
 * two existing cards, the tween hook animates the existing cards' shift, and
 * new cards launch from their spawn parent's current position. Layout itself
 * stays pure and chronologically deterministic.
 */

import type { Graph, GraphNode } from "@/lib/assetGraph";

export type LayoutMode = "band" | "dagre";

const COLUMN_WIDTH = 320;
const ROW_HEIGHT = 200;
const COLUMN_X0 = 80;
const ROW_Y0 = 40;
const CURRENT_ROSTER_GAP = 120;

export type Pos = { x: number; y: number };

export function layout(
  graph: Pick<Graph, "nodes" | "edges">,
  _mode: LayoutMode = "band",
  _lanes?: Map<string, number>,
  // `priorPositions` is retained for API compatibility (and read by the
  // tween wiring), but the layout itself is purely chronological now —
  // smooth motion is the tween hook's job.
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

  placeChronologicalColumns(transactions, positions);

  // -------------------------------------------------------------------------
  // Current-roster nodes: pin to one column past the rightmost transaction.
  // Same in both initial and subsequent layouts.
  // -------------------------------------------------------------------------
  let maxX = COLUMN_X0;
  for (const p of positions.values()) {
    if (p.x > maxX) maxX = p.x;
  }
  const currentX = maxX + COLUMN_WIDTH + CURRENT_ROSTER_GAP;

  // Current-roster nodes always sit in the rightmost column — they're a
  // structural anchor, so they slide right when new transaction cards
  // extend the timeline. Preserve their y from prior positions so they
  // don't jump rows; fresh ones land in the next free row, skipping any
  // already-occupied slot.
  const sortedRosters = [...currentRosters].sort((a, b) =>
    a.displayName.localeCompare(b.displayName),
  );
  const occupiedYs = new Set<number>();
  for (const n of sortedRosters) {
    const prior = priorPositions?.get(n.id);
    if (prior) occupiedYs.add(Math.round(prior.y));
  }
  let nextRosterRow = 0;
  for (const n of sortedRosters) {
    const prior = priorPositions?.get(n.id);
    if (prior) {
      positions.set(n.id, { x: currentX, y: prior.y });
    } else {
      let y = ROW_Y0 + nextRosterRow * ROW_HEIGHT;
      while (occupiedYs.has(Math.round(y))) {
        nextRosterRow++;
        y = ROW_Y0 + nextRosterRow * ROW_HEIGHT;
      }
      positions.set(n.id, { x: currentX, y });
      occupiedYs.add(Math.round(y));
      nextRosterRow++;
    }
  }

  return positions;
}

type TxNode = Extract<GraphNode, { kind: "transaction" }>;

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
