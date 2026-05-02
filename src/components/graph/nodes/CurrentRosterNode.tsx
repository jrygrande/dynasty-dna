"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "reactflow";

import { cn } from "@/lib/utils";
import { initialsFromName, lookupSwap } from "@/lib/demoAnonymize";
import { useDemoMap } from "@/lib/useDemoMap";
import { ROSTER_HEIGHT, ROSTER_WIDTH } from "../layout";

export interface CurrentRosterNodeData {
  userId?: string | null;
  displayName: string;
  avatar: string | null;
  selected?: boolean;
  dimmed?: boolean;
}

function CurrentRosterNodeImpl({ data, selected }: NodeProps<CurrentRosterNodeData>) {
  const isSelected = selected || data.selected;
  const { active, map } = useDemoMap();

  const swap = active && map ? lookupSwap(map, data.userId) : undefined;
  const displayName = swap?.displayName ?? data.displayName;
  const avatarChip = swap?.initials ?? initialsFromName(data.displayName);
  const showRealAvatar = !swap && !!data.avatar;

  return (
    <div
      className={cn(
        "group relative flex items-center gap-2 rounded-xl border border-sage-300 bg-sage-50 px-3 py-2 text-card-foreground shadow-sm transition-opacity",
        isSelected && "ring-2 ring-primary",
        data.dimmed && "opacity-30",
      )}
      style={{ width: ROSTER_WIDTH, height: ROSTER_HEIGHT }}
      aria-label={`Current roster of ${displayName}`}
    >
      <Handle type="target" position={Position.Left} id="card-target" className="!bg-transparent !border-0" />
      <div
        className={cn(
          "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ring-1 ring-border",
          swap
            ? "bg-primary/15 text-primary"
            : "bg-muted text-muted-foreground",
        )}
        aria-hidden="true"
      >
        {showRealAvatar ? (
          <span
            className="block h-full w-full rounded-full bg-cover bg-center"
            style={{ backgroundImage: `url(${data.avatar})` }}
          />
        ) : (
          <span>{avatarChip}</span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        {/* Allowed per design: graph headers may use Source Serif 4 (relaxes marketing-only rule). */}
        <div className="truncate font-serif text-sm font-medium leading-tight text-sage-800">
          {displayName}
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
