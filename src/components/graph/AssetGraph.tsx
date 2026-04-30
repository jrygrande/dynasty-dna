"use client";

import {
  Component,
  type ErrorInfo,
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ReactFlow, {
  Controls,
  MiniMap,
  ReactFlowProvider,
  useReactFlow,
  useUpdateNodeInternals,
  type Edge,
  type Node,
  type NodeMouseHandler,
  type EdgeMouseHandler,
  type NodeDragHandler,
  type NodeTypes,
  type EdgeTypes,
} from "reactflow";
import "reactflow/dist/style.css";

import type { GraphEdge, GraphNode, GraphSelection } from "@/lib/assetGraph";
import { edgeAssetKey } from "@/lib/useGraphVisibility";

import { TransactionNode, type TransactionNodeData } from "./nodes/TransactionNode";
import type { TransactionNodeAsset } from "./TransactionCardChrome";
import { buildTransactionHeader, isHeaderExpanded } from "./transactionHeader";
import { CurrentRosterNode, type CurrentRosterNodeData } from "./nodes/CurrentRosterNode";
import { TransactionEdge, type TransactionEdgeData } from "./edges/TransactionEdge";
import { layout, nodeDimensions, type NodeHints, type Pos } from "./layout";
import { deriveSpawnParents } from "@/lib/graph/spawnParents";
import { useGraphPositionTween } from "@/lib/graph/useGraphPositionTween";

export interface AssetGraphProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selection: GraphSelection | null;
  onSelect: (s: GraphSelection | null) => void;
  seedIds?: string[];
  expandedEntries?: Set<string>;
  onAssetExpand?: (nodeId: string, assetKey: string) => void;
  /** Per-node set of asset keys that are "in-chain" (visible when collapsed). */
  chainAssetsByNode?: Map<string, Set<string>>;
  /** Set of node ids whose card is fully expanded (header was clicked). */
  fullyExpanded?: Set<string>;
  onHeaderToggle?: (nodeId: string) => void;
  /** User-dragged positions that override the computed layout. Lifted to the
   *  page so a Reset-positions button can clear them. */
  manualPositions?: Map<string, Pos>;
  onManualPositionChange?: (nodeId: string, pos: Pos) => void;
}

type FlowNodeData = TransactionNodeData | CurrentRosterNodeData;

/** Hover state shared via context to avoid recomputing all node/edge data on every hover. */
interface HoverState {
  hoveredNodeId: string | null;
  hoveredAssetKey: string | null;
  setHoveredAssetKey: (key: string | null) => void;
}

export const GraphHoverContext = createContext<HoverState>({
  hoveredNodeId: null,
  hoveredAssetKey: null,
  setHoveredAssetKey: () => {},
});

export function useGraphHover() {
  return useContext(GraphHoverContext);
}

/** Obstacle rects for edge routing — shared via context to avoid per-edge data bloat. */
import type { Obstacle } from "@/lib/graph/routeEdgePath";

const ObstaclesContext = createContext<Obstacle[]>([]);

export function useObstacles() {
  return useContext(ObstaclesContext);
}

const nodeTypes: NodeTypes = {
  transaction: TransactionNode,
  current_roster: CurrentRosterNode,
};

const edgeTypes: EdgeTypes = {
  transaction: TransactionEdge,
};

export function AssetGraph(props: AssetGraphProps) {
  return (
    <GraphErrorBoundary>
      <ReactFlowProvider>
        <AssetGraphInner {...props} />
      </ReactFlowProvider>
    </GraphErrorBoundary>
  );
}

