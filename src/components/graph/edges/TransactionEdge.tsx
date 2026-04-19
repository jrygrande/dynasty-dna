"use client";

import { memo } from "react";
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from "reactflow";

export interface TransactionEdgeData {
  assetKind: "player" | "pick";
  /** Label shown at edge midpoint: "Bijan Robinson" or "2024 R1". */
  assetLabel: string;
  /** Manager who held the asset during this tenure. */
  managerName: string;
  /** True when the edge is not incident to the hovered node. */
  dimmed?: boolean;
  /** True when the tenure is still open (target is a current-roster anchor). */
  isOpen?: boolean;
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

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const dimmed = !!data?.dimmed;
  const opacity = dimmed ? 0.18 : 1;
  const isOpen = !!data?.isOpen;
  const isPick = data?.assetKind === "pick";

  const stroke = isPick ? "hsl(var(--chart-4))" : "hsl(var(--primary))";
  const strokeWidth = selected ? 2 : 1.25;
  const dashArray = isOpen ? "4 3" : isPick ? "2 3" : undefined;

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
