"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "reactflow";

import { cn } from "@/lib/utils";
import { RemoveButton } from "./RemoveButton";

export interface CurrentRosterNodeData {
  displayName: string;
  avatar: string | null;
  selected?: boolean;
  dimmed?: boolean;
  onRemove?: (nodeId: string) => void;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

function CurrentRosterNodeImpl({ id, data, selected }: NodeProps<CurrentRosterNodeData>) {
  const isSelected = selected || data.selected;

  return (
    <div
      className={cn(
        "group relative flex items-center gap-2 rounded-md border-2 border-primary/40 bg-primary/5 px-3 py-2 text-card-foreground shadow-sm transition-opacity",
        isSelected && "ring-2 ring-primary",
        data.dimmed && "opacity-30",
      )}
      style={{ width: 152, height: 56 }}
      aria-label={`Current roster of ${data.displayName}`}
    >
      <Handle type="target" position={Position.Left} id="card-target" className="!bg-transparent !border-0" />
      <div
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground ring-1 ring-border"
        aria-hidden="true"
      >
        {data.avatar ? (
          <span
            className="block h-full w-full rounded-full bg-cover bg-center"
            style={{ backgroundImage: `url(${data.avatar})` }}
          />
        ) : (
          <span>{initials(data.displayName)}</span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-semibold leading-tight">{data.displayName}</div>
        <div className="font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
          Current roster
        </div>
      </div>
      {data.onRemove && <RemoveButton onRemove={() => data.onRemove?.(id)} />}
      <Handle type="source" position={Position.Right} id="card-source" className="!bg-transparent !border-0" />
    </div>
  );
}

export const CurrentRosterNode = memo(CurrentRosterNodeImpl);
CurrentRosterNode.displayName = "CurrentRosterNode";
