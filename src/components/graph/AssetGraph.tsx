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

import type { GraphEdge, GraphNode, GraphSelection } from "@/lib/assetGraph";

import { TransactionNode, type TransactionNodeData } from "./nodes/TransactionNode";
import { CurrentRosterNode, type CurrentRosterNodeData } from "./nodes/CurrentRosterNode";
import { TransactionEdge, type TransactionEdgeData } from "./edges/TransactionEdge";
import { layout, type LayoutMode } from "./layout";

export interface AssetGraphProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selection: GraphSelection | null;
  onSelect: (s: GraphSelection | null) => void;
  layoutMode?: LayoutMode;
  expandedNodeIds?: Set<string>;
  onExpand?: (nodeId: string) => void;
  onRemove?: (nodeId: string) => void;
}

type FlowNodeData = TransactionNodeData | CurrentRosterNodeData;

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

function assetSummary(node: Extract<GraphNode, { kind: "transaction" }>): string {
  const assets = node.assets;
  if (assets.length === 0) return "—";
  if (assets.length === 1) {
    const a = assets[0];
    if (a.kind === "player") {
      const pos = a.playerPosition ? `${a.playerPosition} ` : "";
      return `${pos}${a.playerName ?? ""}`.trim();
    }
    return a.pickLabel ?? `Pick ${a.pickSeason} R${a.pickRound}`;
  }
  const first = assets[0];
  const firstLabel =
    first.kind === "player"
      ? first.playerName ?? ""
      : first.pickLabel ?? `Pick R${first.pickRound}`;
  const remaining = assets.length - 1;
  return `${firstLabel} + ${remaining} more`;
}

function AssetGraphInner({
  nodes,
  edges,
  selection,
  onSelect,
  layoutMode = "band",
  expandedNodeIds,
  onExpand,
  onRemove,
}: AssetGraphProps) {
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

  const positions = useMemo(() => {
    const allHavePositions = nodes.every((n) => !!n.layout);
    if (allHavePositions) {
      const m = new Map<string, { x: number; y: number }>();
      for (const n of nodes) {
        if (n.layout) m.set(n.id, n.layout);
      }
      return m;
    }
    return layout({ nodes, edges }, layoutMode);
  }, [nodes, edges, layoutMode]);

  const flowEdges = useMemo<Edge<TransactionEdgeData>[]>(() => {
    return edges.map((e): Edge<TransactionEdgeData> => {
      const dimmed = !!hoveredNodeId && e.source !== hoveredNodeId && e.target !== hoveredNodeId;
      const assetLabel =
        e.assetKind === "player"
          ? e.playerName ?? ""
          : e.pickLabel ?? "";
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        type: "transaction",
        selected: selection?.type === "edge" && selection.edgeId === e.id,
        data: {
          assetKind: e.assetKind,
          assetLabel,
          managerName: e.managerName,
          dimmed,
          isOpen: e.isOpen,
        },
      };
    });
  }, [edges, hoveredNodeId, selection]);

  const flowNodes = useMemo<Node<FlowNodeData>[]>(() => {
    return nodes.map((n): Node<FlowNodeData> => {
      const pos = positions.get(n.id) ?? { x: 0, y: 0 };
      const isSelected = selection?.type === "node" && selection.nodeId === n.id;
      const isDimmed =
        !!hoveredNodeId &&
        hoveredNodeId !== n.id &&
        !edges.some(
          (e) =>
            (e.source === hoveredNodeId && e.target === n.id) ||
            (e.target === hoveredNodeId && e.source === n.id),
        );
      const isExpanded = expandedNodeIds?.has(n.id) ?? false;

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
            dimmed: isDimmed,
            expanded: isExpanded,
            onRemove,
          },
        };
      }

      return {
        id: n.id,
        type: "transaction",
        position: pos,
        selected: isSelected,
        data: {
          txKind: n.txKind,
          season: n.season,
          week: n.week,
          createdAt: n.createdAt,
          managers: n.managers,
          assetSummary: assetSummary(n),
          selected: isSelected,
          dimmed: isDimmed,
          expanded: isExpanded,
          onRemove,
        },
      };
    });
  }, [nodes, edges, positions, selection, hoveredNodeId, expandedNodeIds, onRemove]);

  const onNodeClick = useCallback<NodeMouseHandler>(
    (_, node) => {
      if (expandedNodeIds && !expandedNodeIds.has(node.id) && onExpand) {
        onExpand(node.id);
        return;
      }
      onSelect({ type: "node", nodeId: node.id });
    },
    [expandedNodeIds, onExpand, onSelect],
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
