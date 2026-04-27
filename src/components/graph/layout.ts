/**
 * Asset Graph Browser — global chronological columns × thread lanes.
 *
 * X: each unique transaction `createdAt` across all visible nodes gets a
 * single shared column. Cards on different lanes that share a `createdAt`
 * sit at the same x. This guarantees edges between lanes always flow
 * left→right by time (no "backward" lines).
 *
 * Y: derived from the lane index assigned by `assignLanes`. Sequential
 * lanes (0, +1, −1, +2, −2 …) produce vertical separation per thread.
 *
 * Current-roster pseudo-nodes pin to the column AFTER their lane's
 * rightmost transaction (per-lane, not global) so each manager's roster
 * sits compactly at the end of its branch instead of being pushed to
 * the global maxX.
 *
 * Smooth motion across renders is the responsibility of
 * `useGraphPositionTween` — layout itself stays pure and deterministic.
 */

import type { Graph, GraphNode } from "@/lib/assetGraph";

export type LayoutMode = "band" | "dagre";

// Card width is 260; this leaves a 10px gutter for edge routing while
// keeping the canvas as compact as possible.
const COLUMN_WIDTH = 270;
const ROW_HEIGHT = 200;
const LANE_GAP = 280;
const COLUMN_X0 = 80;
const ROW_Y0 = 40;

export type Pos = { x: number; y: number };

export function layout(
  graph: Pick<Graph, "nodes" | "edges">,
  _mode: LayoutMode = "band",
  lanes?: Map<string, number>,
  // `priorPositions` is retained for API compatibility (and read by the
  // tween wiring), but the layout itself is purely chronological-by-lane
  // now — smooth motion is the tween hook's job.
  priorPositions?: Map<string, Pos>,
  seedIds?: string[],
): Map<string, Pos> {
  const positions = new Map<string, Pos>();
  if (graph.nodes.length === 0) return positions;

  const transactions = graph.nodes.filter(
    (n): n is Extract<GraphNode, { kind: "transaction" }> => n.kind === "transaction",
  );
  const currentRosters = graph.nodes.filter(
    (n): n is Extract<GraphNode, { kind: "current_roster" }> => n.kind === "current_roster",
  );

  placeByLane(transactions, lanes ?? new Map(), seedIds ?? [], positions);

  // -------------------------------------------------------------------------
  // Current-roster nodes are conceptually dated "today" — newer than any
  // transaction. Pin them all to the same global rightmost column so they
  // form a clean right edge. Lane still drives y so each manager's roster
  // aligns vertically with its branch.
  // -------------------------------------------------------------------------
  let globalMaxCol = 0;
  for (const pos of positions.values()) {
    const col = Math.round((pos.x - COLUMN_X0) / COLUMN_WIDTH);
    if (col > globalMaxCol) globalMaxCol = col;
  }
  const rosterCol = globalMaxCol + 1;

  const sortedRosters = [...currentRosters].sort((a, b) =>
    a.displayName.localeCompare(b.displayName),
  );
  const rosterStackByLane = new Map<number, number>();
  for (const n of sortedRosters) {
    const lane = lanes?.get(n.id) ?? 0;
    const stackIdx = rosterStackByLane.get(lane) ?? 0;
    rosterStackByLane.set(lane, stackIdx + 1);
    positions.set(n.id, {
      x: COLUMN_X0 + rosterCol * COLUMN_WIDTH,
      y: ROW_Y0 + lane * LANE_GAP + stackIdx * ROW_HEIGHT,
    });
  }
  void priorPositions;

  return positions;
}

type TxNode = Extract<GraphNode, { kind: "transaction" }>;

/**
 * Place transactions on a GLOBAL chronological column grid: each unique
 * `createdAt` across all visible transactions gets one column. Cards in
 * different lanes that share a `createdAt` land at the same x (different
 * y). This guarantees edges flow left→right by time across lane changes.
 *
 * The seed transaction's column anchors x=COLUMN_X0 so older cards get
 * negative cols (left of seed) and newer get positive (right of seed).
 */
function placeByLane(
  transactions: TxNode[],
  lanes: Map<string, number>,
  seedIds: string[],
  out: Map<string, Pos>,
): void {
  const seedSet = new Set(seedIds);
  const sorted = [...transactions].sort(compareTx);

  // Assign one column per unique createdAt globally.
  const colByCreatedAt = new Map<number, number>();
  let nextCol = 0;
  for (const n of sorted) {
    if (!colByCreatedAt.has(n.createdAt)) {
      colByCreatedAt.set(n.createdAt, nextCol++);
    }
  }

  // Anchor x=COLUMN_X0 on the seed transaction's column so older cards
  // land at negative cols and newer at positive.
  const seedTx = sorted.find((n) => seedSet.has(n.id));
  const seedCol = seedTx ? colByCreatedAt.get(seedTx.createdAt) ?? 0 : 0;

  // Stack collisions within (col, lane) for cards sharing both.
  const stackByColLane = new Map<string, number>();
  for (const n of sorted) {
    const col = (colByCreatedAt.get(n.createdAt) ?? 0) - seedCol;
    const lane = lanes.get(n.id) ?? 0;
    const key = `${col}|${lane}`;
    const stackIdx = stackByColLane.get(key) ?? 0;
    stackByColLane.set(key, stackIdx + 1);
    out.set(n.id, {
      x: COLUMN_X0 + col * COLUMN_WIDTH,
      y: ROW_Y0 + lane * LANE_GAP + stackIdx * ROW_HEIGHT,
    });
  }
}

function compareTx(a: TxNode, b: TxNode): number {
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  if (a.season !== b.season) return a.season.localeCompare(b.season);
  if (a.week !== b.week) return a.week - b.week;
  return a.id.localeCompare(b.id);
}
