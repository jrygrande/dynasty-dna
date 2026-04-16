"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "reactflow";

import { cn } from "@/lib/utils";

export interface PlayerNodeData {
  name: string;
  position: string | null;
  team: string | null;
  selected?: boolean;
  dimmed?: boolean;
}

// Position → Tailwind stripe color. Falls back to gray.
const POSITION_STRIPE: Record<string, string> = {
  QB: "bg-red-500",
  RB: "bg-green-500",
  WR: "bg-blue-500",
  TE: "bg-orange-500",
  K: "bg-gray-500",
  DEF: "bg-purple-500",
};

function PlayerNodeImpl({ data, selected }: NodeProps<PlayerNodeData>) {
  const isSelected = selected || data.selected;
  const stripe = (data.position && POSITION_STRIPE[data.position]) || "bg-muted-foreground";
  return (
    <div
      className={cn(
        "relative flex items-center gap-2 overflow-hidden rounded-md border bg-card px-3 py-1.5 shadow-sm",
        "text-card-foreground transition-opacity",
        isSelected && "ring-2 ring-primary",
        data.dimmed && "opacity-30",
      )}
      style={{ width: 128, height: 48 }}
      aria-label={`Player ${data.name}`}
    >
      <Handle type="target" position={Position.Top} className="!bg-transparent !border-0" />
      <span
        className={cn("absolute left-0 top-0 h-full w-1", stripe)}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1 pl-1.5">
        <div className="truncate text-xs font-semibold leading-tight" title={data.name}>
          {data.name}
        </div>
        <div className="truncate text-[10px] leading-tight text-muted-foreground">
          {[data.position ?? "?", data.team ?? "--"].join(" · ")}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-transparent !border-0" />
    </div>
  );
}

export const PlayerNode = memo(PlayerNodeImpl);
PlayerNode.displayName = "PlayerNode";
