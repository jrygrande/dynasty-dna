"use client";

import { Fragment, useEffect, useState, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useFlag } from "@/lib/useFlag";

interface Manager {
  userId: string;
  displayName: string;
}

interface WeekEntry {
  season: string;
  week: number;
  leagueId: string;
  manager: { userId: string; displayName: string; rosterId: number } | null;
  fantasyStatus: "starter" | "bench";
  lineupSlot: string | null;
  points: number;
  nflStatus: string | null;
  nflStatusAbbr: string | null;
  isByeWeek: boolean;
}

interface PlayerInfo {
  id: string;
  name: string;
  position: string | null;
  team: string | null;
  gsisId: string | null;
}

interface WeeklyLogData {
  player: PlayerInfo | null;
  weeks: WeekEntry[];
  managers: Manager[];
  availableSeasons: string[];
}

function nflStatusLabel(status: string | null, isByeWeek: boolean): string {
  if (isByeWeek) return "BYE";
  if (!status) return "—";
  switch (status) {
    case "ACT": return "Active";
    case "RES": return "IR/Reserve";
    case "INA": return "Inactive";
    case "DEV": return "Practice Squad";
    case "CUT": return "Cut";
    default: return status;
  }
}

function nflStatusColor(status: string | null, isByeWeek: boolean): string {
  if (isByeWeek) return "text-grade-b";
  if (!status) return "text-muted-foreground";
  switch (status) {
    case "ACT": return "text-grade-a";
    case "RES": return "text-grade-d";
    case "INA": return "text-muted-foreground";
    case "DEV": return "text-grade-b";
    case "CUT": return "text-grade-f";
    default: return "text-muted-foreground";
  }
}

function fantasyStatusBadge(entry: WeekEntry): { label: string; className: string } {
  if (entry.fantasyStatus === "starter") {
    const slot = entry.lineupSlot || "Starter";
    if (entry.nflStatus === "RES" || entry.nflStatus === "INA") {
      return { label: slot, className: "bg-grade-f/12 text-grade-f" };
    }
    return { label: slot, className: "bg-grade-a/12 text-grade-a" };
  }
  if (entry.points >= 15) {
    return { label: "Bench", className: "bg-grade-c/15 text-grade-c" };
  }
  return { label: "Bench", className: "bg-secondary text-secondary-foreground" };
}

