/**
 * Asset Graph Browser — per-lane chronological columns × thread lanes.
 *
 * Each lane (a horizontal y-band, assigned by `assignLanes`) maintains
 * its own column counter. Cards within a lane are placed chronologically
 * left-to-right with the seed at column 0; cards before the seed
 * chronologically (e.g. a player's draft) get negative column offsets,
 * cards after get positive. Lanes that don't pass through the seed
 * (rare — disconnected islands) are aligned chronologically against the
 * seed's `createdAt` so they slot into the global timeline.
 *
 * X: per-lane column index (NOT a global chronology). This collapses
 * unused horizontal space when threads have unrelated chronologies.
 * Y: lane * LANE_GAP, with per-(column, lane) stacking for collisions.
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
  // Current-roster nodes: pin to one column past the rightmost transaction
  // and inherit their connecting thread's lane.
  // -------------------------------------------------------------------------
  let maxX = COLUMN_X0;
  for (const p of positions.values()) {
    if (p.x > maxX) maxX = p.x;
  }
  const currentX = maxX + COLUMN_WIDTH + CURRENT_ROSTER_GAP;

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
  void priorPositions;

  return positions;
}

type TxNode = Extract<GraphNode, { kind: "transaction" }>;

/**
 * Place transactions per-lane: each lane gets its own chronological
 * column counter anchored on the seed. The seed sits at column 0 of its
 * own lane; lanes that pass through the seed too anchor at the seed's
 * lane index for that lane. Lanes without the seed fall back to the
 * seed's `createdAt` as the column-0 reference.
 */
function placeByLane(
  transactions: TxNode[],
  lanes: Map<string, number>,
  seedIds: string[],
  out: Map<string, Pos>,
): void {
  const seedSet = new Set(seedIds);
  const seedNode = transactions.find((n) => seedSet.has(n.id));
  const seedCreatedAt = seedNode?.createdAt ?? null;

  // Group transactions by lane.
  const byLane = new Map<number, TxNode[]>();
  for (const n of transactions) {
    const lane = lanes.get(n.id) ?? 0;
    let arr = byLane.get(lane);
    if (!arr) { arr = []; byLane.set(lane, arr); }
    arr.push(n);
  }

  for (const [lane, nodes] of byLane) {
    nodes.sort(compareTx);

    // Find the column-0 anchor for this lane:
    //  1. If the seed node is in this lane, use its index.
    //  2. Else, count nodes chronologically before the seed's createdAt
    //     so this lane slots into the global timeline at the seed's x.
    let anchorIdx: number;
    const seedIdxInLane = seedNode ? nodes.findIndex((n) => n.id === seedNode.id) : -1;
    if (seedIdxInLane >= 0) {
      anchorIdx = seedIdxInLane;
    } else if (seedCreatedAt != null) {
      anchorIdx = nodes.filter((n) => n.createdAt < seedCreatedAt).length;
    } else {
      anchorIdx = 0;
    }

    // Stack within (col, lane) for collisions on identical createdAt.
    const stackByCol = new Map<number, number>();
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const col = i - anchorIdx;
      const stackIdx = stackByCol.get(col) ?? 0;
      stackByCol.set(col, stackIdx + 1);
      out.set(n.id, {
        x: COLUMN_X0 + col * COLUMN_WIDTH,
        y: ROW_Y0 + lane * LANE_GAP + stackIdx * ROW_HEIGHT,
      });
    }
  }
}

function compareTx(a: TxNode, b: TxNode): number {
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  if (a.season !== b.season) return a.season.localeCompare(b.season);
  if (a.week !== b.week) return a.week - b.week;
  return a.id.localeCompare(b.id);
}
