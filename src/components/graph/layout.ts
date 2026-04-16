/**
 * Asset Graph Browser — pure, deterministic layout.
 *
 * Two strategies:
 *   - "band" (default): season-banded. Managers in a horizontal strip at the
 *     top; assets (players/picks) placed in vertical bands keyed to the
 *     season they first appear in via an edge.
 *   - "dagre": top-to-bottom ranked layout using the `dagre` library. Used as
 *     a fallback when the banded layout looks congested.
 *
 * Both strategies are PURE and deterministic: same input graph → identical
 * position map. No Math.random, no clock reads, no window/document access.
 * Safe to run in Node (e.g. from an API route) and in the browser.
 */

import dagre from "dagre";

import type { Graph, GraphEdge, GraphNode } from "@/lib/assetGraph";

export type LayoutMode = "band" | "dagre";

// ----- Shared constants ------------------------------------------------------

/** Horizontal spacing between manager nodes in the top strip. */
const MANAGER_SLOT_WIDTH = 160;
/** Horizontal spacing between asset nodes inside a season band when centered on a single manager. */
const ASSET_SLOT_WIDTH = 160;
/** Vertical distance between the manager strip and each subsequent season band. */
const BAND_HEIGHT = 420;
/** Per-asset vertical jitter inside a band to avoid overlap on the same x. */
const BAND_JITTER = 48;
/** Starting x for the manager strip so the graph doesn't hug the left edge. */
const MANAGER_STRIP_X0 = 80;

// ----- Dagre size hints per node kind (kept in sync with rendered components) ----
const DAGRE_SIZES: Record<GraphNode["kind"], { width: number; height: number }> = {
  manager: { width: 140, height: 56 },
  player: { width: 128, height: 48 },
  pick: { width: 112, height: 48 },
};

type Pos = { x: number; y: number };

/**
 * Compute a position map for every node in the graph. Deterministic — the same
 * input produces byte-identical output.
 */
export function layout(graph: Graph, mode: LayoutMode): Map<string, Pos> {
  if (graph.nodes.length === 0) return new Map();
  if (mode === "dagre") return dagreLayout(graph);
  return bandLayout(graph);
}

// =============================================================================
// Band layout
// =============================================================================

