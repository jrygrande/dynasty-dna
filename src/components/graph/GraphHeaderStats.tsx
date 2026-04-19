"use client";

import type { GraphStats } from "@/lib/assetGraph";

interface GraphHeaderStatsProps {
  stats: GraphStats;
  seasonLabel: string;
}

export function GraphHeaderStats({ stats, seasonLabel }: GraphHeaderStatsProps) {
  return (
    <div className="text-sm text-muted-foreground">
      <span className="font-mono font-medium text-foreground">{stats.totalTransactions}</span> transactions
      <span className="mx-1.5">·</span>
      <span className="font-mono font-medium text-foreground">{stats.totalTenures}</span> tenures
      <span className="mx-1.5">·</span>
      <span className="font-mono font-medium text-foreground">{stats.playersInvolved}</span> players
      {seasonLabel ? (
        <>
          {" "}in <span className="font-medium text-foreground">{seasonLabel}</span>
        </>
      ) : null}
    </div>
  );
}

export default GraphHeaderStats;
