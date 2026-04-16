"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "reactflow";

import { cn } from "@/lib/utils";

export interface PickNodeData {
  pickSeason: string;
  pickRound: number;
  pickOriginalOwnerName: string | null;
  resolvedPlayerName?: string;
  selected?: boolean;
  dimmed?: boolean;
}

function PickNodeImpl({ data, selected }: NodeProps<PickNodeData>) {
  const isSelected = selected || data.selected;
  return (
    <div
      className={cn(
        "relative flex flex-col justify-center rounded-md border bg-card px-2 py-1 shadow-sm",
        "text-card-foreground transition-opacity",
        isSelected && "ring-2 ring-primary",
        data.dimmed && "opacity-30",
      )}
      style={{ width: 112, height: 48 }}
      aria-label={`Draft pick ${data.pickSeason} round ${data.pickRound}`}
    >
      <Handle type="target" position={Position.Top} className="!bg-transparent !border-0" />
      {/* Diamond accent in the top-right corner. */}
      <span
        className="absolute right-1 top-1 block h-2 w-2 rotate-45 bg-primary/70"
        aria-hidden="true"
      />
      <div className="text-xs font-semibold leading-tight">
        {data.pickSeason} R{data.pickRound}
      </div>
      {data.pickOriginalOwnerName ? (
        <div className="truncate text-[10px] italic leading-tight text-muted-foreground">
          from {data.pickOriginalOwnerName}
        </div>
      ) : null}
      {data.resolvedPlayerName ? (
        <div
          className="truncate text-[10px] leading-tight text-muted-foreground"
          title={data.resolvedPlayerName}
        >
          &rarr; {data.resolvedPlayerName}
        </div>
      ) : null}
      <Handle type="source" position={Position.Bottom} className="!bg-transparent !border-0" />
    </div>
  );
}

export const PickNode = memo(PickNodeImpl);
PickNode.displayName = "PickNode";
