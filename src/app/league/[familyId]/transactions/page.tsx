"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  TransactionCard,
  type TransactionData,
} from "@/components/TransactionCard";

interface TransactionsResponse {
  transactions: TransactionData[];
  total: number;
  page: number;
  limit: number;
  seasons: string[];
}

export default function TransactionsPage() {
  const params = useParams();
  const familyId = params.familyId as string;
  const [data, setData] = useState<TransactionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedSeason, setSelectedSeason] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [selectedSeason, selectedType]);

  useEffect(() => {
    loadTransactions();
  }, [familyId, selectedSeason, selectedType, page]);

  async function loadTransactions() {
    setLoading(true);
    const params = new URLSearchParams();
    if (selectedSeason) params.set("season", selectedSeason);
    if (selectedType) params.set("type", selectedType);
    params.set("page", String(page));
    params.set("limit", "50");

    const res = await fetch(
      `/api/leagues/${familyId}/transactions?${params.toString()}`
    );
    if (res.ok) {
      const result = await res.json();
      setData(result);
    }
    setLoading(false);
  }

  const typeFilters = [
    { value: null, label: "All" },
    { value: "trade", label: "Trades" },
    { value: "waiver", label: "Waivers" },
    { value: "free_agent", label: "Free Agents" },
  ];

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto px-6 py-4 flex items-center gap-4">
          <Link
            href={`/league/${familyId}`}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            &larr; League
          </Link>
          <h1 className="text-2xl font-bold">Transactions</h1>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        {/* Filters */}
        <div className="flex flex-wrap gap-4 mb-6">
          {/* Season filter */}
          {data?.seasons && data.seasons.length > 1 && (
            <div className="flex gap-2">
              <button
                onClick={() => setSelectedSeason(null)}
                className={`px-3 py-1 text-sm rounded-full transition-colors ${
                  !selectedSeason
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                }`}
              >
                All Seasons
              </button>
              {data.seasons.map((s) => (
                <button
                  key={s}
                  onClick={() => setSelectedSeason(s)}
                  className={`px-3 py-1 text-sm rounded-full transition-colors ${
                    selectedSeason === s
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          {/* Type filter */}
          <div className="flex gap-2">
            {typeFilters.map((f) => (
              <button
                key={f.label}
                onClick={() => setSelectedType(f.value)}
                className={`px-3 py-1 text-sm rounded-full transition-colors ${
                  selectedType === f.value
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Loading state */}
        {loading && (
          <div className="animate-pulse text-muted-foreground">
            Loading transactions...
          </div>
        )}

        {/* Transaction list */}
        {!loading && data && (
          <>
            <p className="text-sm text-muted-foreground mb-4">
              {data.total} transaction{data.total !== 1 ? "s" : ""}
            </p>

            <div className="space-y-3">
              {data.transactions.map((tx) => (
                <TransactionCard key={tx.id} tx={tx} />
              ))}
            </div>

            {data.transactions.length === 0 && (
              <p className="text-muted-foreground text-center py-8">
                No transactions found
              </p>
            )}

            {/* Pagination */}
            {data.total > data.limit && (
              <div className="flex justify-center gap-2 mt-6">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-3 py-1.5 text-sm rounded-md border hover:bg-secondary transition-colors disabled:opacity-50"
                >
                  Previous
                </button>
                <span className="px-3 py-1.5 text-sm text-muted-foreground">
                  Page {page} of {Math.ceil(data.total / data.limit)}
                </span>
                <button
                  onClick={() => setPage((p) => p + 1)}
                  disabled={page * data.limit >= data.total}
                  className="px-3 py-1.5 text-sm rounded-md border hover:bg-secondary transition-colors disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
