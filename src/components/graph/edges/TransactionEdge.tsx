"use client";

import { memo } from "react";
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from "reactflow";

import type { GraphEdgeKind } from "@/lib/assetGraph";

export interface TransactionEdgeData {
  kind: GraphEdgeKind;
  transactionId: string | null;
  groupKey: string;
  /** Set by the parent when the edge is not incident to the hovered node. */
  dimmed?: boolean;
  /** True when the edge shares a groupKey with the currently-hovered edge. */
  groupHighlighted?: boolean;
}

interface EdgeStyle {
  stroke: string;
  strokeWidth: number;
  dashArray: string | undefined;
}

// Styles per edge kind. Colors are Tailwind-ish explicit hex/rgb fallbacks so
// the SVG stroke attribute reads well in light + dark mode without tying to a
// single CSS variable (reactflow edges render outside the card tree).
const STYLE_BY_KIND: Record<GraphEdgeKind, EdgeStyle> = {
  trade_out:           { stroke: "#a855f7", strokeWidth: 1.5,  dashArray: "6 4" },
  trade_in:            { stroke: "#a855f7", strokeWidth: 1.5,  dashArray: undefined },
  pick_trade_out:      { stroke: "#a855f7", strokeWidth: 1.5,  dashArray: "6 4" },
  pick_trade_in:       { stroke: "#a855f7", strokeWidth: 1.5,  dashArray: undefined },
  draft_selected_mgr:  { stroke: "#3b82f6", strokeWidth: 1.5,  dashArray: undefined },
  draft_selected_pick: { stroke: "#3b82f6", strokeWidth: 2,    dashArray: undefined },
  waiver_add:          { stroke: "#f59e0b", strokeWidth: 1.25, dashArray: undefined },
  free_agent_add:      { stroke: "#22c55e", strokeWidth: 1.25, dashArray: undefined },
};

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

  const kind = data?.kind ?? "trade_in";
  const style = STYLE_BY_KIND[kind];

  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const dimmed = !!data?.dimmed && !data?.groupHighlighted;
  const opacity = dimmed ? 0.15 : 1;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: style.stroke,
          strokeWidth: selected ? style.strokeWidth + 0.75 : style.strokeWidth,
          strokeDasharray: style.dashArray,
          opacity,
          transition: "opacity 120ms linear",
        }}
      />
      {selected ? (
        <EdgeLabelRenderer>
          <div
            // Tiny focus ring indicator near the middle of the edge so selection is discoverable.
            className="pointer-events-none absolute rounded-full ring-2 ring-primary"
            style={{
              transform: `translate(-50%, -50%) translate(${(sourceX + targetX) / 2}px,${
                (sourceY + targetY) / 2
              }px)`,
              width: 6,
              height: 6,
              background: style.stroke,
            }}
            aria-hidden="true"
          />
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

export const TransactionEdge = memo(TransactionEdgeImpl);
TransactionEdge.displayName = "TransactionEdge";
