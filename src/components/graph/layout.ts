/**
 * Asset Graph Browser — chronological columns × thread lanes.
 *
 * X: each unique transaction `createdAt` gets its own column placed
 * strictly left-to-right. Same-`createdAt` events stack within their
 * (column, lane) bucket.
 *
 * Y: derived from the lane index assigned by `assignLanes`. The seed
 * thread is lane 0 (centered); each additional expanded asset thread
 * gets +1 / −1 / +2 / −2 etc. so multiple threads fan vertically.
 *
 * Current-roster pseudo-nodes pin to the column past the rightmost
 * transaction and inherit the lane of the thread that connects to them
 * so each manager's roster aligns with its branch.
 *
 * Smooth motion across renders is the responsibility of
 * `useGraphPositionTween` — layout itself stays pure and deterministic.
 */

import type { Graph, GraphNode } from "@/lib/assetGraph";

export type LayoutMode = "band" | "dagre";

// COLUMN_WIDTH > card width (260) by enough to leave a gutter for edge
// routing without spreading the canvas needlessly. Tightened from 320.
const COLUMN_WIDTH = 280;
const ROW_HEIGHT = 200;
const LANE_GAP = 280;
const COLUMN_X0 = 80;
const ROW_Y0 = 40;
const CURRENT_ROSTER_GAP = 80;

export type Pos = { x: number; y: number };

export function layout(
  graph: Pick<Graph, "nodes" | "edges">,
  _mode: LayoutMode = "band",
  lanes?: Map<string, number>,
  // `priorPositions` is retained for API compatibility (and read by the
  // tween wiring), but the layout itself is purely chronological-by-lane
  // now — smooth motion is the tween hook's job.
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

  placeChronologicalColumns(transactions, lanes ?? new Map(), positions);

  // -------------------------------------------------------------------------
  // Current-roster nodes: pin to one column past the rightmost transaction.
  // Same in both initial and subsequent layouts.
  // -------------------------------------------------------------------------
  let maxX = COLUMN_X0;
  for (const p of positions.values()) {
    if (p.x > maxX) maxX = p.x;
  }
  const currentX = maxX + COLUMN_WIDTH + CURRENT_ROSTER_GAP;

  // Current-roster nodes sit in the rightmost column and inherit the lane
  // of the thread that connects to them, so each manager's roster aligns
  // vertically with the branch that ends at it. Within a lane, multiple
  // rosters stack by ROW_HEIGHT.
  const sortedRosters = [...currentRosters].sort((a, b) =>
    a.displayName.localeCompare(b.displayName),
  );
  const rosterStackByLane = new Map<number, number>();
  for (const n of sortedRosters) {
    const lane = lanes?.get(n.id) ?? 0;
    const stackIdx = rosterStackByLane.get(lane) ?? 0;
    rosterStackByLane.set(lane, stackIdx + 1);
    positions.set(n.id, {
      x: currentX,
      y: ROW_Y0 + lane * LANE_GAP + stackIdx * ROW_HEIGHT,
    });
  }
  // priorPositions intentionally unused now — lane-driven y is canonical
  // and the tween hook handles smooth transitions when a lane changes.
  void priorPositions;

  return positions;
}

type TxNode = Extract<GraphNode, { kind: "transaction" }>;

function placeChronologicalColumns(
  transactions: TxNode[],
  lanes: Map<string, number>,
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

  // Stack per (column, lane) so two threads at the same chronological
  // column don't pile on top of each other.
  const stackCount = new Map<string, number>();
  for (const n of sorted) {
    const colIdx = colByCreatedAt.get(n.createdAt) ?? 0;
    const lane = lanes.get(n.id) ?? 0;
    const stackKey = `${colIdx}|${lane}`;
    const rowIdx = stackCount.get(stackKey) ?? 0;
    stackCount.set(stackKey, rowIdx + 1);
    out.set(n.id, {
      x: COLUMN_X0 + colIdx * COLUMN_WIDTH,
      y: ROW_Y0 + lane * LANE_GAP + rowIdx * ROW_HEIGHT,
    });
  }
}
