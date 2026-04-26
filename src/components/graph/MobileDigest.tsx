"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import type { GraphResponse } from "@/lib/assetGraph";
import type { EnrichedTransaction } from "@/lib/transactionEnrichment";
import { TransactionCard, type TransactionData } from "@/components/TransactionCard";
import { trackEvent } from "@/lib/analytics";

interface MobileDigestProps {
  familyId: string;
  response: GraphResponse | null;
  loading: boolean;
}

function toTransactionData(tx: EnrichedTransaction): TransactionData {
  return {
    ...tx,
    draftPicks: tx.draftPicks.map((p) => ({
      ...p,
      originalOwnerName: p.originalOwnerName ?? undefined,
    })),
  };
}

function hopCount(tx: EnrichedTransaction): number {
  return (tx.adds?.length ?? 0) + (tx.draftPicks?.length ?? 0);
}

export function MobileDigest({ familyId, response, loading }: MobileDigestProps) {
  useEffect(() => {
    trackEvent("graph_mobile_bounce", { familyId });
  }, [familyId]);

  const topTransactions = useMemo<EnrichedTransaction[]>(() => {
    if (!response) return [];
    return Object.values(response.transactions)
      .filter((t) => t.type === "trade")
      .sort((a, b) => hopCount(b) - hopCount(a))
      .slice(0, 5);
  }, [response]);

  return (
    <div className="min-h-screen p-4 space-y-4">
      <div className="border-b pb-3">
        <Link
          href={`/league/${familyId}`}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          &larr; League
        </Link>
        <h1 className="text-lg font-semibold mt-2">Lineage Tracer</h1>
        <p className="text-xs text-muted-foreground mt-1">
          Open on desktop for the full interactive graph.
        </p>
      </div>

      {loading && (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-24 rounded-lg border bg-muted/30 animate-pulse"
            />
          ))}
        </div>
      )}

      {!loading && response && (
        <>
          <section>
            <h2 className="text-sm font-medium mb-2">Network stats</h2>
            <p className="text-sm text-muted-foreground">
              <span className="text-foreground font-semibold font-mono">
                {response.stats.totalTransactions}
              </span>{" "}
              transactions ·{" "}
              <span className="text-foreground font-semibold font-mono">
                {response.stats.totalTenures}
              </span>{" "}
              tenures tracked.
            </p>
          </section>

          <section>
            <h2 className="text-sm font-medium mb-2">Top trades by hop count</h2>
            {topTransactions.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No trades in the current filter.
              </p>
            ) : (
              <div className="space-y-2">
                {topTransactions.map((tx) => (
                  <Link
                    key={tx.id}
                    href={`/league/${familyId}/transactions`}
                    className="block"
                  >
                    <TransactionCard tx={toTransactionData(tx)} familyId={familyId} />
                  </Link>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {!loading && !response && (
        <p className="text-sm text-muted-foreground">
          Couldn&apos;t load the graph. Try again from desktop.
        </p>
      )}
    </div>
  );
}

export default MobileDigest;
