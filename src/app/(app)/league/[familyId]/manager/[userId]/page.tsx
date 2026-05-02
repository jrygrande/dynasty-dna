"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { GradeBadge } from "@/components/GradeBadge";
import { ManagerRadarChart } from "@/components/ManagerRadarChart";
import { ManagerGradeCard } from "@/components/ManagerGradeCard";
import { ManagerName, ManagerSecondaryName } from "@/components/ManagerName";
import { TypeBadge } from "@/components/TransactionCard";
import { PILLAR_LABELS } from "@/lib/pillars";

interface SeasonRow {
  season: string;
  [metric: string]: unknown;
}

interface Transaction {
  id: string;
  type: string;
  season: string;
  week: number;
  adds: Array<{ id: string; name: string; position: string | null; team: string | null }>;
  drops: Array<{ id: string; name: string; position: string | null; team: string | null }>;
  grade: string | null;
  score: number | null;
  createdAt: number | null;
}

interface ManagerData {
  manager: {
    userId: string;
    displayName: string;
    teamName: string | null;
    avatar: string | null;
  };
  overallScore: { value: number; grade: string; percentile: number } | null;
  pillarScores: Record<string, { value: number; grade: string; percentile: number } | null>;
  seasonHistory: SeasonRow[];
  recentTransactions: Transaction[];
  seasons: Array<{ leagueId: string; season: string }>;
}

export default function ManagerPage() {
  const params = useParams();
  const familyId = params.familyId as string;
  const userId = params.userId as string;

  const [data, setData] = useState<ManagerData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      try {
        const res = await fetch(`/api/leagues/${familyId}/manager/${userId}`);
        if (res.ok) {
          setData(await res.json());
        }
      } catch (err) {
        console.error("Failed to load manager data:", err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [familyId, userId]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">
          Loading manager...
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Manager not found</p>
      </div>
    );
  }

  const { manager, overallScore, pillarScores, seasonHistory, recentTransactions } = data;

  return (
    <div>
      {/* Sub-header */}
      <div className="border-b">
        <div className="container mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href={`/league/${familyId}`}
              className="text-sm text-muted-foreground hover:text-primary transition-colors inline-flex items-center gap-1.5"
            >
              <ArrowLeft className="h-4 w-4" />
              League
            </Link>
            <span className="text-muted-foreground">/</span>
            <h1 className="text-lg font-semibold">
              <ManagerName
                userId={manager.userId}
                displayName={manager.displayName}
                teamName={manager.teamName}
              />
            </h1>
            <ManagerSecondaryName
              userId={manager.userId}
              displayName={manager.displayName}
              teamName={manager.teamName}
              parens={false}
              className="text-sm text-muted-foreground"
            />
          </div>
        </div>
      </div>

      <main className="container mx-auto px-6 py-8 space-y-8">
        {/* Top section: Grade card + Radar chart */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <ManagerGradeCard
            overallScore={overallScore}
            pillarScores={pillarScores}
          />
          <div className="border rounded-lg p-4">
            <h2 className="text-sm font-medium text-muted-foreground mb-2">
              Manager DNA
            </h2>
            <ManagerRadarChart pillarScores={pillarScores} />
          </div>
        </div>

        {/* Season History */}
        {seasonHistory.length > 0 && (
          <section>
            <h2 className="text-lg font-semibold mb-4">Season History</h2>
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full">
                <thead className="bg-muted/50">
                  <tr className="text-left text-sm">
                    <th className="px-4 py-3 font-medium">Season</th>
                    {Object.values(PILLAR_LABELS).map((label) => (
                      <th
                        key={label}
                        className="px-4 py-3 font-medium text-center"
                      >
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {seasonHistory.map((row) => (
                    <tr
                      key={row.season}
                      className="border-t hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-4 py-3 font-mono text-sm">
                        {row.season}
                      </td>
                      {Object.keys(PILLAR_LABELS).map((key) => {
                        const metric = row[key] as
                          | { value: number; grade: string; percentile: number }
                          | undefined;
                        return (
                          <td key={key} className="px-4 py-3 text-center">
                            {metric ? (
                              <div className="flex items-center justify-center gap-2">
                                <span className="font-mono text-sm">
                                  {Math.round(metric.percentile)}%
                                </span>
                                <GradeBadge grade={metric.grade} size="xs" />
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">
                                --
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Recent Transactions */}
        {recentTransactions.length > 0 && (
          <section>
            <h2 className="text-lg font-semibold mb-4">
              Recent Transactions
            </h2>
            <div className="space-y-3">
              {recentTransactions.map((tx) => (
                <div
                  key={tx.id}
                  className="border rounded-lg px-4 py-3 flex items-start justify-between gap-4"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <TypeBadge type={tx.type} />
                      <span className="text-xs text-muted-foreground">
                        {tx.season} W{tx.week}
                      </span>
                    </div>
                    <div className="text-sm">
                      {tx.adds.length > 0 && (
                        <span className="text-primary">
                          +{tx.adds.map((p) => p.name).join(", ")}
                        </span>
                      )}
                      {tx.adds.length > 0 && tx.drops.length > 0 && (
                        <span className="text-muted-foreground mx-1">/</span>
                      )}
                      {tx.drops.length > 0 && (
                        <span className="text-muted-foreground">
                          −{tx.drops.map((p) => p.name).join(", ")}
                        </span>
                      )}
                    </div>
                  </div>
                  {tx.grade && <GradeBadge grade={tx.grade} size="xs" />}
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
