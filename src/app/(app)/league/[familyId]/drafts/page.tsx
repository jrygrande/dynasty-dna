"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { FilterChip } from "@/components/FilterChip";
import { PositionChip } from "@/components/PositionChip";
import { Subheader } from "@/components/Subheader";

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

import { GradeBadge } from "@/components/GradeBadge";
import { ManagerName } from "@/components/ManagerName";

export default function DraftsPage() {
  const params = useParams();
  const familyId = params.familyId as string;
  const [data, setData] = useState<DraftsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSeason, setSelectedSeason] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    const seasonQuery = selectedSeason ? `?season=${selectedSeason}` : "";
    fetch(`/api/leagues/${familyId}/drafts${seasonQuery}`, {
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load drafts");
        return res.json();
      })
      .then((result) => setData(result))
      .catch((err) => {
        if (err.name === "AbortError") return;
        setError("Failed to load drafts");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [familyId, selectedSeason]);

  const seasonChips =
    data?.seasons && data.seasons.length > 1 ? (
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
    ) : null;

  return (
      <div>
        <Subheader title="Draft History" rightSlot={seasonChips} />

        <main className="container mx-auto px-6 py-8">
        {loading && (
          <div className="animate-pulse text-muted-foreground">
            Loading drafts...
          </div>
        )}

        {error && (
          <div className="text-center py-8 text-grade-f">{error}</div>
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
              <p className="text-sm font-medium truncate">
                <ManagerName
                  rosterId={mg.rosterId}
                  displayName={mg.managerName}
                  variant="display-only"
                />
              </p>
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
                          <PositionChip position={pick.position} size="xs" />
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
                          <ManagerName
                            rosterId={pick.rosterId}
                            displayName={pick.managerName}
                            variant="display-only"
                          />
                          {pick.isKeeper && (
                            <span className="ml-1 text-primary">
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
