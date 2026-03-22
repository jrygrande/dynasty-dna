"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

interface PickGrade {
  grade: string;
  blendedScore: number | null;
  valueScore: number | null;
  productionScore: number | null;
}

interface DraftPick {
  pickNo: number;
  round: number;
  rosterId: number;
  managerName: string;
  playerId: string | null;
  playerName: string;
  position: string | null;
  isKeeper: boolean | null;
  grade: PickGrade | null;
}

interface ManagerGradeSummary {
  rosterId: number;
  managerName: string;
  avgScore: number;
  grade: string;
  picksGraded: number;
}

interface DraftData {
  id: string;
  season: string;
  type: string;
  rounds: number;
  picks: DraftPick[];
  rosterNames: Record<string, string>;
  managerGrades: ManagerGradeSummary[];
}

interface DraftsResponse {
  drafts: DraftData[];
  seasons: string[];
}

const POSITION_COLORS: Record<string, string> = {
  QB: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  RB: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  WR: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  TE: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  K: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
  DEF: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400",
};

import { GradeBadge } from "@/components/GradeBadge";

export default function DraftsPage() {
  const params = useParams();
  const familyId = params.familyId as string;
  const [data, setData] = useState<DraftsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSeason, setSelectedSeason] = useState<string | null>(null);

  useEffect(() => {
    loadDrafts();
  }, [familyId, selectedSeason]);

  async function loadDrafts() {
    setLoading(true);
    setError(null);
    try {
      const seasonQuery = selectedSeason ? `?season=${selectedSeason}` : "";
      const res = await fetch(
        `/api/leagues/${familyId}/drafts${seasonQuery}`
      );
      if (!res.ok) {
        setError("Failed to load drafts");
        return;
      }
      const result = await res.json();
      setData(result);
    } catch {
      setError("Failed to load drafts");
    } finally {
      setLoading(false);
    }
  }

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
          <h1 className="text-2xl font-bold">Draft History</h1>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        {/* Season filter */}
        {data?.seasons && data.seasons.length > 1 && (
          <div className="flex gap-2 mb-6">
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

        {loading && (
          <div className="animate-pulse text-muted-foreground">
            Loading drafts...
          </div>
        )}

        {error && (
          <div className="text-center py-8 text-red-500">{error}</div>
        )}

        {!loading && !error && data && (
          <div className="space-y-10">
            {data.drafts.map((draft) => (
              <DraftBoard key={draft.id} draft={draft} familyId={familyId} />
            ))}
            {data.drafts.length === 0 && (
              <p className="text-muted-foreground text-center py-8">
                No completed drafts found
              </p>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function ManagerGradeCards({ grades }: { grades: ManagerGradeSummary[] }) {
  if (grades.length === 0) return null;

  return (
    <div className="mb-4">
      <h3 className="text-sm font-medium text-muted-foreground mb-2">
        Manager Draft Grades
      </h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
        {grades.map((mg) => (
          <div
            key={mg.rosterId}
            className="flex items-center gap-2 p-2 rounded-lg border bg-card"
          >
            <GradeBadge grade={mg.grade} />
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{mg.managerName}</p>
              <p className="text-xs text-muted-foreground">
                {mg.picksGraded} picks
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DraftBoard({ draft, familyId }: { draft: DraftData; familyId: string }) {
  // Build grid: rows = rounds, columns = pick order within round
  const picksByRound = new Map<number, DraftPick[]>();
  for (const pick of draft.picks) {
    const round = picksByRound.get(pick.round) || [];
    round.push(pick);
    picksByRound.set(pick.round, round);
  }

  // Use the max picks in any round to determine column count
  const picksPerRound = Math.max(
    ...Array.from(picksByRound.values()).map((p) => p.length),
    0
  );

  return (
    <section>
      <div className="flex items-baseline gap-3 mb-4">
        <h2 className="text-lg font-semibold">{draft.season} Draft</h2>
        <span className="text-sm text-muted-foreground capitalize">
          {draft.type} &middot; {draft.rounds} rounds
        </span>
      </div>

      <ManagerGradeCards grades={draft.managerGrades || []} />

      <div className="border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground w-16">
                Round
              </th>
              {Array.from({ length: picksPerRound }, (_, i) => (
                <th
                  key={i}
                  className="px-3 py-2 text-left font-medium text-muted-foreground min-w-[140px]"
                >
                  Pick {i + 1}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: draft.rounds }, (_, roundIdx) => {
              const round = roundIdx + 1;
              const picks = picksByRound.get(round) || [];
              return (
                <tr key={round} className="border-t">
                  <td className="px-3 py-2 font-mono text-muted-foreground font-medium">
                    R{round}
                  </td>
                  {picks.map((pick) => (
                    <td key={pick.pickNo} className="px-3 py-2">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-1.5">
                          {pick.position && (
                            <span
                              className={`px-1.5 py-0.5 text-[10px] font-semibold rounded ${POSITION_COLORS[pick.position] || ""}`}
                            >
                              {pick.position}
                            </span>
                          )}
                          {pick.playerId ? (
                            <Link
                              href={`/league/${familyId}/player/${pick.playerId}`}
                              className="font-medium text-sm truncate hover:underline"
                            >
                              {pick.playerName}
                            </Link>
                          ) : (
                            <span className="font-medium text-sm truncate">
                              {pick.playerName}
                            </span>
                          )}
                          {pick.grade && (
                            <GradeBadge grade={pick.grade.grade} size="xs" />
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground truncate">
                          {pick.managerName}
                          {pick.isKeeper && (
                            <span className="ml-1 text-amber-600 dark:text-amber-400">
                              (K)
                            </span>
                          )}
                        </p>
                      </div>
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
