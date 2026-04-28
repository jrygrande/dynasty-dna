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
  const effectiveTime = effectiveCreatedAt(transactions, graph.edges);
  const maxTransactionX = placeByLane(transactions, laneMap, seedIds ?? [], effectiveTime, positions);

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
  effectiveTime: Map<string, number>,
  out: Map<string, Pos>,
): number {
  if (transactions.length === 0) return COLUMN_X0;

  const seedSet = new Set(seedIds);
  const timeOf = (n: TxNode): number => effectiveTime.get(n.id) ?? n.createdAt;
  const sorted = [...transactions].sort((a, b) => compareTx(a, b, timeOf));

  // Single pass: collect unique timepoints (in sorted order) AND the set of
  // lanes touching each timepoint.
  const sortedTimes: number[] = [];
  const lanesByTime = new Map<number, Set<number>>();
  for (const n of sorted) {
    const t = timeOf(n);
    let set = lanesByTime.get(t);
    if (!set) {
      set = new Set();
      lanesByTime.set(t, set);
      sortedTimes.push(t);
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
  const seedT = seedTx ? timeOf(seedTx) : sortedTimes[0];
  const seedX = xByTime.get(seedT) ?? 0;

  // Place each card and track the rightmost x as we go.
  let maxX = COLUMN_X0;
  const stackByTimeLane = new Map<string, number>();
  for (const n of sorted) {
    const lane = lanes.get(n.id) ?? 0;
    const t = timeOf(n);
    const key = `${t}|${lane}`;
    const stackIdx = stackByTimeLane.get(key) ?? 0;
    stackByTimeLane.set(key, stackIdx + 1);
    const x = COLUMN_X0 + ((xByTime.get(t) ?? 0) - seedX);
    out.set(n.id, { x, y: ROW_Y0 + lane * LANE_GAP + stackIdx * ROW_HEIGHT });
    if (x > maxX) maxX = x;
  }
  return maxX;
}

/**
 * Compute an effective `createdAt` per transaction that respects edge
 * direction. Sleeper occasionally records pick_trade transactions with a
 * `created_at` after the draft's start_time (commissioner approval lands
 * during/after the draft), which would visually place the trade card to the
 * right of the draft it feeds. This propagation pulls every source's
 * effective time strictly below its target's, in BFS order from sinks.
 */
function effectiveCreatedAt(
  transactions: TxNode[],
  edges: Graph["edges"],
): Map<string, number> {
  const time = new Map<string, number>();
  for (const n of transactions) time.set(n.id, n.createdAt);

  // Adjacency: node id -> outgoing edges' target ids (transactions only).
  const txIds = new Set(time.keys());
  const outgoing = new Map<string, string[]>();
  for (const e of edges) {
    if (!txIds.has(e.source) || !txIds.has(e.target)) continue;
    let arr = outgoing.get(e.source);
    if (!arr) { arr = []; outgoing.set(e.source, arr); }
    arr.push(e.target);
  }

  // Iterate to fixpoint. Each pass shrinks any source whose time isn't
  // strictly less than every reachable target. Bound iterations defensively.
  const MAX_ITER = 16;
  for (let i = 0; i < MAX_ITER; i++) {
    let changed = false;
    for (const [src, targets] of outgoing) {
      const ts = time.get(src);
      if (ts == null) continue;
      let earliestTarget = Infinity;
      for (const tgt of targets) {
        const tt = time.get(tgt);
        if (tt != null && tt < earliestTarget) earliestTarget = tt;
      }
      if (earliestTarget !== Infinity && ts >= earliestTarget) {
        time.set(src, earliestTarget - 1);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return time;
}

function compareTx(a: TxNode, b: TxNode, timeOf: (n: TxNode) => number): number {
  const ta = timeOf(a);
  const tb = timeOf(b);
  if (ta !== tb) return ta - tb;
  if (a.season !== b.season) return a.season.localeCompare(b.season);
  if (a.week !== b.week) return a.week - b.week;
  return a.id.localeCompare(b.id);
}