export default function PlayerDetailPage() {
  const params = useParams();
  const familyId = params.familyId as string;
  const playerId = params.playerId as string;

  const [data, setData] = useState<WeeklyLogData | null>(null);
  const [loading, setLoading] = useState(true);
  const graphEnabled = useFlag("ASSET_GRAPH_BROWSER");

  // Filters
  const [selectedSeason, setSelectedSeason] = useState<string | null>(null);
  const [selectedManager, setSelectedManager] = useState<string | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<"all" | "starter" | "bench">("all");

  useEffect(() => {
    loadData();
  }, [familyId, playerId, selectedSeason]);

  async function loadData() {
    setLoading(true);
    const params = new URLSearchParams();
    if (selectedSeason) params.set("season", selectedSeason);

    const res = await fetch(
      `/api/leagues/${familyId}/player/${playerId}/weekly-log?${params.toString()}`
    );
    if (res.ok) {
      setData(await res.json());
    }
    setLoading(false);
  }

  // Client-side filters (manager + starter/bench applied after fetch)
  const filteredWeeks = useMemo(() => {
    if (!data) return [];
    let weeks = data.weeks;
    if (selectedManager) {
      weeks = weeks.filter((w) => w.manager?.userId === selectedManager);
    }
    if (selectedStatus === "starter") {
      weeks = weeks.filter((w) => w.fantasyStatus === "starter");
    } else if (selectedStatus === "bench") {
      weeks = weeks.filter((w) => w.fantasyStatus === "bench");
    }
    return weeks;
  }, [data, selectedManager, selectedStatus]);

  // Summary stats
  const stats = useMemo(() => {
    if (filteredWeeks.length === 0) return null;
    const totalWeeks = filteredWeeks.length;
    const starterWeeks = filteredWeeks.filter((w) => w.fantasyStatus === "starter").length;
    const benchWeeks = totalWeeks - starterWeeks;
    const totalPoints = filteredWeeks.reduce((sum, w) => sum + w.points, 0);
    const starterPoints = filteredWeeks
      .filter((w) => w.fantasyStatus === "starter")
      .reduce((sum, w) => sum + w.points, 0);
    const ppgAll = totalPoints / totalWeeks;
    const ppgStarter = starterWeeks > 0 ? starterPoints / starterWeeks : 0;

    return { totalWeeks, starterWeeks, benchWeeks, totalPoints, ppgAll, ppgStarter };
  }, [filteredWeeks]);

  // Group weeks by season for dividers
  const groupedWeeks = useMemo(() => {
    const groups: { season: string; weeks: WeekEntry[] }[] = [];
    let currentSeason = "";
    for (const w of filteredWeeks) {
      if (w.season !== currentSeason) {
        currentSeason = w.season;
        groups.push({ season: currentSeason, weeks: [] });
      }
      groups[groups.length - 1].weeks.push(w);
    }
    return groups;
  }, [filteredWeeks]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading player data...</div>
      </div>
    );
  }

  if (!data?.player) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Player not found</p>
      </div>
    );
  }

  const { player } = data;

  return (
      <div>
        <div className="border-b">
          <div className="container mx-auto px-6 py-3 flex items-center gap-4">
            <Link
              href={`/league/${familyId}`}
              className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5"
            >
              <ArrowLeft className="h-4 w-4" />
              League
            </Link>
            <div className="flex-1">
              <h1 className="text-lg font-semibold">{player.name}</h1>
              <div className="text-sm text-muted-foreground">
                {player.position} {player.team ? `— ${player.team}` : ""}
              </div>
            </div>
            <div className="flex items-center gap-4 ml-auto">
              <Link
                href={`/league/${familyId}/timeline?playerId=${playerId}`}
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                Timeline &rarr;
              </Link>
              {graphEnabled && (
                <Link
                  href={`/league/${familyId}/graph?seedPlayerId=${playerId}&from=player`}
                  className="text-sm text-muted-foreground hover:text-foreground"
                >
                  Trace lineage &rarr;
                </Link>
              )}
            </div>
          </div>
        </div>

        <main className="container mx-auto px-6 py-8">
        {/* Summary Stats */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
            <StatCard label="Weeks Rostered" value={stats.totalWeeks} />
            <StatCard label="Weeks Started" value={stats.starterWeeks} />
            <StatCard label="Weeks Benched" value={stats.benchWeeks} />
            <StatCard label="Total Points" value={stats.totalPoints.toFixed(1)} />
            <StatCard label="PPG (Started)" value={stats.ppgStarter.toFixed(1)} />
            <StatCard label="PPG (All)" value={stats.ppgAll.toFixed(1)} />
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap gap-4 mb-6">
          {/* Season filter */}
          {data.availableSeasons.length > 1 && (
            <div className="flex gap-2">
              <FilterButton
                active={!selectedSeason}
                onClick={() => setSelectedSeason(null)}
              >
                All Seasons
              </FilterButton>
              {data.availableSeasons.map((s) => (
                <FilterButton
                  key={s}
                  active={selectedSeason === s}
                  onClick={() => setSelectedSeason(s)}
                >
                  {s}
                </FilterButton>
              ))}
            </div>
          )}

          {/* Manager filter */}
          {data.managers.length > 1 && (
            <div className="flex gap-2">
              <FilterButton
                active={!selectedManager}
                onClick={() => setSelectedManager(null)}
              >
                All Managers
              </FilterButton>
              {data.managers.map((m) => (
                <FilterButton
                  key={m.userId}
                  active={selectedManager === m.userId}
                  onClick={() => setSelectedManager(m.userId)}
                >
                  {m.displayName}
                </FilterButton>
              ))}
            </div>
          )}

          {/* Status filter */}
          <div className="flex gap-2">
            <FilterButton
              active={selectedStatus === "all"}
              onClick={() => setSelectedStatus("all")}
            >
              All
            </FilterButton>
            <FilterButton
              active={selectedStatus === "starter"}
              onClick={() => setSelectedStatus("starter")}
            >
              Started
            </FilterButton>
            <FilterButton
              active={selectedStatus === "bench"}
              onClick={() => setSelectedStatus("bench")}
            >
              Benched
            </FilterButton>
          </div>
        </div>

        {/* Weekly Log Table */}
        {filteredWeeks.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">
            No weekly data found for this player
          </p>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full">
              <thead className="bg-muted/50">
                <tr className="text-left text-sm">
                  <th className="px-4 py-3 font-medium">Week</th>
                  <th className="px-4 py-3 font-medium">Manager</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">NFL</th>
                  <th className="px-4 py-3 font-medium text-right">Points</th>
                </tr>
              </thead>
              <tbody>
                {groupedWeeks.map((group) => (
                  <Fragment key={`group-${group.season}`}>
                    {/* Season divider */}
                    {data.availableSeasons.length > 1 && (
                      <tr>
                        <td
                          colSpan={5}
                          className="px-4 py-2 bg-muted/30 text-xs font-semibold text-muted-foreground uppercase tracking-wider"
                        >
                          {group.season} Season
                        </td>
                      </tr>
                    )}
                    {group.weeks.map((w) => {
                      const badge = fantasyStatusBadge(w);
                      return (
                        <tr
                          key={`${w.leagueId}-${w.season}-${w.week}`}
                          className="border-t hover:bg-muted/30 transition-colors"
                        >
                          <td className="px-4 py-3 text-sm font-mono">
                            W{w.week}
                          </td>
                          <td className="px-4 py-3 text-sm">
                            {w.manager?.displayName || "—"}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full ${badge.className}`}
                            >
                              {badge.label}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`text-sm ${nflStatusColor(w.nflStatus, w.isByeWeek)}`}>
                              {nflStatusLabel(w.nflStatus, w.isByeWeek)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-sm">
                            {w.points.toFixed(1)}
                          </td>
                        </tr>
                      );
                    })}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
      </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="border rounded-lg p-4">
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 text-sm rounded-full transition-colors ${
        active
          ? "bg-primary text-primary-foreground"
          : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
      }`}
    >
      {children}
    </button>
  );
}
