"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "reactflow";

import { cn } from "@/lib/utils";
import { ROSTER_HEIGHT, ROSTER_WIDTH } from "../layout";

export interface CurrentRosterNodeData {
  displayName: string;
  avatar: string | null;
  selected?: boolean;
  dimmed?: boolean;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

function CurrentRosterNodeImpl({ data, selected }: NodeProps<CurrentRosterNodeData>) {
  const isSelected = selected || data.selected;

  return (
    <div
      className={cn(
        "group relative flex items-center gap-2 rounded-xl border border-sage-300 bg-sage-50 px-3 py-2 text-card-foreground shadow-sm transition-opacity",
        isSelected && "ring-2 ring-primary",
        data.dimmed && "opacity-30",
      )}
      style={{ width: ROSTER_WIDTH, height: ROSTER_HEIGHT }}
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
        {/* Allowed per design: graph headers may use Source Serif 4 (relaxes marketing-only rule). */}
        <div className="truncate font-serif text-sm font-medium leading-tight text-sage-800">
          {data.displayName}
        </div>
        <div className="font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
          Current roster
        </div>
      </div>
      <Handle type="source" position={Position.Right} id="card-source" className="!bg-transparent !border-0" />
    </div>
  );
}

export const CurrentRosterNode = memo(CurrentRosterNodeImpl);
CurrentRosterNode.displayName = "CurrentRosterNode";
