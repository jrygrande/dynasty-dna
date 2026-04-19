"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "reactflow";

import { cn } from "@/lib/utils";
import type { TransactionKind } from "@/lib/assetGraph";
import { RemoveButton } from "./RemoveButton";

export interface TransactionNodeData {
  txKind: TransactionKind;
  season: string;
  week: number;
  createdAt: number;
  /** Managers participating. 1 entry for draft/waiver/FA, 2 for trade. */
  managers: Array<{ userId: string; displayName: string }>;
  /** Compact label previewing what the transaction did. */
  assetSummary: string;
  selected?: boolean;
  dimmed?: boolean;
  expanded?: boolean;
  onRemove?: (nodeId: string) => void;
}

const KIND_LABEL: Record<TransactionKind, string> = {
  draft: "Draft",
  trade: "Trade",
  waiver: "Waiver",
  free_agent: "FA",
  commissioner: "Commish",
};

const KIND_ACCENT: Record<TransactionKind, string> = {
  draft: "bg-chart-4",
  trade: "bg-primary",
  waiver: "bg-grade-c",
  free_agent: "bg-grade-b",
  commissioner: "bg-muted-foreground",
};

function formatDate(createdAt: number, season: string, week: number): string {
  if (!createdAt) return week > 0 ? `W${week} ${season}` : season;
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return season;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function TransactionNodeImpl({ id, data, selected }: NodeProps<TransactionNodeData>) {
  const isSelected = selected || data.selected;
  const unexpanded = data.expanded === false;

  const managerLine =
    data.managers.length === 0
      ? "—"
      : data.managers.length === 1
      ? data.managers[0].displayName
      : `${data.managers[0].displayName} ↔ ${data.managers[1].displayName}`;

  return (
    <div
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-md border bg-card text-card-foreground shadow-sm transition-opacity",
        isSelected && "ring-2 ring-primary",
        unexpanded && !isSelected && "border-dashed",
        data.dimmed && "opacity-30",
      )}
      style={{ width: 168, minHeight: 60 }}
      aria-label={`${KIND_LABEL[data.txKind]} transaction`}
    >
      <Handle type="target" position={Position.Left} className="!bg-transparent !border-0" />
      <span
        className={cn("absolute left-0 top-0 h-full w-1", KIND_ACCENT[data.txKind])}
        aria-hidden="true"
      />
      <div className="flex items-center justify-between px-2 pt-1.5 pl-2.5">
        <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
          {KIND_LABEL[data.txKind]}
        </span>
        <span className="font-mono text-[10px] text-muted-foreground">
          {formatDate(data.createdAt, data.season, data.week)}
        </span>
      </div>
      <div className="px-2 pb-1.5 pl-2.5 space-y-0.5">
        <div className="truncate text-xs font-semibold leading-tight" title={managerLine}>
          {managerLine}
        </div>
        <div className="truncate text-[10px] leading-tight text-muted-foreground" title={data.assetSummary}>
          {data.assetSummary}
        </div>
      </div>
      {data.onRemove && <RemoveButton onRemove={() => data.onRemove?.(id)} />}
      <Handle type="source" position={Position.Right} className="!bg-transparent !border-0" />
    </div>
  );
}

export const TransactionNode = memo(TransactionNodeImpl);
TransactionNode.displayName = "TransactionNode";
