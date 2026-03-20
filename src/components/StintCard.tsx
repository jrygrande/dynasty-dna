"use client";

import { useState } from "react";

interface StintStats {
  totalWeeks: number;
  gamesStarted: number;
  gamesActive: number;
  totalGames: number;
  pctStarted: number;
  pctActive: number;
  ppgWhenStarted: number;
  ppgWhenActive: number;
  totalPoints: number;
  hasNflData: boolean;
}

export interface StintData {
  rosterId: number | null;
  managerName: string | null;
  startSeason: string;
  startWeek: number;
  endSeason: string;
  endWeek: number;
  stats: StintStats | null;
}

interface StintCardProps {
  stint: StintData;
  assetKind: "player" | "pick";
  defaultExpanded?: boolean;
}

function formatStintRange(stint: StintData): string {
  const start = `${stint.startSeason} W${stint.startWeek}`;
  const end = stint.endSeason === "now" ? "Present" : `${stint.endSeason} W${stint.endWeek}`;
  return `${start} → ${end}`;
}

export function StintCard({ stint, assetKind, defaultExpanded = false }: StintCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const isFreeAgent = stint.rosterId === null;
  const hasStats = assetKind === "player" && stint.stats !== null;

  return (
    <div className="relative pl-12">
      {/* Connecting line segment */}
      <div className="absolute left-[18px] top-0 bottom-0 w-0.5 bg-border" />

      <button
        onClick={() => hasStats && setExpanded(!expanded)}
        className={`w-full text-left rounded-md px-3 py-2 transition-colors ${
          isFreeAgent
            ? "border border-dashed border-muted-foreground/30 bg-muted/20"
            : "border bg-card hover:bg-muted/30"
        } ${hasStats ? "cursor-pointer" : "cursor-default"}`}
      >
        <div className="flex items-center justify-between">
          <span className={`text-sm font-medium ${isFreeAgent ? "text-muted-foreground italic" : ""}`}>
            {isFreeAgent ? "Free Agent" : stint.managerName || "Unknown"}
          </span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {formatStintRange(stint)}
            </span>
            {hasStats && (
              <span className="text-xs text-muted-foreground">
                {expanded ? "▲" : "▼"}
              </span>
            )}
          </div>
        </div>

        {/* Quick stat preview when collapsed */}
        {hasStats && !expanded && stint.stats && (
          <div className="flex gap-4 mt-1 text-xs text-muted-foreground">
            <span>{stint.stats.totalWeeks} weeks</span>
            <span>{Math.round(Math.min(stint.stats.pctStarted, 1) * 100)}% started</span>
            <span>{stint.stats.ppgWhenStarted.toFixed(1)} PPG</span>
            <span>{stint.stats.totalPoints.toFixed(1)} pts</span>
          </div>
        )}
      </button>

      {/* Expanded stats grid */}
      {expanded && stint.stats && (
        <div className="mt-1 border rounded-md p-3 bg-card">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <StatCell label="Started" value={`${Math.round(Math.min(stint.stats.pctStarted, 1) * 100)}%`} sub={`${stint.stats.gamesStarted} / ${stint.stats.totalWeeks} weeks`} />
            {stint.stats.hasNflData && (
              <StatCell label="NFL Active" value={`${Math.round(stint.stats.pctActive * 100)}%`} sub={`${stint.stats.gamesActive} / ${stint.stats.totalGames} games`} />
            )}
            <StatCell label="PPG (started)" value={stint.stats.ppgWhenStarted.toFixed(1)} />
            {stint.stats.hasNflData && (
              <StatCell label="PPG (active)" value={stint.stats.ppgWhenActive.toFixed(1)} />
            )}
            <StatCell label="Total Points" value={stint.stats.totalPoints.toFixed(1)} />
            <StatCell label="Weeks" value={String(stint.stats.totalWeeks)} />
          </div>
        </div>
      )}
    </div>
  );
}

function StatCell({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-lg font-bold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
