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
 * Current-roster pseudo-nodes are conceptually dated "today"; they pin
 * to a single rightmost x and inherit their connecting thread's lane.
 *
 * Smooth motion across renders is the responsibility of
 * `useGraphPositionTween` — layout itself stays pure and deterministic.
 */

import type { Graph, GraphNode } from "@/lib/assetGraph";

export type LayoutMode = "band" | "dagre";

// Card width is 260; same-lane neighbors need this full separation so
// they don't overlap visually.
const COLUMN_WIDTH = 270;
// Cross-lane neighbors live on different y bands, so they can be much
// closer horizontally — gives a "staircase" overlap that consolidates
// the canvas without losing chronological direction.
const COMPRESSED_GAP = 150;
const ROW_HEIGHT = 200;
const LANE_GAP = 240;
const COLUMN_X0 = 80;
const ROW_Y0 = 40;

export type Pos = { x: number; y: number };

export function layout(
  graph: Pick<Graph, "nodes" | "edges">,
  lanes?: Map<string, number>,
  seedIds?: string[],
): Map<string, Pos> {
  const positions = new Map<string, Pos>();
  if (graph.nodes.length === 0) return positions;

  const transactions: TxNode[] = [];
  const currentRosters: Extract<GraphNode, { kind: "current_roster" }>[] = [];
  for (const n of graph.nodes) {
    if (n.kind === "transaction") transactions.push(n);
    else if (n.kind === "current_roster") currentRosters.push(n);
  }

  const laneMap = lanes ?? new Map<string, number>();
  const maxTransactionX = placeByLane(transactions, laneMap, seedIds ?? [], positions);

  // Current-roster nodes pin to a single x past the rightmost transaction.
  // Lane drives y so each manager's roster aligns with its connecting thread.
  const rosterX = maxTransactionX + COLUMN_WIDTH;
  const sortedRosters = [...currentRosters].sort((a, b) =>
    a.displayName.localeCompare(b.displayName),
  );
  const rosterStackByLane = new Map<number, number>();
  for (const n of sortedRosters) {
    const lane = laneMap.get(n.id) ?? 0;
    const stackIdx = rosterStackByLane.get(lane) ?? 0;
    rosterStackByLane.set(lane, stackIdx + 1);
    positions.set(n.id, {
      x: rosterX,
      y: ROW_Y0 + lane * LANE_GAP + stackIdx * ROW_HEIGHT,
    });
  }

  return positions;
}

type TxNode = Extract<GraphNode, { kind: "transaction" }>;

/**
 * Place transactions on a global chronological grid with VARIABLE column
 * gaps. Each unique `createdAt` becomes a timepoint with a single x.
 * Adjacent timepoints whose cards share a lane get full `COLUMN_WIDTH`
 * separation so they don't visually overlap; cross-lane neighbors get
 * the tighter `COMPRESSED_GAP`. A non-adjacent same-lane pair is also
 * forced to ≥ `COLUMN_WIDTH` apart so compression can't sneak past.
 *
 * The seed transaction's column anchors x=COLUMN_X0 — older cards land
 * left, newer right. Returns the rightmost x placed (for the roster
 * column anchor in the caller).
 */
function placeByLane(
  transactions: TxNode[],
  lanes: Map<string, number>,
  seedIds: string[],
  out: Map<string, Pos>,
): number {
  if (transactions.length === 0) return COLUMN_X0;

  const seedSet = new Set(seedIds);
  const sorted = [...transactions].sort(compareTx);

  // Single pass: collect unique createdAts (in sorted order) AND the set of
  // lanes touching each timepoint.
  const sortedTimes: number[] = [];
  const lanesByTime = new Map<number, Set<number>>();
  for (const n of sorted) {
    let set = lanesByTime.get(n.createdAt);
    if (!set) {
      set = new Set();
      lanesByTime.set(n.createdAt, set);
      sortedTimes.push(n.createdAt);
    }
    set.add(lanes.get(n.id) ?? 0);
  }

  // Cumulative x for each timepoint with variable-gap rules.
  const xByTime = new Map<number, number>();
  const lastTimeByLane = new Map<number, number>();
  for (let i = 0; i < sortedTimes.length; i++) {
    const t = sortedTimes[i];
    const currLanes = lanesByTime.get(t) as Set<number>;
    if (i === 0) {
      xByTime.set(t, 0);
      for (const lane of currLanes) lastTimeByLane.set(lane, t);
      continue;
    }
    const prevT = sortedTimes[i - 1];
    const prevLanes = lanesByTime.get(prevT) as Set<number>;
    let sharedAdjacent = false;
    for (const l of currLanes) {
      if (prevLanes.has(l)) { sharedAdjacent = true; break; }
    }
    let x = (xByTime.get(prevT) ?? 0) + (sharedAdjacent ? COLUMN_WIDTH : COMPRESSED_GAP);

    // Non-adjacent same-lane pairs must still be ≥ COLUMN_WIDTH apart.
    for (const lane of currLanes) {
      const lastT = lastTimeByLane.get(lane);
      if (lastT == null) continue;
      const minX = (xByTime.get(lastT) ?? 0) + COLUMN_WIDTH;
      if (x < minX) x = minX;
    }

    xByTime.set(t, x);
    for (const lane of currLanes) lastTimeByLane.set(lane, t);
  }

  // Anchor x=COLUMN_X0 on the seed transaction's timepoint.
  const seedTx = sorted.find((n) => seedSet.has(n.id));
  const seedT = seedTx?.createdAt ?? sortedTimes[0];
  const seedX = xByTime.get(seedT) ?? 0;

  // Place each card and track the rightmost x as we go.
  let maxX = COLUMN_X0;
  const stackByTimeLane = new Map<string, number>();
  for (const n of sorted) {
    const lane = lanes.get(n.id) ?? 0;
    const key = `${n.createdAt}|${lane}`;
    const stackIdx = stackByTimeLane.get(key) ?? 0;
    stackByTimeLane.set(key, stackIdx + 1);
    const x = COLUMN_X0 + ((xByTime.get(n.createdAt) ?? 0) - seedX);
    out.set(n.id, { x, y: ROW_Y0 + lane * LANE_GAP + stackIdx * ROW_HEIGHT });
    if (x > maxX) maxX = x;
  }
  return maxX;
}

function compareTx(a: TxNode, b: TxNode): number {
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  if (a.season !== b.season) return a.season.localeCompare(b.season);
  if (a.week !== b.week) return a.week - b.week;
  return a.id.localeCompare(b.id);
}
