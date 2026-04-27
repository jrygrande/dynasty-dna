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

// Card width is 260; same-lane neighbors need this full separation so
// they don't overlap visually.
const COLUMN_WIDTH = 270;
// Cross-lane neighbors live on different y bands, so they can be much
// closer horizontally — gives a "staircase" overlap that consolidates
// the canvas without losing chronological direction.
const COMPRESSED_GAP = 150;
const ROW_HEIGHT = 200;
// Card height (collapsed) is ~140px; LANE_GAP at 240 leaves ~100px gap
// between bands for edge routing while compacting the vertical span.
const LANE_GAP = 240;
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
  // transaction. Pin them all to the same x at the right edge so they
  // form a clean right-edge anchor. Lane still drives y so each
  // manager's roster aligns vertically with its branch.
  // -------------------------------------------------------------------------
  let globalMaxX = COLUMN_X0;
  for (const pos of positions.values()) {
    if (pos.x > globalMaxX) globalMaxX = pos.x;
  }
  const rosterX = globalMaxX + COLUMN_WIDTH;

  const sortedRosters = [...currentRosters].sort((a, b) =>
    a.displayName.localeCompare(b.displayName),
  );
  const rosterStackByLane = new Map<number, number>();
  for (const n of sortedRosters) {
    const lane = lanes?.get(n.id) ?? 0;
    const stackIdx = rosterStackByLane.get(lane) ?? 0;
    rosterStackByLane.set(lane, stackIdx + 1);
    positions.set(n.id, {
      x: rosterX,
      y: ROW_Y0 + lane * LANE_GAP + stackIdx * ROW_HEIGHT,
    });
  }
  void priorPositions;

  return positions;
}

type TxNode = Extract<GraphNode, { kind: "transaction" }>;

/**
 * Place transactions on a global chronological grid with VARIABLE column
 * gaps. Each unique `createdAt` becomes a timepoint with a single x.
 * Adjacent timepoints whose cards live on different lanes (no shared
 * lane) get a tighter `COMPRESSED_GAP`; same-lane neighbors get the
 * full `COLUMN_WIDTH` so they don't overlap on the same y. The
 * cumulative x is then anchored on the seed transaction so its column
 * sits at COLUMN_X0.
 *
 * A safety constraint enforces that any two timepoints whose lane sets
 * share a lane are at least `COLUMN_WIDTH` apart, so non-adjacent
 * same-lane cards can't end up overlapping after compression.
 */
function placeByLane(
  transactions: TxNode[],
  lanes: Map<string, number>,
  seedIds: string[],
  out: Map<string, Pos>,
): void {
  const seedSet = new Set(seedIds);
  const sorted = [...transactions].sort(compareTx);

  const sortedTimes = [...new Set(sorted.map((n) => n.createdAt))].sort(
    (a, b) => a - b,
  );

  // For each timepoint, the set of lanes that have cards at that time.
  const lanesByTime = new Map<number, Set<number>>();
  for (const n of sorted) {
    let set = lanesByTime.get(n.createdAt);
    if (!set) { set = new Set(); lanesByTime.set(n.createdAt, set); }
    set.add(lanes.get(n.id) ?? 0);
  }

  // Cumulative x for each timepoint, with variable gap rule:
  //  - same-lane neighbor (any prior lane appears at this time too) → COLUMN_WIDTH
  //  - else → COMPRESSED_GAP
  // Then enforce that any same-lane pair across non-adjacent timepoints
  // still has ≥ COLUMN_WIDTH between them.
  const xByTime = new Map<number, number>();
  // Track each lane's last placed timepoint for the COLUMN_WIDTH safety check.
  const lastTimeByLane = new Map<number, number>();

  for (let i = 0; i < sortedTimes.length; i++) {
    const t = sortedTimes[i];
    if (i === 0) {
      xByTime.set(t, 0);
      for (const lane of lanesByTime.get(t) ?? []) lastTimeByLane.set(lane, t);
      continue;
    }
    const prevT = sortedTimes[i - 1];
    const prevLanes = lanesByTime.get(prevT) ?? new Set<number>();
    const currLanes = lanesByTime.get(t) ?? new Set<number>();
    const sharedAdjacent = [...currLanes].some((l) => prevLanes.has(l));
    const baseGap = sharedAdjacent ? COLUMN_WIDTH : COMPRESSED_GAP;

    let x = (xByTime.get(prevT) ?? 0) + baseGap;

    // Safety: ensure ≥ COLUMN_WIDTH from the most recent same-lane timepoint.
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
  const seedX = xByTime.get(seedT ?? 0) ?? 0;

  // Place each card.
  const stackByTimeLane = new Map<string, number>();
  for (const n of sorted) {
    const lane = lanes.get(n.id) ?? 0;
    const key = `${n.createdAt}|${lane}`;
    const stackIdx = stackByTimeLane.get(key) ?? 0;
    stackByTimeLane.set(key, stackIdx + 1);
    const x = COLUMN_X0 + ((xByTime.get(n.createdAt) ?? 0) - seedX);
    out.set(n.id, {
      x,
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
