"use client";

import { memo, type MouseEvent } from "react";
import { Handle, Position, type NodeProps } from "reactflow";

import { cn } from "@/lib/utils";
import type { TransactionKind } from "@/lib/assetGraph";
import { RemoveButton } from "./RemoveButton";

export interface TransactionNodeAsset {
  kind: "player" | "pick";
  assetKey: string;
  label: string;
  position?: string | null;
  toUserId: string | null;
  toName: string | null;
  fromUserId: string | null;
}

export interface TransactionNodeData {
  txKind: TransactionKind;
  season: string;
  week: number;
  createdAt: number;
  managers: Array<{ userId: string; displayName: string }>;
  assets: TransactionNodeAsset[];
  expandedAssets: Set<string>;
  selected?: boolean;
  dimmed?: boolean;
  onRemove?: (nodeId: string) => void;
  onAssetClick?: (nodeId: string, assetKey: string) => void;
  onSelect?: (nodeId: string) => void;
}

const KIND_LABEL: Record<TransactionKind, string> = {
  draft: "Draft",
  trade: "Trade",
  waiver: "Waiver",
  free_agent: "Free agent",
  commissioner: "Commish",
};

const KIND_ACCENT: Record<TransactionKind, string> = {
  draft: "bg-chart-4",
  trade: "bg-primary",
  waiver: "bg-grade-c",
  free_agent: "bg-grade-b",
  commissioner: "bg-muted-foreground",
};

const POSITION_COLOR: Record<string, string> = {
  QB: "bg-grade-f/15 text-grade-f",
  RB: "bg-grade-b/15 text-grade-b",
  WR: "bg-grade-a/15 text-grade-a",
  TE: "bg-grade-d/15 text-grade-d",
  K: "bg-chart-4/15 text-chart-4",
  DEF: "bg-muted text-muted-foreground",
};

function formatDate(createdAt: number, season: string, week: number): string {
  if (!createdAt) return week > 0 ? `${season} · W${week}` : season;
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return season;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
}

function TransactionNodeImpl({ id, data, selected }: NodeProps<TransactionNodeData>) {
  const isSelected = selected || data.selected;

  const managerLine =
    data.managers.length === 0
      ? "—"
      : data.managers.length === 1
      ? data.managers[0].displayName
      : `${data.managers[0].displayName} ↔ ${data.managers[1].displayName}`;

  // Group assets by recipient manager. For single-manager transactions
  // (draft/waiver/FA) there's only one bucket; for trades there are two.
  const buckets = new Map<string, { userId: string | null; displayName: string; assets: TransactionNodeAsset[] }>();
  for (const a of data.assets) {
    const key = a.toUserId ?? "__none__";
    const name = a.toName ?? "—";
    const bucket = buckets.get(key);
    if (bucket) bucket.assets.push(a);
    else buckets.set(key, { userId: a.toUserId, displayName: name, assets: [a] });
  }

  function handleNodeClick(e: MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;
    if (target.closest("[data-asset-row]") || target.closest("button")) return;
    data.onSelect?.(id);
  }

  return (
    <div
      className={cn(
        "group relative rounded-md border bg-card text-card-foreground shadow-sm transition-opacity",
        isSelected && "ring-2 ring-primary",
        data.dimmed && "opacity-30",
      )}
      style={{ width: 260 }}
      aria-label={`${KIND_LABEL[data.txKind]} transaction`}
      onClick={handleNodeClick}
    >
      <Handle type="target" position={Position.Left} className="!bg-transparent !border-0" />
      <span
        className={cn("absolute left-0 top-0 h-full w-1 rounded-l-md", KIND_ACCENT[data.txKind])}
        aria-hidden="true"
      />
      <div className="flex items-center justify-between px-2.5 pt-1.5 pl-3">
        <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
          {KIND_LABEL[data.txKind]}
        </span>
        <span className="font-mono text-[10px] text-muted-foreground">
          {formatDate(data.createdAt, data.season, data.week)}
        </span>
      </div>
      <div className="px-2.5 pb-1.5 pl-3 pt-0.5">
        <div className="truncate text-xs font-semibold leading-tight" title={managerLine}>
          {managerLine}
        </div>
      </div>
      <div className="border-t">
        {Array.from(buckets.values()).map((bucket, idx) => (
          <div key={bucket.userId ?? idx} className={cn(idx > 0 && "border-t")}>
            <div className="flex items-center gap-1 px-3 py-0.5 bg-muted/40">
              <span aria-hidden className="text-muted-foreground text-[10px]">→</span>
              <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground truncate">
                {bucket.displayName}
              </span>
            </div>
            {bucket.assets.map((asset) => (
              <AssetRow
                key={asset.assetKey}
                asset={asset}
                isExpanded={data.expandedAssets.has(asset.assetKey)}
                onClick={() => data.onAssetClick?.(id, asset.assetKey)}
              />
            ))}
          </div>
        ))}
      </div>
      {data.onRemove && <RemoveButton onRemove={() => data.onRemove?.(id)} />}
      <Handle type="source" position={Position.Right} className="!bg-transparent !border-0" />
    </div>
  );
}

function AssetRow({
  asset,
  isExpanded,
  onClick,
}: {
  asset: TransactionNodeAsset;
  isExpanded: boolean;
  onClick: () => void;
}) {
  function handleClick(e: MouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    onClick();
  }

  const pillClass =
    asset.kind === "player" && asset.position && POSITION_COLOR[asset.position]
      ? POSITION_COLOR[asset.position]
      : asset.kind === "pick"
      ? "bg-chart-4/12 text-chart-4"
      : "bg-muted text-muted-foreground";

  return (
    <button
      type="button"
      data-asset-row
      onClick={handleClick}
      onMouseDown={(e) => e.stopPropagation()}
      className={cn(
        "w-full flex items-center gap-2 px-3 py-1 text-left transition-colors border-t border-border/50 first:border-t-0",
        "hover:bg-accent/40",
        isExpanded && "bg-primary/5",
      )}
      aria-label={`${isExpanded ? "Collapse" : "Expand"} ${asset.label}`}
    >
      <span
        className={cn(
          "inline-flex items-center justify-center rounded-full px-1.5 py-0 font-mono text-[9px] font-medium uppercase tracking-wide",
          pillClass,
        )}
      >
        {asset.kind === "player" ? asset.position ?? "?" : "PICK"}
      </span>
      <span className="flex-1 truncate text-[11px] leading-tight" title={asset.label}>
        {asset.label}
      </span>
      <span
        aria-hidden
        className={cn(
          "inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border text-[9px] leading-none",
          isExpanded
            ? "border-primary bg-primary text-primary-foreground"
            : "border-border border-dashed text-muted-foreground",
        )}
      >
        {isExpanded ? "✓" : "+"}
      </span>
    </button>
  );
}

export const TransactionNode = memo(TransactionNodeImpl);
TransactionNode.displayName = "TransactionNode";
