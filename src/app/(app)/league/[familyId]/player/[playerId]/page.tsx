"use client";

import { Fragment, useEffect, useState, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ChevronDown, GitBranch } from "lucide-react";
import {
  ManagerName,
  ManagerAvatar,
  ManagerSecondaryName,
} from "@/components/ManagerName";
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
  age: number | null;
  yearsExp: number | null;
  status: string | null;
  injuryStatus: string | null;
}

interface CurrentManager {
  userId: string;
  rosterId: number;
  displayName: string;
  teamName: string | null;
  avatar: string | null;
  rosteredSince: { season: string; week: number } | null;
}

interface WeeklyLogData {
  player: PlayerInfo | null;
  weeks: WeekEntry[];
  managers: Manager[];
  availableSeasons: string[];
  currentManager: CurrentManager | null;
}

// Injury detail (Out/Doubtful/Questionable) takes priority over roster status:
// it's the more actionable signal for fantasy decisions.
function playerStatusLabel(
  status: string | null,
  injuryStatus: string | null
): string | null {
  if (injuryStatus) return injuryStatus;
  if (status === "Injured Reserve") return "IR";
  if (status === "Inactive") return "Inactive";
  return null;
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
    const totalPoints = filteredWeeks.reduce((sum, w) => sum + w.points, 0);
    const ppgAll = totalPoints / totalWeeks;
    return { totalWeeks, starterWeeks, ppgAll };
  }, [filteredWeeks]);

  // Group filtered weeks by (season, manager). Each stint is the unit of
  // analysis on a player page: "what did this player do for THIS manager in
  // THIS season". Multi-manager seasons (mid-season trades) get one row per
  // manager.
  const seasonGroups = useMemo(() => {
    type Stint = {
      key: string;
      season: string;
      managerUserId: string | null;
      managerDisplayName: string | null;
      managerRosterId: number | null;
      weeks: WeekEntry[];
      totalWeeks: number;
      starterWeeks: number;
      totalPoints: number;
      ppgAll: number;
      ppgStarter: number;
    };
    const map = new Map<string, Map<string, Stint>>();
    for (const w of filteredWeeks) {
      const userKey = w.manager?.userId ?? "__unrostered";
      if (!map.has(w.season)) map.set(w.season, new Map());
      const seasonMap = map.get(w.season)!;
      if (!seasonMap.has(userKey)) {
        seasonMap.set(userKey, {
          key: `${w.season}|${userKey}`,
          season: w.season,
          managerUserId: w.manager?.userId ?? null,
          managerDisplayName: w.manager?.displayName ?? null,
          managerRosterId: w.manager?.rosterId ?? null,
          weeks: [],
          totalWeeks: 0,
          starterWeeks: 0,
          totalPoints: 0,
          ppgAll: 0,
          ppgStarter: 0,
        });
      }
      seasonMap.get(userKey)!.weeks.push(w);
    }
    for (const seasonMap of map.values()) {
      for (const stint of seasonMap.values()) {
        stint.totalWeeks = stint.weeks.length;
        stint.starterWeeks = stint.weeks.filter(
          (w) => w.fantasyStatus === "starter"
        ).length;
        stint.totalPoints = stint.weeks.reduce((s, w) => s + w.points, 0);
        stint.ppgAll = stint.totalWeeks
          ? stint.totalPoints / stint.totalWeeks
          : 0;
        const starterPoints = stint.weeks
          .filter((w) => w.fantasyStatus === "starter")
          .reduce((s, w) => s + w.points, 0);
        stint.ppgStarter = stint.starterWeeks
          ? starterPoints / stint.starterWeeks
          : 0;
      }
    }
    return [...map.entries()]
      .sort(([a], [b]) => parseInt(b, 10) - parseInt(a, 10))
      .map(([season, stintMap]) => ({
        season,
        stints: [...stintMap.values()].sort(
          (a, b) => b.totalPoints - a.totalPoints
        ),
      }));
  }, [filteredWeeks]);

  const allStintKeys = useMemo(
    () => seasonGroups.flatMap((g) => g.stints.map((s) => s.key)),
    [seasonGroups]
  );
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const toggleStint = (key: string) =>
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

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

  const { player, currentManager } = data;
  const statusLabel = playerStatusLabel(player.status, player.injuryStatus);
  const metaParts: string[] = [];
  if (player.position) metaParts.push(player.position);
  if (player.team) metaParts.push(player.team);
  if (player.age != null) metaParts.push(`${player.age} yo`);
  if (player.yearsExp != null) {
    metaParts.push(
      player.yearsExp === 0 ? "Rookie" : `${player.yearsExp}y exp`
    );
  }

  return (
      <div>
        <div className="border-b">
          <div className="container mx-auto px-4 sm:px-6 py-3">
            <Link
              href={`/league/${familyId}`}
              className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5"
            >
              <ArrowLeft className="h-4 w-4" />
              League
            </Link>
          </div>
        </div>

        <div className="border-b bg-card">
          <div className="container mx-auto px-4 sm:px-6 py-5 sm:py-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4 md:gap-6">
            <div className="min-w-0">
              <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight truncate">
                {player.name}
              </h1>
              <div className="mt-1 text-sm text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1">
                {metaParts.map((part, i) => (
                  <Fragment key={`meta-${i}`}>
                    {i > 0 && <span aria-hidden className="text-muted-foreground/50">·</span>}
                    <span>{part}</span>
                  </Fragment>
                ))}
                {statusLabel && (
                  <>
                    {metaParts.length > 0 && (
                      <span aria-hidden className="text-muted-foreground/50">·</span>
                    )}
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-grade-d/10 text-grade-d">
                      {statusLabel}
                    </span>
                  </>
                )}
              </div>
              {graphEnabled && (
                <Link
                  href={`/league/${familyId}/graph?seedPlayerId=${playerId}&from=player`}
                  className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-full bg-primary/10 text-primary hover:bg-primary/15 transition-colors"
                >
                  <GitBranch className="h-3.5 w-3.5" />
                  Trace lineage
                </Link>
              )}
            </div>

            <CurrentManagerBlock
              familyId={familyId}
              currentManager={currentManager}
            />
          </div>
        </div>

        <main className="container mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* Summary Stats */}
        {stats && (
          <div className="grid grid-cols-3 gap-3 sm:gap-4 mb-8">
            <StatCard label="Weeks Rostered" value={stats.totalWeeks} />
            <StatCard label="Weeks Started" value={stats.starterWeeks} />
            <StatCard label="PPG" value={stats.ppgAll.toFixed(1)} />
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap gap-4 mb-6">
          {/* Season filter */}
          {data.availableSeasons.length > 1 && (
            <div className="flex flex-wrap gap-2">
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
            <div className="flex flex-wrap gap-2">
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
                  <ManagerName
                    userId={m.userId}
                    displayName={m.displayName}
                    variant="display-only"
                  />
                </FilterButton>
              ))}
            </div>
          )}

          {/* Status filter */}
          <div className="flex flex-wrap gap-2">
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

        {/* Weekly Log: collapsible (season, manager) groups */}
        {filteredWeeks.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">
            No weekly data found for this player
          </p>
        ) : (
          <>
            <div className="flex items-center justify-end gap-3 mb-3 text-xs">
              <button
                type="button"
                onClick={() => setExpandedKeys(new Set(allStintKeys))}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                Expand all
              </button>
              <span aria-hidden className="text-muted-foreground/40">|</span>
              <button
                type="button"
                onClick={() => setExpandedKeys(new Set())}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                Collapse all
              </button>
            </div>

            <div className="space-y-5">
              {seasonGroups.map((group) => (
                <section key={group.season}>
                  <h3 className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2 px-1">
                    {group.season} Season
                  </h3>
                  <div className="border rounded-lg overflow-hidden bg-card">
                    {group.stints.map((stint, idx) => {
                      const expanded = expandedKeys.has(stint.key);
                      return (
                        <Fragment key={stint.key}>
                          <button
                            type="button"
                            onClick={() => toggleStint(stint.key)}
                            className={`w-full px-3 sm:px-4 py-3 flex items-center gap-3 text-left hover:bg-muted/30 transition-colors ${
                              idx > 0 ? "border-t" : ""
                            }`}
                            aria-expanded={expanded}
                          >
                            <ChevronDown
                              className={`h-4 w-4 text-muted-foreground transition-transform shrink-0 ${
                                expanded ? "" : "-rotate-90"
                              }`}
                            />
                            <div className="flex-1 min-w-0">
                              <div className="font-medium truncate">
                                {stint.managerDisplayName ?? "Unrostered"}
                              </div>
                              <div className="mt-0.5 text-xs text-muted-foreground font-mono flex flex-wrap gap-x-3 gap-y-0.5">
                                <span>{stint.totalWeeks} wks</span>
                                <span>{stint.starterWeeks} started</span>
                                <span>{stint.totalPoints.toFixed(1)} pts</span>
                                <span>{stint.ppgAll.toFixed(1)} ppg</span>
                              </div>
                            </div>
                          </button>
                          {expanded && <WeeklyDetail weeks={stint.weeks} />}
                        </Fragment>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          </>
        )}
      </main>
      </div>
  );
}

function WeeklyDetail({ weeks }: { weeks: WeekEntry[] }) {
  return (
    <div className="border-t bg-muted/10 overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead className="bg-muted/30 text-left">
          <tr>
            <th className="sticky left-0 z-10 bg-muted/30 px-3 py-2 font-medium font-mono text-xs uppercase tracking-wide shadow-[1px_0_0_0_var(--border)]">
              Week
            </th>
            <th className="px-3 py-2 font-medium font-mono text-xs uppercase tracking-wide">
              Lineup
            </th>
            <th className="px-3 py-2 font-medium font-mono text-xs uppercase tracking-wide">
              Status
            </th>
            <th className="px-3 py-2 font-medium font-mono text-xs uppercase tracking-wide text-right">
              Points
            </th>
          </tr>
        </thead>
        <tbody>
          {weeks.map((w) => {
            const badge = fantasyStatusBadge(w);
            return (
              <tr
                key={`${w.leagueId}-${w.season}-${w.week}`}
                className="border-t border-border/60"
              >
                <td className="sticky left-0 z-10 bg-card px-3 py-2 font-mono shadow-[1px_0_0_0_var(--border)]">
                  W{w.week}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full ${badge.className}`}
                  >
                    {badge.label}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`${nflStatusColor(w.nflStatus, w.isByeWeek)}`}
                  >
                    {nflStatusLabel(w.nflStatus, w.isByeWeek)}
                  </span>
                </td>
                <td className="px-3 py-2 text-right font-mono">
                  {w.points.toFixed(1)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CurrentManagerBlock({
  familyId,
  currentManager,
}: {
  familyId: string;
  currentManager: CurrentManager | null;
}) {
  if (!currentManager) {
    return (
      <div className="md:text-right text-sm text-muted-foreground inline-flex md:flex-col md:items-end items-center gap-1">
        <span className="uppercase tracking-wide text-[11px] font-mono text-muted-foreground/70">
          Currently
        </span>
        <span>Free agent</span>
      </div>
    );
  }

  const teamLabel = currentManager.teamName || currentManager.displayName;

  return (
    <Link
      href={`/league/${familyId}/manager/${currentManager.userId}`}
      className="group flex items-center md:flex-row-reverse gap-3 rounded-lg p-2 -m-2 hover:bg-muted/50 transition-colors min-w-0"
    >
      <ManagerAvatar
        displayName={currentManager.displayName}
        avatarUrl={currentManager.avatar}
        size={44}
      />
      <div className="min-w-0 md:text-right">
        <div className="text-[11px] font-mono uppercase tracking-wide text-muted-foreground">
          Currently rostered by
        </div>
        <div className="font-semibold text-foreground truncate group-hover:text-primary transition-colors">
          {teamLabel}
        </div>
        <ManagerSecondaryName
          displayName={currentManager.displayName}
          teamName={currentManager.teamName}
          parens={false}
          className="block text-xs text-muted-foreground truncate"
        />
        {currentManager.rosteredSince && (
          <div className="text-xs text-muted-foreground mt-0.5">
            Since W{currentManager.rosteredSince.week}{" "}
            {currentManager.rosteredSince.season}
          </div>
        )}
      </div>
    </Link>
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