function AssetGraphInner({
  nodes,
  edges,
  selection,
  onSelect,
  seedIds,
  expandedEntries,
  onAssetExpand,
  chainAssetsByNode,
  fullyExpanded,
  onHeaderToggle,
  manualPositions,
  onManualPositionChange,
}: AssetGraphProps) {
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [hoveredAssetKey, setHoveredAssetKey] = useState<string | null>(null);

  const assetExpansionsByNode = useMemo(() => {
    const m = new Map<string, Set<string>>();
    if (!expandedEntries) return m;
    for (const entry of expandedEntries) {
      const sepIdx = entry.indexOf("~");
      if (sepIdx === -1) continue;
      const nodeId = entry.slice(0, sepIdx);
      const assetKey = entry.slice(sepIdx + 1);
      let set = m.get(nodeId);
      if (!set) {
        set = new Set();
        m.set(nodeId, set);
      }
      set.add(assetKey);
    }
    return m;
  }, [expandedEntries]);

  // Set of asset keys that have been expanded — used to route edges to
  // per-asset-row handles instead of the card-level handles.
  const expandedAssetKeys = useMemo(() => {
    const keys = new Set<string>();
    if (!expandedEntries) return keys;
    for (const entry of expandedEntries) {
      const sep = entry.indexOf("~");
      if (sep !== -1) keys.add(entry.slice(sep + 1));
    }
    return keys;
  }, [expandedEntries]);

  // Per-node hint that mirrors the rendered card's row count, so the
  // layout's height estimate matches what dagre will actually need.
  const layoutHints = useMemo(() => {
    const m = new Map<string, NodeHints>();
    for (const n of nodes) {
      if (n.kind !== "transaction") continue;
      const chainSize = chainAssetsByNode?.get(n.id)?.size ?? 0;
      const assetRows = isHeaderExpanded(n, fullyExpanded)
        ? n.assets.length
        : chainSize;
      m.set(n.id, { assetRows });
    }
    return m;
  }, [nodes, fullyExpanded, chainAssetsByNode]);

  // Track the previous render's target positions so `deriveSpawnParents`
  // (below) can identify newly-appearing nodes for the tween launch.
  const priorPositionsRef = useRef<Map<string, Pos>>(new Map());

  const targetPositions = useMemo(() => {
    const computed = layout({ nodes, edges }, layoutHints);
    // User-dragged positions override the auto-layout. Layered here so the
    // tween hook treats a manual position as the new target and settles.
    if (manualPositions && manualPositions.size > 0) {
      for (const [id, pos] of manualPositions) {
        if (computed.has(id)) computed.set(id, pos);
      }
    }
    return computed;
  }, [nodes, edges, layoutHints, manualPositions]);

  const spawnParents = useMemo(
    () => deriveSpawnParents(nodes, edges, new Set(priorPositionsRef.current.keys())),
    [nodes, edges],
  );

  const positions = useGraphPositionTween(targetPositions, spawnParents);

  // After the layout settles, persist as the new prior baseline.
  useEffect(() => {
    priorPositionsRef.current = targetPositions;
  }, [targetPositions]);

  // Obstacle rectangles share `nodeDimensions` with the layout so edge
  // routing matches the cards dagre actually placed.
  const obstacleRects = useMemo<Obstacle[]>(() => {
    return nodes.map((n) => {
      const pos = positions.get(n.id);
      if (!pos) return null;
      const dim = nodeDimensions(n, layoutHints.get(n.id));
      return { x: pos.x, y: pos.y, width: dim.width, height: dim.height };
    }).filter((r): r is Obstacle => r !== null);
  }, [nodes, positions, layoutHints]);

  // For each node, compute which asset keys are expanded (including downstream
  // nodes in the thread, not just the node where the user clicked +).
  const nodeExpandedAssets = useMemo(() => {
    const m = new Map<string, Set<string>>();
    // Start with the directly-expanded entries.
    for (const [nodeId, keys] of assetExpansionsByNode) {
      m.set(nodeId, new Set(keys));
    }
    // For each expanded asset key, find all edges with that key and mark
    // both endpoints as having that asset expanded (for handle rendering).
    for (const aKey of expandedAssetKeys) {
      for (const e of edges) {
        if (edgeAssetKey(e) !== aKey) continue;
        for (const nid of [e.source, e.target]) {
          let set = m.get(nid);
          if (!set) { set = new Set(); m.set(nid, set); }
          set.add(aKey);
        }
      }
    }
    return m;
  }, [assetExpansionsByNode, expandedAssetKeys, edges]);

  // Controlled viewport: only fit on first-seed transition, never on every
  // composition change. Pan/zoom adjustments by the user are preserved as
  // the chain expands.
  const reactFlow = useReactFlow();
  const lastSeedKeyRef = useRef<string>("");
  useEffect(() => {
    const seedKey = (seedIds ?? []).join(",");
    if (seedKey === lastSeedKeyRef.current) return;
    lastSeedKeyRef.current = seedKey;
    if (seedKey === "") return;
    // Wait one rAF for the new seed nodes to mount before fitting.
    const id = requestAnimationFrame(() => {
      reactFlow.fitView({ padding: 0.2, duration: 400 });
    });
    return () => cancelAnimationFrame(id);
  }, [seedIds, reactFlow]);

  // When handles are added/removed dynamically (asset expansion toggled or
  // a card header toggles open/closed), tell React Flow to re-measure
  // handle positions on all visible nodes. Double-RAF ensures the DOM has
  // painted before we measure.
  //
  // CRITICAL: only depend on the *content* triggers (expansion state); do
  // NOT depend on `nodes`. The `nodes` array reference changes on every
  // parent render, which during a position tween fires 60×/sec — calling
  // updateNodeInternals on every node every frame causes visible flashing.
  // We read `nodes` via a ref so the effect uses the latest list at measure
  // time without re-firing on each render.
  const updateNodeInternals = useUpdateNodeInternals();
  const nodesRef = useRef(nodes);
  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);
  useEffect(() => {
    let cancelled = false;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (cancelled) return;
        for (const n of nodesRef.current) {
          updateNodeInternals(n.id);
        }
      });
    });
    return () => { cancelled = true; };
  }, [nodeExpandedAssets, fullyExpanded, updateNodeInternals]);

  // Set of current_roster node IDs — don't route per-asset handles to these.
  const rosterNodeIds = useMemo(
    () => new Set(nodes.filter((n) => n.kind === "current_roster").map((n) => n.id)),
    [nodes],
  );

  // Compute gutter offsets: for expanded edges sharing the same source→target
  // column pair, spread them vertically so they don't overlap.
  const gutterOffsets = useMemo(() => {
    const offsets = new Map<string, number>();
    // Group expanded edges by source→target pair
    const pairCounts = new Map<string, number>();
    for (const e of edges) {
      const aKey = edgeAssetKey(e);
      if (!expandedAssetKeys.has(aKey)) continue;
      const pair = `${e.source}→${e.target}`;
      const idx = pairCounts.get(pair) ?? 0;
      pairCounts.set(pair, idx + 1);
      // Alternate above/below: 0, 12, -12, 24, -24, ...
      const half = Math.floor(idx / 2) + 1;
      const offset = idx === 0 ? 0 : idx % 2 === 1 ? half * 12 : -half * 12;
      offsets.set(e.id, offset);
    }
    return offsets;
  }, [edges, expandedAssetKeys]);

  const flowEdges = useMemo<Edge<TransactionEdgeData>[]>(() => {
    return edges.map((e): Edge<TransactionEdgeData> => {
      const aKey = edgeAssetKey(e);
      const isExpanded = expandedAssetKeys.has(aKey);
      const assetLabel =
        e.assetKind === "player" ? e.playerName ?? "" : e.pickLabel ?? "";
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: isExpanded && !rosterNodeIds.has(e.source) ? `asset-source-${aKey}` : "card-source",
        targetHandle: isExpanded && !rosterNodeIds.has(e.target) ? `asset-target-${aKey}` : "card-target",
        type: "transaction",
        zIndex: isExpanded ? 10 : undefined,
        selected:
          selection?.type === "edge" && selection.edgeIds.includes(e.id),
        data: {
          assetKind: e.assetKind,
          assetKey: aKey,
          assetLabel,
          managerName: e.managerName,
          isOpen: e.isOpen,
          gutterOffset: gutterOffsets.get(e.id),
        },
      };
    });
  }, [edges, selection, expandedAssetKeys, rosterNodeIds]);

  const flowNodes = useMemo<Node<FlowNodeData>[]>(() => {
    return nodes.map((n): Node<FlowNodeData> => {
      const pos = positions.get(n.id) ?? { x: 0, y: 0 };
      const isSelected = selection?.type === "node" && selection.nodeId === n.id;

      if (n.kind === "current_roster") {
        return {
          id: n.id,
          type: "current_roster",
          position: pos,
          selected: isSelected,
          data: {
            displayName: n.displayName,
            avatar: n.avatar,
            selected: isSelected,
            dimmed: false,
          },
        };
      }

      const nameByUser = new Map(n.managers.map((m) => [m.userId, m.displayName]));
      const transactionAssets: TransactionNodeAsset[] = n.assets.map((a) => {
        const toName = a.toUserId ? nameByUser.get(a.toUserId) ?? null : null;
        if (a.kind === "player") {
          const position = a.playerPosition ?? null;
          const name = a.playerName ?? a.playerId ?? "Player";
          return {
            kind: "player",
            assetKey: `player:${a.playerId}`,
            label: name,
            position,
            toUserId: a.toUserId,
            toName,
            fromUserId: a.fromUserId,
          };
        }
        const fullLabel = a.pickLabel ?? `${a.pickSeason} R${a.pickRound}`;
        // pickLabel format from assetGraph.ts: "YYYY RN (ownerName)" — split
        // so the year/round is primary and the owner suffix renders muted.
        const parenIdx = fullLabel.indexOf(" (");
        const label = parenIdx >= 0 ? fullLabel.slice(0, parenIdx) : fullLabel;
        const ownerLabel = parenIdx >= 0 ? fullLabel.slice(parenIdx + 1) : undefined;
        return {
          kind: "pick",
          assetKey: `pick:${a.pickSeason}:${a.pickRound}:${a.pickOriginalRosterId}`,
          label,
          ownerLabel,
          toUserId: a.toUserId,
          toName,
          fromUserId: a.fromUserId,
        };
      });

      const header = buildTransactionHeader(n);
      const chainAssetKeys = chainAssetsByNode?.get(n.id) ?? new Set<string>();
      const headerExpanded = isHeaderExpanded(n, fullyExpanded);

      return {
        id: n.id,
        type: "transaction",
        position: pos,
        selected: isSelected,
        data: {
          txKind: n.txKind,
          header,
          managers: n.managers,
          assets: transactionAssets,
          expandedAssets: nodeExpandedAssets.get(n.id) ?? new Set(),
          chainAssetKeys,
          headerExpanded,
          selected: isSelected,
          dimmed: false,
          onAssetClick: onAssetExpand,
          onHeaderToggle,
          onSelect: (nodeId) => onSelect({ type: "node", nodeId }),
        },
      };
    });
  }, [
    nodes,
    positions,
    selection,
    nodeExpandedAssets,
    onAssetExpand,
    onSelect,
    chainAssetsByNode,
    fullyExpanded,
    onHeaderToggle,
  ]);

  const onNodeClick = useCallback<NodeMouseHandler>(
    (_, node) => onSelect({ type: "node", nodeId: node.id }),
    [onSelect],
  );

  const onEdgeClick = useCallback<EdgeMouseHandler>(
    (event, edge) => {
      const additive = event.metaKey || event.ctrlKey || event.shiftKey;
      if (!additive) {
        onSelect({ type: "edge", edgeIds: [edge.id] });
        return;
      }
      const current = selection?.type === "edge" ? selection.edgeIds : [];
      const next = current.includes(edge.id)
        ? current.filter((id) => id !== edge.id)
        : [...current, edge.id];
      onSelect(next.length === 0 ? null : { type: "edge", edgeIds: next });
    },
    [onSelect, selection],
  );

  const onPaneClick = useCallback(() => onSelect(null), [onSelect]);

  // Capture user drags as manual position overrides. React Flow handles the
  // visual drag itself (cursor delta against its internal store); we only
  // persist the final resting position so it survives the next layout pass.
  const onNodeDragStop = useCallback<NodeDragHandler>(
    (_, node) => {
      onManualPositionChange?.(node.id, { x: node.position.x, y: node.position.y });
    },
    [onManualPositionChange],
  );

  const onNodeMouseEnter = useCallback<NodeMouseHandler>(
    (_, node) => setHoveredNodeId(node.id),
    [],
  );
  const onNodeMouseLeave = useCallback(() => setHoveredNodeId(null), []);

  const hoverState = useMemo<HoverState>(
    () => ({ hoveredNodeId, hoveredAssetKey, setHoveredAssetKey }),
    [hoveredNodeId, hoveredAssetKey],
  );

  return (
    <GraphHoverContext.Provider value={hoverState}>
    <ObstaclesContext.Provider value={obstacleRects}>
      <div
        className="h-full w-full bg-cream-50 bg-[length:24px_24px] bg-[radial-gradient(circle,_var(--cream-200)_1px,_transparent_1px)]"
      >
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodeClick={onNodeClick}
          onEdgeClick={onEdgeClick}
          onPaneClick={onPaneClick}
          onNodeMouseEnter={onNodeMouseEnter}
          onNodeMouseLeave={onNodeMouseLeave}
          onNodeDragStop={onNodeDragStop}
          proOptions={{ hideAttribution: true }}
          style={{ background: "transparent" }}
        >
          <Controls />
          <MiniMap pannable zoomable />
        </ReactFlow>
      </div>
    </ObstaclesContext.Provider>
    </GraphHoverContext.Provider>
  );
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class GraphErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error("[AssetGraph] render failed", error, info);
  }

  reload = () => {
    if (typeof window !== "undefined") window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-6 text-center">
          <p className="text-destructive text-sm font-medium">
            The graph failed to render.
          </p>
          <button
            type="button"
            onClick={this.reload}
            className="rounded-md border bg-card px-3 py-1 text-xs font-medium text-card-foreground hover:bg-accent"
          >
            Reload page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
