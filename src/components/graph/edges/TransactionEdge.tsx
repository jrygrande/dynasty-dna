"use client";

import { memo } from "react";
import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from "reactflow";

import { useGraphHover, useObstacles } from "../AssetGraph";
import { routeEdgePath } from "@/lib/graph/routeEdgePath";

export interface TransactionEdgeData {
  assetKind: "player" | "pick";
  assetKey: string;
  assetLabel: string;
  managerName: string;
  /** Tenure is still active (target is a current-roster anchor). */
  isOpen?: boolean;
  /** Y-offset in gutters to separate overlapping edge paths. */
  gutterOffset?: number;
}

function TransactionEdgeImpl(props: EdgeProps<TransactionEdgeData>) {
  const {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    data,
    selected,
    markerEnd,
  } = props;

  const isAssetRouted = !!props.sourceHandleId?.startsWith("asset-");
  const obstacles = useObstacles();
  const gutterOffset = data?.gutterOffset ?? 0;

  const result = routeEdgePath(sourceX, sourceY, targetX, targetY, obstacles, gutterOffset);
  const edgePath = result.path;
  const labelX = result.labelX;
  const labelY = result.labelY;

  const { hoveredAssetKey, hoveredNodeId } = useGraphHover();
  const matchesHovered = !!hoveredAssetKey && data?.assetKey === hoveredAssetKey;
  const nodeIncident = !!hoveredNodeId && (props.source === hoveredNodeId || props.target === hoveredNodeId);
  const dimmed =
    (!!hoveredAssetKey && !matchesHovered) ||
    (!hoveredAssetKey && !!hoveredNodeId && !nodeIncident);
  const highlighted = matchesHovered;
  const opacity = dimmed ? 0.18 : 1;
  const isOpen = !!data?.isOpen;
  const isPick = data?.assetKind === "pick";

  // Edges routed to per-asset handles (expanded threads) get thicker, solid lines
  // with higher contrast colors.
  const stroke = isAssetRouted
    ? (isPick ? "hsl(var(--foreground) / 0.5)" : "hsl(var(--primary))")
    : (isPick ? "hsl(var(--chart-4))" : "hsl(var(--primary))");
  const strokeWidth = selected || highlighted ? 3 : isAssetRouted ? 2.5 : 1.25;
  const dashArray = isAssetRouted ? undefined : (isOpen ? "4 3" : isPick ? "2 3" : undefined);

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke,
          strokeWidth,
          strokeDasharray: dashArray,
          opacity,
          transition: "opacity 120ms linear",
        }}
      />
      {data?.assetLabel && !dimmed ? (
        <EdgeLabelRenderer>
          <div
            className="pointer-events-none absolute font-mono text-[10px] text-foreground/80"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              background: "hsl(var(--background) / 0.85)",
              padding: "1px 4px",
              borderRadius: 3,
              whiteSpace: "nowrap",
            }}
          >
            {data.assetLabel}
            <span className="ml-1 text-muted-foreground">· {data.managerName}</span>
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

export const TransactionEdge = memo(TransactionEdgeImpl);
TransactionEdge.displayName = "TransactionEdge";
