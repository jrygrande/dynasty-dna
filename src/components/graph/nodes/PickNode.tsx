"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "reactflow";

import { cn } from "@/lib/utils";
import { RemoveButton } from "./RemoveButton";

export interface PickNodeData {
  pickSeason: string;
  pickRound: number;
  pickOriginalOwnerName: string | null;
  resolvedPlayerName?: string;
  selected?: boolean;
  dimmed?: boolean;
  expanded?: boolean;
  onRemove?: (nodeId: string) => void;
}

function PickNodeImpl({ id, data, selected }: NodeProps<PickNodeData>) {
  const isSelected = selected || data.selected;
  const unexpanded = data.expanded === false;
  return (
    <div
      className={cn(
        "group relative flex flex-col justify-center rounded-md border bg-card px-2 py-1 shadow-sm",
        "text-card-foreground transition-opacity",
        isSelected && "ring-2 ring-primary",
        unexpanded && !isSelected && "border-dashed",
        data.dimmed && "opacity-30",
      )}
      style={{ width: 112, height: 48 }}
      aria-label={`Draft pick ${data.pickSeason} round ${data.pickRound}`}
    >
      <Handle type="target" position={Position.Top} className="!bg-transparent !border-0" />
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
      {data.onRemove && <RemoveButton onRemove={() => data.onRemove?.(id)} />}
      <Handle type="source" position={Position.Bottom} className="!bg-transparent !border-0" />
    </div>
  );
}

export const PickNode = memo(PickNodeImpl);
PickNode.displayName = "PickNode";
