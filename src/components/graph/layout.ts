/**
 * Asset Graph Browser — temporal layout with lane-aware vertical positioning.
 *
 * Each transaction node gets its own column, placed left-to-right in strict
 * chronological order (by createdAt). When lane assignments are provided,
 * nodes in different lanes get different y-bands so asset threads branch
 * vertically from the seed trade.
 *
 * If two nodes share the exact same createdAt (same transaction), they share
 * a column and stack vertically within their lane.
 *
 * Current-roster pseudo-nodes sit in a column to the far right.
 *
 * Layout is pure and deterministic: same input → same positions.
 */

import type { Graph, GraphNode } from "@/lib/assetGraph";

export type LayoutMode = "band" | "dagre";

const COLUMN_WIDTH = 320;
const ROW_HEIGHT = 280;
const LANE_GAP = 300;
const COLUMN_X0 = 80;
const ROW_Y0 = 40;
const CURRENT_ROSTER_GAP = 120;

type Pos = { x: number; y: number };

export function layout(
  graph: Pick<Graph, "nodes" | "edges">,
  _mode: LayoutMode = "band",
  lanes?: Map<string, number>,
): Map<string, Pos> {
  const positions = new Map<string, Pos>();
  if (graph.nodes.length === 0) return positions;

  const transactions = graph.nodes.filter(
    (n): n is Extract<GraphNode, { kind: "transaction" }> => n.kind === "transaction",
  );
  const currentRosters = graph.nodes.filter(
    (n): n is Extract<GraphNode, { kind: "current_roster" }> => n.kind === "current_roster",
  );

  // Sort transactions strictly by createdAt for chronological column order.
  transactions.sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
    if (a.season !== b.season) return a.season.localeCompare(b.season);
    if (a.week !== b.week) return a.week - b.week;
    return a.id.localeCompare(b.id);
  });

  // Assign column indices: each unique createdAt gets its own column.
  // Events with the same createdAt share a column (stack vertically).
  const colByCreatedAt = new Map<number, number>();
  let nextCol = 0;
  for (const n of transactions) {
    if (!colByCreatedAt.has(n.createdAt)) {
      colByCreatedAt.set(n.createdAt, nextCol++);
    }
  }

  // Place each node: x from column index, y from lane + stacking.
  // Track per-(column, lane) stacking for nodes sharing a column.
  const stackCount = new Map<string, number>();
  let maxX = COLUMN_X0;

  for (const n of transactions) {
    const colIdx = colByCreatedAt.get(n.createdAt) ?? 0;
    const lane = lanes?.get(n.id) ?? 0;
    const stackKey = `${colIdx}|${lane}`;
    const rowIdx = stackCount.get(stackKey) ?? 0;
    stackCount.set(stackKey, rowIdx + 1);

    const x = COLUMN_X0 + colIdx * COLUMN_WIDTH;
    const laneY = lane * LANE_GAP;
    maxX = Math.max(maxX, x);
    positions.set(n.id, { x, y: ROW_Y0 + laneY + rowIdx * ROW_HEIGHT });
  }

  // Current-roster nodes sit one column past the last transaction.
  const currentX = maxX + COLUMN_WIDTH + CURRENT_ROSTER_GAP;
  const rostersByLane = new Map<number, Array<Extract<GraphNode, { kind: "current_roster" }>>>();
  for (const n of currentRosters) {
    const lane = lanes?.get(n.id) ?? 0;
    const arr = rostersByLane.get(lane) ?? [];
    arr.push(n);
    rostersByLane.set(lane, arr);
  }
  for (const [lane, rosters] of rostersByLane) {
    rosters.sort((a, b) => a.displayName.localeCompare(b.displayName));
    rosters.forEach((n, i) => {
      const laneY = lane * LANE_GAP;
      positions.set(n.id, { x: currentX, y: ROW_Y0 + laneY + i * ROW_HEIGHT });
    });
  }

  return positions;
}
