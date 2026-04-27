"use client";

import { type MouseEvent, type ReactNode } from "react";
import {
  ArrowLeftRight,
  ChevronDown,
  ChevronUp,
  Hourglass,
  Shield,
  UserPlus,
  Wrench,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { TransactionKind } from "@/lib/assetGraph";
import type { TransactionHeader } from "./transactionHeader";

export interface TransactionNodeAsset {
  kind: "player" | "pick";
  assetKey: string;
  label: string;
  /** Optional muted suffix shown after the label (e.g. "(jrygrande)" on pick rows). */
  ownerLabel?: string;
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

interface KindStyle {
  color: ColorKey;
  icon: LucideIcon;
  label: string;
}

type ColorKey = "primary" | "chart-4" | "chart-5" | "chart-3" | "slate-400";

const KIND_STYLE: Record<TransactionKind, KindStyle> = {
  trade: { color: "primary", icon: ArrowLeftRight, label: "Trade" },
  draft: { color: "chart-4", icon: Shield, label: "Draft" },
  free_agent: { color: "chart-5", icon: UserPlus, label: "Free agent" },
  waiver: { color: "chart-3", icon: Hourglass, label: "Waiver" },
  commissioner: { color: "slate-400", icon: Wrench, label: "Commish" },
};

interface ColorClasses {
  /** Icon container background tint. */
  iconBg: string;
  /** Icon container hover background (deeper tint). */
  iconBgHover: string;
  /** Icon glyph color. */
  iconText: string;
  /** Pinned-right type badge classes (background + text). */
  pill: string;
}

const COLOR_CLASSES: Record<ColorKey, ColorClasses> = {
  primary: {
    iconBg: "bg-primary/15",
    iconBgHover: "group-hover:bg-primary/25",
    iconText: "text-primary",
    pill: "bg-primary/12 text-primary",
  },
  "chart-4": {
    iconBg: "bg-chart-4/15",
    iconBgHover: "group-hover:bg-chart-4/25",
    iconText: "text-chart-4",
    pill: "bg-chart-4/12 text-chart-4",
  },
  "chart-5": {
    iconBg: "bg-chart-5/15",
    iconBgHover: "group-hover:bg-chart-5/25",
    iconText: "text-chart-5",
    pill: "bg-chart-5/12 text-chart-5",
  },
  "chart-3": {
    iconBg: "bg-chart-3/15",
    iconBgHover: "group-hover:bg-chart-3/25",
    iconText: "text-chart-3",
    pill: "bg-chart-3/12 text-chart-3",
  },
  "slate-400": {
    iconBg: "bg-slate-400/15",
    iconBgHover: "group-hover:bg-slate-400/25",
    iconText: "text-slate-500",
    pill: "bg-slate-400/15 text-slate-500",
  },
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

type RowState = "available" | "on-graph" | "traced-elsewhere";

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

  const hiddenCount = data.assets.length - visibleAssets.length;
  const showToggleBar = hiddenCount > 0 || data.headerExpanded;
  const allHiddenArePicks =
    hiddenCount > 0 &&
    data.assets.filter((a) => !data.chainAssetKeys.has(a.assetKey)).every((a) => a.kind === "pick");

  function handleNodeClick(e: MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;
    if (target.closest("[data-asset-row]") || target.closest("button")) return;
    data.onSelect?.(nodeId);
  }

  function handleHeaderToggle(e: MouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    data.onHeaderToggle?.(nodeId);
  }

  const style = KIND_STYLE[data.txKind];
  const colors = COLOR_CLASSES[style.color];
  const Icon = style.icon;

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
      <button
        type="button"
        aria-expanded={data.headerExpanded}
        onClick={handleHeaderToggle}
        onMouseDown={(e) => e.stopPropagation()}
        className={cn(
          "block w-full text-left px-2.5 py-2",
          "hover:bg-accent/30 transition-colors",
        )}
      >
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className={cn(
              "flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
              colors.iconBg,
              colors.iconBgHover,
              "transition-[transform,background-color] [transition-duration:350ms] [transition-timing-function:cubic-bezier(0.34,1.56,0.64,1)]",
              "motion-reduce:transition-none",
            )}
          >
            <Icon
              className={cn(
                "h-3.5 w-3.5",
                colors.iconText,
                "transition-transform [transition-duration:350ms] [transition-timing-function:cubic-bezier(0.34,1.56,0.64,1)]",
                "group-hover:scale-[1.08] group-hover:-rotate-[4deg]",
                "motion-reduce:transition-none motion-reduce:transform-none",
              )}
            />
          </span>
          <div className="flex-1 min-w-0 flex flex-col">
            {/* Allowed per design: graph headers may use Source Serif 4 (relaxes marketing-only rule). */}
            <span
              className="truncate font-serif text-[15px] font-medium leading-tight text-sage-800"
              title={data.header.title}
            >
              {data.header.title}
            </span>
            <span
              className="font-mono text-[11px] text-muted-foreground truncate"
              title={data.header.subtitle}
            >
              {data.header.subtitle}
            </span>
          </div>
          <span
            className={cn(
              "shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide",
              colors.pill,
            )}
          >
            {style.label}
          </span>
        </div>
      </button>
      {buckets.size > 0 && (
        <div className="border-t border-border/40">
          {Array.from(buckets.values()).map((bucket, idx) => (
            <div key={bucket.userId ?? idx} className={cn(idx > 0 && "border-t border-border/40")}>
              <div className="flex items-center gap-1 px-3 py-1">
                <span aria-hidden className="text-muted-foreground text-[10px]">→</span>
                <span className="font-mono text-[10px] uppercase tracking-wide font-medium text-muted-foreground truncate">
                  {bucket.displayName}
                </span>
              </div>
              {bucket.assets.map((asset) => {
                const isOnGraph = data.chainAssetKeys.has(asset.assetKey);
                const isExpandedElsewhere =
                  data.expandedAssets.has(asset.assetKey) && !isOnGraph;
                const rowState: RowState = isOnGraph
                  ? "on-graph"
                  : isExpandedElsewhere
                    ? "traced-elsewhere"
                    : "available";
                return (
                  <AssetRow
                    key={asset.assetKey}
                    asset={asset}
                    rowState={rowState}
                    isHovered={hoveredAssetKey === asset.assetKey}
                    onClick={() => data.onAssetClick?.(nodeId, asset.assetKey)}
                    onHover={(hovered) => onAssetHover(hovered ? asset.assetKey : null)}
                    handles={renderAssetHandles?.(asset.assetKey) ?? null}
                  />
                );
              })}
            </div>
          ))}
        </div>
      )}
      {showToggleBar && (
        <button
          type="button"
          onClick={handleHeaderToggle}
          onMouseDown={(e) => e.stopPropagation()}
          aria-expanded={data.headerExpanded}
          className={cn(
            "flex w-full items-center justify-center gap-1 border-t border-border/40 bg-muted/30 px-3 py-1.5",
            "text-[11px] text-muted-foreground hover:bg-muted/50 transition-colors rounded-b-xl",
          )}
        >
          <span>{toggleBarCopy(data.headerExpanded, hiddenCount, data.txKind, data.assets.length, allHiddenArePicks)}</span>
          {data.headerExpanded ? (
            <ChevronUp className="size-3 text-muted-foreground" />
          ) : (
            <ChevronDown className="size-3 text-muted-foreground" />
          )}
        </button>
      )}
    </div>
  );
}

function toggleBarCopy(
  expanded: boolean,
  hiddenCount: number,
  txKind: TransactionKind,
  totalCount: number,
  allHiddenArePicks: boolean,
): string {
  if (expanded) return "Collapse";
  if (txKind === "draft" && allHiddenArePicks) {
    return `Show full draft (${totalCount} picks)`;
  }
  return `Show ${hiddenCount} more ${allHiddenArePicks ? "picks" : "assets"}`;
}

function AssetRow({
  asset,
  rowState,
  isHovered,
  onClick,
  onHover,
  handles,
}: {
  asset: TransactionNodeAsset;
  rowState: RowState;
  isHovered: boolean;
  onClick: () => void;
  onHover: (hovered: boolean) => void;
  handles: ReactNode;
}) {
  function handleClick(e: MouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    onClick();
  }

  const isTraced = rowState !== "available";
  const positionPillClass = isTraced
    ? "bg-sage-100 text-sage-700"
    : asset.kind === "player" && asset.position && POSITION_COLOR[asset.position]
      ? POSITION_COLOR[asset.position]
      : asset.kind === "pick"
        ? "bg-chart-4/12 text-chart-4"
        : "bg-muted text-muted-foreground";

  const labelText =
    rowState === "on-graph"
      ? `Untrace thread ${asset.label}`
      : `Trace thread ${asset.label}`;

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
          "w-full flex items-center gap-2 px-3 py-1 text-left transition-colors",
          "hover:bg-accent/40",
          isTraced && "bg-sage-50 border-l-2 border-primary rounded-r-md",
          rowState === "traced-elsewhere" && "opacity-[0.55]",
          rowState === "available" && isHovered && "bg-accent/30",
        )}
        aria-label={labelText}
      >
        <span
          className={cn(
            "inline-flex items-center justify-center rounded-full px-1.5 py-0 font-mono text-[9px] font-medium uppercase tracking-wide",
            positionPillClass,
          )}
        >
          {asset.kind === "player" ? asset.position ?? "?" : "PICK"}
        </span>
        <span
          className={cn(
            "flex-1 truncate text-[11px] leading-tight",
            isTraced ? "font-medium" : "font-normal",
          )}
          title={asset.ownerLabel ? `${asset.label} ${asset.ownerLabel}` : asset.label}
        >
          {asset.label}
          {asset.ownerLabel ? (
            <span className="ml-1 text-[10px] text-muted-foreground">{asset.ownerLabel}</span>
          ) : null}
        </span>
        <RowStateIndicator state={rowState} />
      </button>
    </div>
  );
}

const ROW_INDICATOR: Record<RowState, { glyph: string; classes: string }> = {
  available: {
    glyph: "+",
    classes: "border border-dashed border-border text-muted-foreground",
  },
  "on-graph": {
    glyph: "✓",
    classes: "bg-primary text-primary-foreground",
  },
  "traced-elsewhere": {
    glyph: "✓",
    classes: "bg-slate-400 text-primary-foreground",
  },
};

function RowStateIndicator({ state }: { state: RowState }) {
  const { glyph, classes } = ROW_INDICATOR[state];
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[11px] leading-none",
        classes,
      )}
    >
      {glyph}
    </span>
  );
}
