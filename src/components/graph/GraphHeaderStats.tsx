"use client";

import type { GraphStats } from "@/lib/assetGraph";

interface GraphHeaderStatsProps {
  stats: GraphStats;
  seasonLabel: string;
}

/**
 * One-line at-a-glance strip summarizing graph activity for the selected
 * season(s). Part of the Asset Graph Browser header.
 */
export function GraphHeaderStats({ stats, seasonLabel }: GraphHeaderStatsProps) {
  const trades = stats.totalTrades ?? 0;
  const multiHop = stats.multiHopChains ?? 0;
  const picksTraded = stats.picksTraded ?? 0;
  return (
    <div className="text-sm text-muted-foreground">
      <span className="font-medium text-foreground">{trades}</span> trades
      <span className="mx-1.5">·</span>
      <span className="font-medium text-foreground">{multiHop}</span> multi-hop chains
      <span className="mx-1.5">·</span>
      <span className="font-medium text-foreground">{picksTraded}</span> picks traded
      {seasonLabel ? (
        <>
          {" "}in <span className="font-medium text-foreground">{seasonLabel}</span>
        </>
      ) : null}
    </div>
  );
}

export default GraphHeaderStats;