function bandLayout(graph: Graph): Map<string, Pos> {
  const positions = new Map<string, Pos>();

  // Index nodes by id for fast lookup.
  const nodeById = new Map<string, GraphNode>();
  for (const n of graph.nodes) nodeById.set(n.id, n);

  // --- Manager strip (y = 0), sorted by userId for stability ----------------
  const managers = graph.nodes
    .filter((n): n is Extract<GraphNode, { kind: "manager" }> => n.kind === "manager")
    .slice()
    .sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));

  managers.forEach((m, i) => {
    positions.set(m.id, { x: MANAGER_STRIP_X0 + i * MANAGER_SLOT_WIDTH, y: 0 });
  });

  // --- Seasons -------------------------------------------------------------
  // Distinct seasons from edges, sorted ascending (lexicographic works for "YYYY").
  const seasonSet = new Set<string>();
  for (const e of graph.edges) seasonSet.add(e.season);
  const seasons = Array.from(seasonSet).sort();
  const seasonIndex = new Map<string, number>();
  seasons.forEach((s, i) => seasonIndex.set(s, i));

  // --- First-appearance season per asset node ------------------------------
  // Walk edges in input order (caller controls ordering — deterministic for a
  // given input). For each asset endpoint, pick the earliest season that
  // touched it.
  const firstSeasonByAsset = new Map<string, string>();
  const incidentManagersByAsset = new Map<string, Set<string>>();

  for (const e of graph.edges) {
    recordAssetTouch(e.source, e, nodeById, firstSeasonByAsset, incidentManagersByAsset);
    recordAssetTouch(e.target, e, nodeById, firstSeasonByAsset, incidentManagersByAsset);
  }

  // --- Place asset nodes inside their first-seen season band ---------------
  // Deterministic ordering: sort by (seasonIndex, id) so we get stable slot
  // assignment inside each band.
  const assetNodes = graph.nodes
    .filter((n) => n.kind !== "manager")
    .slice()
    .sort((a, b) => {
      const sa = firstSeasonByAsset.get(a.id) ?? "";
      const sb = firstSeasonByAsset.get(b.id) ?? "";
      if (sa !== sb) return sa < sb ? -1 : 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

  // Track per-band slot counter for jitter layering.
  const bandSlot = new Map<number, number>();

  for (const asset of assetNodes) {
    const season = firstSeasonByAsset.get(asset.id);
    const bandIdx = season !== undefined ? seasonIndex.get(season) ?? 0 : 0;
    const y = BAND_HEIGHT * (bandIdx + 1);

    // Midpoint between the managers this asset is connected to. Fall back to
    // the band's horizontal center if no manager incidence is known.
    const mgrIds = incidentManagersByAsset.get(asset.id);
    const x = computeAssetX(mgrIds, positions, managers.length);

    const slot = bandSlot.get(bandIdx) ?? 0;
    bandSlot.set(bandIdx, slot + 1);
    const yJitter = BAND_JITTER * slot;

    positions.set(asset.id, { x, y: y + yJitter });
  }

  return positions;
}

function recordAssetTouch(
  nodeId: string,
  edge: GraphEdge,
  nodeById: Map<string, GraphNode>,
  firstSeasonByAsset: Map<string, string>,
  incidentManagersByAsset: Map<string, Set<string>>,
): void {
  const node = nodeById.get(nodeId);
  if (!node || node.kind === "manager") return;

  const prior = firstSeasonByAsset.get(nodeId);
  if (!prior || edge.season < prior) firstSeasonByAsset.set(nodeId, edge.season);

  const other = edge.source === nodeId ? edge.target : edge.source;
  const otherNode = nodeById.get(other);
  if (otherNode?.kind === "manager") {
    let set = incidentManagersByAsset.get(nodeId);
    if (!set) {
      set = new Set<string>();
      incidentManagersByAsset.set(nodeId, set);
    }
    set.add(other);
  }
}

function computeAssetX(
  managerIds: Set<string> | undefined,
  positions: Map<string, Pos>,
  managerCount: number,
): number {
  if (managerIds && managerIds.size > 0) {
    let sum = 0;
    let n = 0;
    for (const id of managerIds) {
      const p = positions.get(id);
      if (!p) continue;
      sum += p.x;
      n += 1;
    }
    if (n > 0) return sum / n;
  }
  // Fallback: horizontal center of the manager strip.
  const halfCount = Math.max(0, managerCount - 1) / 2;
  return MANAGER_STRIP_X0 + halfCount * MANAGER_SLOT_WIDTH;
}

// =============================================================================
// Dagre layout
// =============================================================================

function dagreLayout(graph: Graph): Map<string, Pos> {
  const positions = new Map<string, Pos>();
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", ranksep: 80, nodesep: 60 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const n of graph.nodes) {
    const size = DAGRE_SIZES[n.kind];
    g.setNode(n.id, { width: size.width, height: size.height });
  }

  for (const e of graph.edges) {
    // dagre only needs endpoints for ranking; no weight tuning in MVP.
    g.setEdge(e.source, e.target);
  }

  dagre.layout(g);

  for (const n of graph.nodes) {
    const node = g.node(n.id);
    if (!node) continue;
    // dagre places the center of the node at (x, y). Return as-is; reactflow
    // node `position` is top-left by default, but our rendered sizes match the
    // DAGRE_SIZES hints so downstream code can offset if it cares. We keep the
    // center-point convention to match reactflow + dagre examples.
    positions.set(n.id, { x: node.x, y: node.y });
  }

  // Ensure every input node has an entry (defensive — dagre should cover all).
  for (const n of graph.nodes) {
    if (!positions.has(n.id)) positions.set(n.id, { x: 0, y: 0 });
  }

  return positions;
}

// Exported for tests — intentionally internal layout constants.
export const __LAYOUT_CONSTANTS__ = {
  MANAGER_SLOT_WIDTH,
  ASSET_SLOT_WIDTH,
  BAND_HEIGHT,
  BAND_JITTER,
  MANAGER_STRIP_X0,
  DAGRE_SIZES,
};
