"use client";

import type { GraphStats } from "@/lib/assetGraph";

interface GraphHeaderStatsProps {
  stats: GraphStats;
}

export function GraphHeaderStats({ stats }: GraphHeaderStatsProps) {
  return (
    <div className="text-sm text-muted-foreground">
      <span className="font-mono font-medium text-foreground">{stats.totalTransactions}</span> transactions
      <span className="mx-1.5">·</span>
      <span className="font-mono font-medium text-foreground">{stats.totalTenures}</span> tenures
      <span className="mx-1.5">·</span>
      <span className="font-mono font-medium text-foreground">{stats.playersInvolved}</span> players
    </div>
  );
}

export default GraphHeaderStats;
