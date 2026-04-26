"use client";

import {
  Component,
  type ErrorInfo,
  type ReactNode,
  createContext,
  useCallback,
  useContext,
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
import { edgeAssetKey } from "@/lib/useGraphVisibility";

import { TransactionNode, type TransactionNodeData, type TransactionNodeAsset } from "./nodes/TransactionNode";
import { CurrentRosterNode, type CurrentRosterNodeData } from "./nodes/CurrentRosterNode";
import { TransactionEdge, type TransactionEdgeData } from "./edges/TransactionEdge";
import { layout, type LayoutMode } from "./layout";

export interface AssetGraphProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selection: GraphSelection | null;
  onSelect: (s: GraphSelection | null) => void;
  layoutMode?: LayoutMode;
  expandedEntries?: Set<string>;
  onAssetExpand?: (nodeId: string, assetKey: string) => void;
  onRemove?: (nodeId: string) => void;
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
  layoutMode = "band",
  expandedEntries,
  onAssetExpand,
  onRemove,
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
      const assetLabel =
        e.assetKind === "player" ? e.playerName ?? "" : e.pickLabel ?? "";
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        type: "transaction",
        selected: selection?.type === "edge" && selection.edgeId === e.id,
        data: {
          assetKind: e.assetKind,
          assetKey: edgeAssetKey(e),
          assetLabel,
          managerName: e.managerName,
          isOpen: e.isOpen,
        },
      };
    });
  }, [edges, selection]);

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
            onRemove,
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
        const label = a.pickLabel ?? `${a.pickSeason} R${a.pickRound}`;
        return {
          kind: "pick",
          assetKey: `pick:${a.pickSeason}:${a.pickRound}:${a.pickOriginalRosterId}`,
          label,
          toUserId: a.toUserId,
          toName,
          fromUserId: a.fromUserId,
        };
      });

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
          assets: transactionAssets,
          expandedAssets: assetExpansionsByNode.get(n.id) ?? new Set(),
          selected: isSelected,
          dimmed: false,
          onRemove,
          onAssetClick: onAssetExpand,
          onSelect: (nodeId) => onSelect({ type: "node", nodeId }),
        },
      };
    });
  }, [nodes, positions, selection, assetExpansionsByNode, onRemove, onAssetExpand, onSelect]);

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

  const hoverState = useMemo<HoverState>(
    () => ({ hoveredNodeId, hoveredAssetKey, setHoveredAssetKey }),
    [hoveredNodeId, hoveredAssetKey],
  );

  return (
    <GraphHoverContext.Provider value={hoverState}>
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
