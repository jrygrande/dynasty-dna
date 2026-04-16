"use client";

import {
  Component,
  type ErrorInfo,
  type ReactNode,
  useCallback,
  useMemo,
  useState,
} from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  ReactFlowProvider,
  type Edge,
  type Node,
  type NodeMouseHandler,
  type EdgeMouseHandler,
  type NodeTypes,
  type EdgeTypes,
} from "reactflow";
import "reactflow/dist/style.css";

import type {
  GraphEdge,
  GraphFocus,
  GraphNode,
  GraphSelection,
} from "@/lib/assetGraph";

import { ManagerNode, type ManagerNodeData } from "./nodes/ManagerNode";
import { PlayerNode, type PlayerNodeData } from "./nodes/PlayerNode";
import { PickNode, type PickNodeData } from "./nodes/PickNode";
import { TransactionEdge, type TransactionEdgeData } from "./edges/TransactionEdge";
import { layout, type LayoutMode } from "./layout";

export interface AssetGraphProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selection: GraphSelection | null;
  onSelect: (s: GraphSelection | null) => void;
  onFocus?: (focus: GraphFocus) => void;
  layoutMode?: LayoutMode;
}

type FlowNodeData = ManagerNodeData | PlayerNodeData | PickNodeData;

const nodeTypes: NodeTypes = {
  manager: ManagerNode,
  player: PlayerNode,
  pick: PickNode,
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
  layoutMode = "band",
}: AssetGraphProps) {
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);

  // Compute positions. Use server-provided node.layout when present; otherwise
  // run the pure layout() function. Memoized on nodes.length + layoutMode so
  // we don't re-run on hover state changes.
  const positions = useMemo(() => {
    const allHavePositions = nodes.every((n) => !!n.layout);
    if (allHavePositions) {
      const m = new Map<string, { x: number; y: number }>();
      for (const n of nodes) {
        if (n.layout) m.set(n.id, n.layout);
      }
      return m;
    }
    return layout(
      {
        nodes,
        edges,
        stats: {
          totalTrades: 0,
          totalDraftPicks: 0,
          totalEdges: edges.length,
          totalNodes: nodes.length,
          multiHopChains: 0,
          picksTraded: 0,
        },
      },
      layoutMode,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes.length, layoutMode]);

  // Build reactflow Edge[] with hover-aware dim/highlight flags.
  const flowEdges = useMemo<Edge<TransactionEdgeData>[]>(() => {
    const hoveredEdge = hoveredEdgeId
      ? edges.find((e) => e.id === hoveredEdgeId) ?? null
      : null;

    return edges.map((e): Edge<TransactionEdgeData> => {
      let dimmed = false;
      let groupHighlighted = false;
      if (hoveredNodeId) {
        dimmed = e.source !== hoveredNodeId && e.target !== hoveredNodeId;
      }
      if (hoveredEdge) {
        const sharesGroup = e.groupKey === hoveredEdge.groupKey;
        if (sharesGroup) groupHighlighted = true;
        else dimmed = true;
      }
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        type: "transaction",
        selected: selection?.type === "edge" && selection.edgeId === e.id,
        data: {
          kind: e.kind,
          transactionId: e.transactionId,
          groupKey: e.groupKey,
          dimmed,
          groupHighlighted,
        },
      };
    });
  }, [edges, hoveredNodeId, hoveredEdgeId, selection]);

  // Build reactflow Node[].
  const flowNodes = useMemo<Node<FlowNodeData>[]>(() => {
    return nodes.map((n): Node<FlowNodeData> => {
      const pos = positions.get(n.id) ?? { x: 0, y: 0 };
      const isSelected = selection?.type === "node" && selection.nodeId === n.id;
      const isDimmed =
        !!hoveredNodeId &&
        hoveredNodeId !== n.id &&
        // Dim only non-incident nodes — look at edges to decide.
        !edges.some(
          (e) =>
            (e.source === hoveredNodeId && e.target === n.id) ||
            (e.target === hoveredNodeId && e.source === n.id),
        );

      if (n.kind === "manager") {
        return {
          id: n.id,
          type: "manager",
          position: pos,
          selected: isSelected,
          data: {
            displayName: n.displayName,
            avatar: n.avatar,
            tradeCount: n.tradeCount,
            selected: isSelected,
            dimmed: isDimmed,
          },
        };
      }

      if (n.kind === "player") {
        return {
          id: n.id,
          type: "player",
          position: pos,
          selected: isSelected,
          data: {
            name: n.name,
            position: n.position,
            team: n.team,
            selected: isSelected,
            dimmed: isDimmed,
          },
        };
      }

      return {
        id: n.id,
        type: "pick",
        position: pos,
        selected: isSelected,
        data: {
          pickSeason: n.pickSeason,
          pickRound: n.pickRound,
          pickOriginalOwnerName: n.pickOriginalOwnerName,
          resolvedPlayerName: n.resolvedPlayerName,
          selected: isSelected,
          dimmed: isDimmed,
        },
      };
    });
  }, [nodes, edges, positions, selection, hoveredNodeId]);

  const onNodeClick = useCallback<NodeMouseHandler>(
    (_, node) => onSelect({ type: "node", nodeId: node.id }),
    [onSelect],
  );

  const onEdgeClick = useCallback<EdgeMouseHandler>(
    (_, edge) => onSelect({ type: "edge", edgeId: edge.id }),
    [onSelect],
  );

  const onPaneClick = useCallback(() => onSelect(null), [onSelect]);

  const onNodeMouseEnter = useCallback<NodeMouseHandler>(
    (_, node) => setHoveredNodeId(node.id),
    [],
  );
  const onNodeMouseLeave = useCallback(() => setHoveredNodeId(null), []);

  const onEdgeMouseEnter = useCallback<EdgeMouseHandler>(
    (_, edge) => setHoveredEdgeId(edge.id),
    [],
  );
  const onEdgeMouseLeave = useCallback(() => setHoveredEdgeId(null), []);

  return (
    <div className="h-full w-full">
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
        onEdgeMouseEnter={onEdgeMouseEnter}
        onEdgeMouseLeave={onEdgeMouseLeave}
        onlyRenderVisibleElements
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls />
        <MiniMap pannable zoomable />
      </ReactFlow>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Error boundary (inline, no new dep)
// ----------------------------------------------------------------------------

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
    // Surface to the browser console for debugging; swallow so the page survives.
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
