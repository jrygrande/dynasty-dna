"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { FilterChip } from "@/components/FilterChip";
import {
  TransactionCard,
  type TransactionData,
} from "@/components/TransactionCard";
import { Subheader } from "@/components/Subheader";

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

  const filterChips = (
    <>
      {data?.seasons && data.seasons.length > 1 && (
        <div className="flex flex-wrap gap-2">
          <FilterChip
            active={!selectedSeason}
            onClick={() => setSelectedSeason(null)}
          >
            All Seasons
          </FilterChip>
          {data.seasons.map((s) => (
            <FilterChip
              key={s}
              active={selectedSeason === s}
              onClick={() => setSelectedSeason(s)}
            >
              {s}
            </FilterChip>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {typeFilters.map((f) => (
          <FilterChip
            key={f.label}
            active={selectedType === f.value}
            onClick={() => setSelectedType(f.value)}
          >
            {f.label}
          </FilterChip>
        ))}
      </div>
    </>
  );

  return (
      <div>
        <Subheader title="Transactions" rightSlot={filterChips} />

        <main className="container mx-auto px-6 py-8">
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
                <TransactionCard key={tx.id} tx={tx} familyId={familyId} />
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
