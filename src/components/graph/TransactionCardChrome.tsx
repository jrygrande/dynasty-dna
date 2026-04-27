"use client";

import { type MouseEvent, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import type { TransactionKind } from "@/lib/assetGraph";
import { HashFlourish } from "@/components/BrandMark";
import type { TransactionHeader } from "./transactionHeader";

export interface TransactionNodeAsset {
  kind: "player" | "pick";
  assetKey: string;
  label: string;
  position?: string | null;
  toUserId: string | null;
  toName: string | null;
  fromUserId: string | null;
}

export interface TransactionCardChromeData {
  txKind: TransactionKind;
  header: TransactionHeader;
  managers: Array<{ userId: string; displayName: string }>;
  assets: TransactionNodeAsset[];
  expandedAssets: Set<string>;
  chainAssetKeys: Set<string>;
  headerExpanded: boolean;
  selected?: boolean;
  dimmed?: boolean;
  onHeaderToggle?: (nodeId: string) => void;
  onAssetClick?: (nodeId: string, assetKey: string) => void;
  onSelect?: (nodeId: string) => void;
}

export interface TransactionCardChromeProps {
  nodeId: string;
  data: TransactionCardChromeData;
  isSelected: boolean;
  hoveredAssetKey: string | null;
  onAssetHover: (assetKey: string | null) => void;
  /**
   * Slot for React Flow handle elements. Rendered inside the card root
   * so they participate in the same coordinate space as the body.
   */
  handles?: ReactNode;
  /**
   * Slot for per-asset-row handle elements. Receives the asset's key and
   * returns the handles to mount inside that row's relative-positioned
   * wrapper. Skipped when slot returns null.
   */
  renderAssetHandles?: (assetKey: string) => ReactNode;
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
  trade: "bg-sage-500",
  waiver: "bg-chart-3",
  free_agent: "bg-chart-5",
  commissioner: "bg-slate-400",
};

const POSITION_COLOR: Record<string, string> = {
  QB: "bg-grade-f/15 text-grade-f",
  RB: "bg-grade-b/15 text-grade-b",
  WR: "bg-grade-a/15 text-grade-a",
  TE: "bg-grade-d/15 text-grade-d",
  K: "bg-chart-4/15 text-chart-4",
  DEF: "bg-muted text-muted-foreground",
};

const POSITION_ORDER: Record<string, number> = { QB: 0, RB: 1, WR: 2, TE: 3, K: 4, DEF: 5 };

function sortAssets(a: TransactionNodeAsset, b: TransactionNodeAsset): number {
  if (a.kind !== b.kind) return a.kind === "player" ? -1 : 1;
  if (a.kind === "player") {
    const aP = POSITION_ORDER[a.position ?? ""] ?? 99;
    const bP = POSITION_ORDER[b.position ?? ""] ?? 99;
    if (aP !== bP) return aP - bP;
    return a.label.localeCompare(b.label);
  }
  return a.label.localeCompare(b.label);
}

export function TransactionCardChrome({
  nodeId,
  data,
  isSelected,
  hoveredAssetKey,
  onAssetHover,
  handles,
  renderAssetHandles,
}: TransactionCardChromeProps) {
  const visibleAssets = data.headerExpanded
    ? data.assets
    : data.assets.filter((a) => data.chainAssetKeys.has(a.assetKey));

  // Group visible assets by recipient manager. For single-manager transactions
  // (draft/waiver/FA) there's only one bucket; for trades there are two.
  const buckets = new Map<
    string,
    { userId: string | null; displayName: string; assets: TransactionNodeAsset[] }
  >();
  for (const a of visibleAssets) {
    const key = a.toUserId ?? "__none__";
    const name = a.toName ?? "—";
    const bucket = buckets.get(key);
    if (bucket) bucket.assets.push(a);
    else buckets.set(key, { userId: a.toUserId, displayName: name, assets: [a] });
  }
  for (const bucket of buckets.values()) {
    bucket.assets.sort(sortAssets);
  }

  function handleNodeClick(e: MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;
    if (target.closest("[data-asset-row]") || target.closest("button")) return;
    data.onSelect?.(nodeId);
  }

  function handleHeaderClick(e: MouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    data.onHeaderToggle?.(nodeId);
  }

  return (
    <div
      className={cn(
        "group relative rounded-xl border border-border/60 bg-card text-card-foreground shadow-sm transition-shadow hover:shadow-md",
        isSelected && "ring-2 ring-primary",
        data.dimmed && "opacity-30",
      )}
      style={{ width: 260 }}
      aria-label={data.header.title}
      onClick={handleNodeClick}
    >
      {handles}
      <span
        className={cn(
          "absolute left-0 top-0 h-full w-1 rounded-l-xl",
          KIND_ACCENT[data.txKind],
        )}
        aria-hidden="true"
      />
      <button
        type="button"
        aria-expanded={data.headerExpanded}
        onClick={handleHeaderClick}
        onMouseDown={(e) => e.stopPropagation()}
        className={cn(
          "block w-full text-left pl-3 pr-2.5 py-1.5",
          "hover:bg-accent/30 transition-colors",
        )}
      >
        <div className="flex items-center justify-between gap-2">
          {/* Allowed per design: graph headers may use Source Serif 4 (relaxes marketing-only rule). */}
          <span
            className="truncate font-serif text-sm font-medium leading-tight text-sage-800"
            title={data.header.title}
          >
            {data.header.title}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground shrink-0">
            {KIND_LABEL[data.txKind]}
          </span>
        </div>
        <div
          className="font-mono text-[10px] text-muted-foreground truncate"
          title={data.header.subtitle}
        >
          {data.header.subtitle}
        </div>
      </button>
      {buckets.size > 0 && (
        <div className="border-t border-border/60">
          {Array.from(buckets.values()).map((bucket, idx) => (
            <div key={bucket.userId ?? idx}>
              {idx > 0 && <HashFlourish className="block mx-auto my-1" />}
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
                  isHovered={hoveredAssetKey === asset.assetKey}
                  onClick={() => data.onAssetClick?.(nodeId, asset.assetKey)}
                  onHover={(hovered) => onAssetHover(hovered ? asset.assetKey : null)}
                  handles={renderAssetHandles?.(asset.assetKey) ?? null}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AssetRow({
  asset,
  isExpanded,
  isHovered,
  onClick,
  onHover,
  handles,
}: {
  asset: TransactionNodeAsset;
  isExpanded: boolean;
  isHovered: boolean;
  onClick: () => void;
  onHover: (hovered: boolean) => void;
  handles: ReactNode;
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
    <div className="relative">
      {handles}
      <button
        type="button"
        data-asset-row
        onClick={handleClick}
        onMouseDown={(e) => e.stopPropagation()}
        onMouseEnter={() => onHover(true)}
        onMouseLeave={() => onHover(false)}
        className={cn(
          "w-full flex items-center gap-2 px-3 py-1 text-left transition-colors border-t border-border/50 first:border-t-0",
          "hover:bg-accent/40",
          isExpanded && "bg-primary/5",
          isHovered && !isExpanded && "bg-accent/30",
        )}
        aria-label={`${isExpanded ? "Untrace thread" : "Trace thread"} ${asset.label}`}
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
    </div>
  );
}
