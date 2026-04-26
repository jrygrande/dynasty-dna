/**
 * Asset Graph Browser — temporal layout with lane-aware vertical positioning.
 *
 * Transaction nodes are placed left-to-right by (season, week, createdAt).
 * When lane assignments are provided, nodes in different lanes get different
 * y-bands so asset threads branch vertically from the seed trade.
 * Current-roster pseudo-nodes sit in a column to the far right.
 *
 * Layout is pure and deterministic: same input → same positions. Safe to run
 * in Node or the browser.
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

  // Sort transactions by time and assign column indices.
  transactions.sort((a, b) => {
    if (a.season !== b.season) return a.season.localeCompare(b.season);
    if (a.week !== b.week) return a.week - b.week;
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
    return a.id.localeCompare(b.id);
  });

  // Group into time-columns keyed by (season, week). Multiple transactions in
  // the same week stack vertically within their lane.
  const columnKey = (n: Extract<GraphNode, { kind: "transaction" }>) =>
    `${n.season}-${String(n.week).padStart(3, "0")}`;

  // Group by (columnKey, lane) for fine-grained stacking.
  const cellKey = (colKey: string, lane: number) => `${colKey}|${lane}`;
  const cells = new Map<string, Array<Extract<GraphNode, { kind: "transaction" }>>>();
  const columnKeys = new Set<string>();

  for (const n of transactions) {
    const col = columnKey(n);
    columnKeys.add(col);
    const lane = lanes?.get(n.id) ?? 0;
    const key = cellKey(col, lane);
    const arr = cells.get(key) ?? [];
    arr.push(n);
    cells.set(key, arr);
  }

  const sortedCols = Array.from(columnKeys).sort();
  let maxX = COLUMN_X0;

  sortedCols.forEach((col, colIdx) => {
    const x = COLUMN_X0 + colIdx * COLUMN_WIDTH;
    maxX = Math.max(maxX, x);

    // Get all lanes used in this column.
    const lanesInCol = new Set<number>();
    for (const [key] of cells) {
      if (key.startsWith(col + "|")) {
        lanesInCol.add(Number(key.split("|")[1]));
      }
    }

    for (const lane of lanesInCol) {
      const entries = cells.get(cellKey(col, lane)) ?? [];
      entries.forEach((n, rowIdx) => {
        const laneY = lane * LANE_GAP;
        positions.set(n.id, { x, y: ROW_Y0 + laneY + rowIdx * ROW_HEIGHT });
      });
    }
  });

  // Current-roster nodes sit one column past the last transaction.
  // Place them in their lane if assigned, otherwise stack by name.
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
