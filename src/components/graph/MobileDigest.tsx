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

  const managerPairs = useMemo(() => {
    if (!response) return [];
    const nodes = response.nodes;
    const managerById = new Map(
      nodes.filter((n) => n.kind === "manager").map((n) => [n.id, n])
    );
    const counts = new Map<string, { a: string; b: string; count: number }>();
    for (const e of response.edges) {
      if (!e.transactionId) continue;
      const source = managerById.get(e.source);
      const target = managerById.get(e.target);
      if (!source || !target) continue;
      if (source.kind !== "manager" || target.kind !== "manager") continue;
      const pair = [source.displayName, target.displayName].sort();
      const key = `${pair[0]}||${pair[1]}`;
      const existing = counts.get(key);
      if (existing) existing.count += 1;
      else counts.set(key, { a: pair[0], b: pair[1], count: 1 });
    }
    return Array.from(counts.values())
      .sort((x, y) => y.count - x.count)
      .slice(0, 8);
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
        <h1 className="text-lg font-semibold mt-2">Trade network digest</h1>
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
            <h2 className="text-sm font-medium mb-2">Multi-hop chains this season</h2>
            <p className="text-sm text-muted-foreground">
              <span className="text-foreground font-semibold text-lg">
                {response.stats.multiHopChains}
              </span>{" "}
              chain{response.stats.multiHopChains === 1 ? "" : "s"} with 3+ legs.
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

          <section>
            <h2 className="text-sm font-medium mb-2">Manager-to-manager trade frequency</h2>
            {managerPairs.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No trades between managers in the current filter.
              </p>
            ) : (
              <div className="border rounded-md overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs text-muted-foreground">
                    <tr>
                      <th className="text-left font-medium px-3 py-2">Managers</th>
                      <th className="text-right font-medium px-3 py-2">Edges</th>
                    </tr>
                  </thead>
                  <tbody>
                    {managerPairs.map((p) => (
                      <tr key={`${p.a}||${p.b}`} className="border-t">
                        <td className="px-3 py-2">
                          {p.a} &harr; {p.b}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-xs">
                          {p.count}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
