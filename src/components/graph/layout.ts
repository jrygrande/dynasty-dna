/**
 * Asset Graph Browser — temporal layout.
 *
 * Transaction nodes are placed left-to-right by (season, week, createdAt).
 * Within a time column, nodes stack vertically deterministically.
 * Current-roster pseudo-nodes sit in a column to the far right.
 *
 * Layout is pure and deterministic: same input → same positions. Safe to run
 * in Node or the browser.
 */

import type { Graph, GraphNode } from "@/lib/assetGraph";

export type LayoutMode = "band" | "dagre";

const COLUMN_WIDTH = 320;
const ROW_HEIGHT = 280;
const COLUMN_X0 = 80;
const ROW_Y0 = 40;
const CURRENT_ROSTER_GAP = 120;

type Pos = { x: number; y: number };

export function layout(
  graph: Pick<Graph, "nodes" | "edges">,
  _mode: LayoutMode = "band",
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
  // the same week stack vertically.
  const columnKey = (n: Extract<GraphNode, { kind: "transaction" }>) =>
    `${n.season}-${String(n.week).padStart(3, "0")}`;

  const columns = new Map<string, Array<Extract<GraphNode, { kind: "transaction" }>>>();
  for (const n of transactions) {
    const key = columnKey(n);
    const arr = columns.get(key) ?? [];
    arr.push(n);
    columns.set(key, arr);
  }

  const sortedKeys = Array.from(columns.keys()).sort();
  let maxX = COLUMN_X0;
  sortedKeys.forEach((key, colIdx) => {
    const entries = columns.get(key)!;
    const x = COLUMN_X0 + colIdx * COLUMN_WIDTH;
    maxX = Math.max(maxX, x);
    entries.forEach((n, rowIdx) => {
      positions.set(n.id, { x, y: ROW_Y0 + rowIdx * ROW_HEIGHT });
    });
  });

  // Current-roster nodes sit one column past the last transaction, stacked by
  // display name for stability.
  const currentX = maxX + COLUMN_WIDTH + CURRENT_ROSTER_GAP;
  currentRosters
    .slice()
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
    .forEach((n, i) => {
      positions.set(n.id, { x: currentX, y: ROW_Y0 + i * ROW_HEIGHT });
    });

  return positions;
}
