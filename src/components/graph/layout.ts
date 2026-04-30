/**
 * Asset Graph Browser — layered chronological layout via dagre.
 *
 * Tenure edges are direction-encoded by time: source = the transaction
 * that put a player/pick on a roster, target = the transaction that took
 * them off. So `source.createdAt < target.createdAt` always — that's why
 * a layered DAG layout is sufficient: dagre's longest-path ranker turns
 * the source-precedes-target invariant into a left-to-right time order
 * without us having to pass timestamps in.
 *
 * Smooth motion across renders is the responsibility of
 * `useGraphPositionTween` — layout itself stays pure.
 */

import dagre from "dagre";

import type { Graph, GraphNode } from "@/lib/assetGraph";

export type Pos = { x: number; y: number };

// Card dimensions are also consumed by the rendered components
// (TransactionCardChrome, CurrentRosterNode) so a width change here
// updates layout, edge-routing obstacles, and rendering atomically.
export const NODE_WIDTH = 260;
export const ROSTER_WIDTH = 152;
export const ROSTER_HEIGHT = 56;

// Card height = header + per-bucket header rows + per-asset rows + optional
// toggle bar + bottom padding. Constants tuned against rendered cards in
// the wild (a 1-asset draft ~107px; a 3-asset trade ~156px). A small
// overshoot is preferable to undershoot since dagre uses the height as the
// minimum vertical footprint, and undershooting causes visible overlap.
const HEADER_HEIGHT = 56;
const BUCKET_HEADER_HEIGHT = 22;
const ROW_HEIGHT = 26;
const TOGGLE_BAR_HEIGHT = 28;
const VERTICAL_PADDING = 6;

export interface NodeHints {
  /** Number of asset rows currently rendered (chain-only when collapsed,
   *  all assets when the header is open or the card is a draft). */
  assetRows: number;
  /** Number of distinct recipient buckets in the visible asset list — each
   *  contributes a "→ MANAGER" subheader row. */
  bucketCount: number;
  /** Whether the bottom "Show N more / Collapse" bar is rendered. */
  hasToggleBar: boolean;
}

/**
 * Compute target positions for every node in the visible subgraph.
 * Returns top-left corner positions in React Flow's coordinate space.
 */
export function layout(
  graph: Pick<Graph, "nodes" | "edges">,
  hintsByNode?: Map<string, NodeHints>,
): Map<string, Pos> {
  const positions = new Map<string, Pos>();
  if (graph.nodes.length === 0) return positions;

  const g = new dagre.graphlib.Graph({ multigraph: false, compound: false });
  g.setGraph({
    rankdir: "LR",
    // network-simplex packs ranks tightly while preserving direction —
    // longest-path inflates horizontal distance when one branch is much
    // longer than another, leaving large empty gaps between adjacent
    // ranks. Network-simplex is slower but well within budget for the
    // <50-node graphs this view ever shows.
    ranker: "network-simplex",
    // Vertical gap between cards sharing a column. Tight enough to read
    // as a single thread, loose enough that adjacent cards aren't kissing.
    nodesep: 36,
    // Horizontal gap between columns. Cards are 260px wide; this gives
    // room for edge labels + bezier curvature without long diagonals.
    ranksep: 70,
    edgesep: 12,
    marginx: 40,
    marginy: 40,
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const n of graph.nodes) {
    g.setNode(n.id, nodeDimensions(n, hintsByNode?.get(n.id)));
  }

  // Multiple tenure edges can share a (source, target) pair when several
  // assets move together in one trade. Collapse them — they don't change
  // rank ordering, and dagre's crossing reduction already handles them.
  const seenEdges = new Set<string>();
  for (const e of graph.edges) {
    const key = `${e.source}|${e.target}`;
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);
    g.setEdge(e.source, e.target);
  }

  dagre.layout(g);

  for (const n of graph.nodes) {
    const node = g.node(n.id);
    if (!node) continue;
    // Dagre returns center coords; React Flow expects top-left.
    positions.set(n.id, {
      x: node.x - node.width / 2,
      y: node.y - node.height / 2,
    });
  }

  return positions;
}

/**
 * Estimated rendered dimensions for a node. Falls back to asset count
 * when no chain-expansion hint is available — useful for tests and any
 * caller that doesn't track expansion state.
 */
export function nodeDimensions(
  node: GraphNode,
  hints?: NodeHints,
): { width: number; height: number } {
  if (node.kind === "current_roster") {
    return { width: ROSTER_WIDTH, height: ROSTER_HEIGHT };
  }
  const rows = Math.max(hints?.assetRows ?? defaultRows(node), 1);
  const buckets = Math.max(hints?.bucketCount ?? defaultBuckets(node), 1);
  const toggle = hints?.hasToggleBar ? TOGGLE_BAR_HEIGHT : 0;
  const height =
    HEADER_HEIGHT +
    buckets * BUCKET_HEADER_HEIGHT +
    rows * ROW_HEIGHT +
    toggle +
    VERTICAL_PADDING;
  return { width: NODE_WIDTH, height };
}

function defaultRows(node: Extract<GraphNode, { kind: "transaction" }>): number {
  return node.txKind === "draft" ? 1 : node.assets.length;
}

function defaultBuckets(node: Extract<GraphNode, { kind: "transaction" }>): number {
  const recipients = new Set<string>();
  for (const a of node.assets) recipients.add(a.toUserId ?? "__none__");
  return recipients.size;
}
