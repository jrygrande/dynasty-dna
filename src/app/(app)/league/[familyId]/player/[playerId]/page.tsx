"use client";

import { Fragment, useEffect, useState, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { GitBranch } from "lucide-react";
import {
  ManagerName,
  ManagerAvatar,
  ManagerSecondaryName,
} from "@/components/ManagerName";
import { PositionChip } from "@/components/PositionChip";
import { FilterChip } from "@/components/FilterChip";
import { Subheader } from "@/components/Subheader";
import {
  CollapsibleSeasonTable,
  type CollapsibleSection,
} from "@/components/CollapsibleSeasonTable";
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

  // Headline stats follow season + manager filters but ignore the status
  // filter — they're identity-level numbers about rostership, not a slice
  // of which weeks the user is currently inspecting.
  const scopedWeeks = useMemo(() => {
    if (!data) return [];
    if (!selectedManager) return data.weeks;
    return data.weeks.filter((w) => w.manager?.userId === selectedManager);
  }, [data, selectedManager]);

  const filteredWeeks = useMemo(() => {
    if (selectedStatus === "starter") {
      return scopedWeeks.filter((w) => w.fantasyStatus === "starter");
    }
    if (selectedStatus === "bench") {
      return scopedWeeks.filter((w) => w.fantasyStatus === "bench");
    }
    return scopedWeeks;
  }, [scopedWeeks, selectedStatus]);

  const stats = useMemo(() => {
    if (scopedWeeks.length === 0) return null;
    const totalWeeks = scopedWeeks.length;
    const starterWeeks = scopedWeeks.filter((w) => w.fantasyStatus === "starter").length;
    const totalPoints = scopedWeeks.reduce((sum, w) => sum + w.points, 0);
    const ppgAll = totalPoints / totalWeeks;
    return { totalWeeks, starterWeeks, ppgAll };
  }, [scopedWeeks]);

  const sections: CollapsibleSection[] = useMemo(() => {
    type Stint = {
      key: string;
      managerDisplayName: string | null;
      weeks: WeekEntry[];
      starterWeeks: number;
      totalPoints: number;
    };
    const map = new Map<string, Map<string, Stint>>();
    for (const w of filteredWeeks) {
      const userKey = w.manager?.userId ?? "__unrostered";
      if (!map.has(w.season)) map.set(w.season, new Map());
      const seasonMap = map.get(w.season)!;
      let stint = seasonMap.get(userKey);
      if (!stint) {
        stint = {
          key: `${w.season}|${userKey}`,
          managerDisplayName: w.manager?.displayName ?? null,
          weeks: [],
          starterWeeks: 0,
          totalPoints: 0,
        };
        seasonMap.set(userKey, stint);
      }
      stint.weeks.push(w);
      if (w.fantasyStatus === "starter") stint.starterWeeks++;
      stint.totalPoints += w.points;
    }
    return [...map.entries()]
      .sort(([a], [b]) => parseInt(b, 10) - parseInt(a, 10))
      .map(([season, stintMap]) => ({
        key: season,
        heading: `${season} Season`,
        rows: [...stintMap.values()]
          .sort((a, b) => b.totalPoints - a.totalPoints)
          .map((stint) => {
            const totalWeeks = stint.weeks.length;
            const ppgAll = totalWeeks ? stint.totalPoints / totalWeeks : 0;
            return {
              key: stint.key,
              title: stint.managerDisplayName ?? "Unrostered",
              meta: (
                <>
                  <span>{totalWeeks} wks</span>
                  <span>{stint.starterWeeks} started</span>
                  <span>{stint.totalPoints.toFixed(1)} pts</span>
                  <span>{ppgAll.toFixed(1)} ppg</span>
                </>
              ),
              detail: <WeeklyDetail weeks={stint.weeks} />,
            };
          }),
      }));
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

  const { player, currentManager } = data;
  const statusLabel = playerStatusLabel(player.status, player.injuryStatus);

  return (
    <div>
      <Subheader
        title={
          <div className="min-w-0 flex items-center gap-2">
            <PositionChip position={player.position} />
            <h1 className="text-base sm:text-lg md:text-xl font-semibold line-clamp-1">
              {player.name}
            </h1>
            {player.team && (
              <span className="text-sm text-muted-foreground shrink-0">
                {player.team}
              </span>
            )}
          </div>
        }
        rightSlot={
          graphEnabled ? (
            <Link
              href={`/league/${familyId}/graph?seedPlayerId=${playerId}&from=player`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-full bg-primary/10 text-primary hover:bg-primary/15 transition-colors whitespace-nowrap"
            >
              <GitBranch className="h-3.5 w-3.5" />
              Trace lineage
            </Link>
          ) : undefined
        }
      />

      <main className="container mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mb-8">
          <PlayerMetaTile
            team={player.team}
            age={player.age}
            yearsExp={player.yearsExp}
            statusLabel={statusLabel}
          />
          <CurrentManagerTile
            familyId={familyId}
            currentManager={currentManager}
          />
          {stats && <PlayerStatsTile stats={stats} />}
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-3 mb-6">
          {data.availableSeasons.length > 1 && (
            <div className="flex flex-wrap gap-2">
              <FilterChip
                active={!selectedSeason}
                onClick={() => setSelectedSeason(null)}
              >
                All Seasons
              </FilterChip>
              {data.availableSeasons.map((s) => (
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

          {data.managers.length > 1 && (
            <div className="flex flex-wrap gap-2">
              <FilterChip
                active={!selectedManager}
                onClick={() => setSelectedManager(null)}
              >
                All Managers
              </FilterChip>
              {data.managers.map((m) => (
                <FilterChip
                  key={m.userId}
                  active={selectedManager === m.userId}
                  onClick={() => setSelectedManager(m.userId)}
                >
                  <ManagerName
                    userId={m.userId}
                    displayName={m.displayName}
                    variant="display-only"
                  />
                </FilterChip>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <FilterChip
              active={selectedStatus === "all"}
              onClick={() => setSelectedStatus("all")}
            >
              All
            </FilterChip>
            <FilterChip
              active={selectedStatus === "starter"}
              onClick={() => setSelectedStatus("starter")}
            >
              Started
            </FilterChip>
            <FilterChip
              active={selectedStatus === "bench"}
              onClick={() => setSelectedStatus("bench")}
            >
              Benched
            </FilterChip>
          </div>
        </div>

        <CollapsibleSeasonTable
          sections={sections}
          emptyMessage="No weekly data found for this player"
        />
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

function PlayerMetaTile({
  team,
  age,
  yearsExp,
  statusLabel,
}: {
  team: string | null;
  age: number | null;
  yearsExp: number | null;
  statusLabel: string | null;
}) {
  const parts: string[] = [];
  if (team) parts.push(team);
  if (age != null) parts.push(`${age} yo`);
  if (yearsExp != null) {
    parts.push(yearsExp === 0 ? "Rookie" : `${yearsExp}y exp`);
  }

  return (
    <div className="border rounded-lg p-4 flex flex-col gap-1">
      <div className="text-[11px] font-mono uppercase tracking-wide text-muted-foreground">
        Player
      </div>
      <div className="text-sm flex flex-wrap items-center gap-x-2 gap-y-1">
        {parts.map((part, i) => (
          <Fragment key={`meta-${i}`}>
            {i > 0 && (
              <span aria-hidden className="text-muted-foreground/50">·</span>
            )}
            <span>{part}</span>
          </Fragment>
        ))}
        {statusLabel && (
          <>
            {parts.length > 0 && (
              <span aria-hidden className="text-muted-foreground/50">·</span>
            )}
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-grade-d/10 text-grade-d">
              {statusLabel}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

function CurrentManagerTile({
  familyId,
  currentManager,
}: {
  familyId: string;
  currentManager: CurrentManager | null;
}) {
  if (!currentManager) {
    return (
      <div className="border rounded-lg p-4 flex flex-col gap-1">
        <div className="text-[11px] font-mono uppercase tracking-wide text-muted-foreground">
          Currently
        </div>
        <div className="text-sm text-muted-foreground">Free agent</div>
      </div>
    );
  }

  const teamLabel = currentManager.teamName || currentManager.displayName;

  return (
    <Link
      href={`/league/${familyId}/manager/${currentManager.userId}`}
      className="group border rounded-lg p-4 flex items-center gap-3 hover:bg-muted/30 transition-colors min-w-0"
    >
      <ManagerAvatar
        displayName={currentManager.displayName}
        avatarUrl={currentManager.avatar}
        size={40}
      />
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-mono uppercase tracking-wide text-muted-foreground">
          Currently rostered by
        </div>
        <div className="text-sm font-semibold text-foreground truncate group-hover:text-primary transition-colors">
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

function PlayerStatsTile({
  stats,
}: {
  stats: { totalWeeks: number; starterWeeks: number; ppgAll: number };
}) {
  return (
    <div className="border rounded-lg p-4 flex items-center gap-6">
      <div className="min-w-0">
        <div
          className="text-2xl font-bold font-mono tabular-nums underline decoration-dotted decoration-muted-foreground/40 underline-offset-4 cursor-help"
          title={`Started ${stats.starterWeeks} of ${stats.totalWeeks} weeks rostered`}
        >
          {stats.starterWeeks}/{stats.totalWeeks}
        </div>
        <div className="text-xs text-muted-foreground">Weeks Started</div>
      </div>
      <div className="min-w-0">
        <div className="text-2xl font-bold font-mono tabular-nums">
          {stats.ppgAll.toFixed(1)}
        </div>
        <div className="text-xs text-muted-foreground">PPG</div>
      </div>
    </div>
  );
}
