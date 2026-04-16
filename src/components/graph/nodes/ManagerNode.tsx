"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "reactflow";

import { cn } from "@/lib/utils";

export interface ManagerNodeData {
  displayName: string;
  avatar: string | null;
  tradeCount?: number;
  selected?: boolean;
  dimmed?: boolean;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

function ManagerNodeImpl({ data, selected }: NodeProps<ManagerNodeData>) {
  const isSelected = selected || data.selected;
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md border bg-card px-3 py-2 shadow-sm",
        "text-card-foreground transition-opacity",
        isSelected && "ring-2 ring-primary",
        data.dimmed && "opacity-30",
      )}
      style={{ width: 140, height: 56 }}
      aria-label={`Manager ${data.displayName}`}
    >
      <Handle type="target" position={Position.Top} className="!bg-transparent !border-0" />
      <div
        className={cn(
          "flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground",
          "ring-1 ring-border",
        )}
        aria-hidden="true"
      >
        {data.avatar ? (
          // Avatar URL from Sleeper — render as background image so we don't add next/image config.
          <span
            className="block h-full w-full rounded-full bg-cover bg-center"
            style={{ backgroundImage: `url(${data.avatar})` }}
          />
        ) : (
          <span>{initials(data.displayName)}</span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-semibold leading-tight" title={data.displayName}>
          {data.displayName}
        </div>
        {typeof data.tradeCount === "number" && data.tradeCount > 0 ? (
          <div className="mt-0.5 inline-flex items-center rounded-sm bg-muted px-1 py-[1px] text-[10px] font-medium text-muted-foreground">
            {data.tradeCount} trades
          </div>
        ) : null}
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-transparent !border-0" />
    </div>
  );
}

export const ManagerNode = memo(ManagerNodeImpl);
ManagerNode.displayName = "ManagerNode";
