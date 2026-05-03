"use client";

import { type ReactNode, useEffect, useState, useMemo } from "react";
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
  opponent: string | null;
  isAway: boolean;
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
  const [selectedLocation, setSelectedLocation] = useState<"all" | "home" | "away">("all");

  useEffect(() => {
    loadData();
  }, [familyId, playerId]);

  async function loadData() {
    setLoading(true);
    const res = await fetch(
      `/api/leagues/${familyId}/player/${playerId}/weekly-log`
    );
    if (res.ok) {
      setData(await res.json());
    }
    setLoading(false);
  }

  // Season + manager filters narrow the headline stats; status filter only
  // affects PPG (handled below) and which weeks appear in the game log.
  // currentManager comes straight from the API and is always all-time —
  // never narrowed by any filter.
  const scopedWeeks = useMemo(() => {
    if (!data) return [];
    let weeks = data.weeks;
    if (selectedSeason) weeks = weeks.filter((w) => w.season === selectedSeason);
    if (selectedManager) {
      weeks = weeks.filter((w) => w.manager?.userId === selectedManager);
    }
    if (selectedLocation === "home") {
      weeks = weeks.filter((w) => w.opponent !== null && !w.isAway);
    } else if (selectedLocation === "away") {
      weeks = weeks.filter((w) => w.opponent !== null && w.isAway);
    }
    return weeks;
  }, [data, selectedSeason, selectedManager, selectedLocation]);

  // Only seasons where the player actually has scoring rows — not every
  // season in the league family.
  const seasonsWithData = useMemo(() => {
    if (!data) return [];
    return [...new Set(data.weeks.map((w) => w.season))].sort(
      (a, b) => parseInt(b, 10) - parseInt(a, 10)
    );
  }, [data]);

  const filteredWeeks = useMemo(() => {
    if (selectedStatus === "starter") {
      return scopedWeeks.filter((w) => w.fantasyStatus === "starter");
    }
    if (selectedStatus === "bench") {
      return scopedWeeks.filter((w) => w.fantasyStatus === "bench");
    }
    return scopedWeeks;
  }, [scopedWeeks, selectedStatus]);

  // Started/Rostered ratio is identity-level (ignores status filter).
  // PPG follows the status filter — Started/Benched switches the denominator
  // so the headline number reflects what the user is looking at.
  // Bye weeks are excluded from every calc — a bye is not a fantasy
  // opportunity, so counting it inflates "rostered" and drags PPG down.
  const stats = useMemo(() => {
    const playedWeeks = scopedWeeks.filter((w) => !w.isByeWeek);
    if (playedWeeks.length === 0) return null;
    const totalWeeks = playedWeeks.length;
    const starterWeeks = playedWeeks.filter((w) => w.fantasyStatus === "starter").length;
    const ppgWeeks =
      selectedStatus === "all"
        ? playedWeeks
        : playedWeeks.filter((w) => w.fantasyStatus === selectedStatus);
    const ppg = ppgWeeks.length
      ? ppgWeeks.reduce((s, w) => s + w.points, 0) / ppgWeeks.length
      : 0;
    const suffixes: string[] = [];
    if (selectedLocation === "home") suffixes.push("Home");
    if (selectedLocation === "away") suffixes.push("Away");
    if (selectedStatus === "starter") suffixes.push("Started");
    if (selectedStatus === "bench") suffixes.push("Bench");
    const ppgLabel = suffixes.length ? `PPG · ${suffixes.join(" · ")}` : "PPG";
    return { totalWeeks, starterWeeks, ppg, ppgLabel };
  }, [scopedWeeks, selectedStatus, selectedLocation]);

  // Per-stint aggregates exclude byes so "wks", "started", "pts", "ppg"
  // all describe playable weeks. The detail table still renders all
  // weeks (including bye rows) — exclusion is for calcs, not display.
  const sections: CollapsibleSection[] = useMemo(() => {
    type Stint = {
      key: string;
      managerDisplayName: string | null;
      weeks: WeekEntry[];
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
        };
        seasonMap.set(userKey, stint);
      }
      stint.weeks.push(w);
    }

    function aggregate(weeks: WeekEntry[]) {
      const played = weeks.filter((w) => !w.isByeWeek);
      const totalPoints = played.reduce((s, w) => s + w.points, 0);
      return {
        totalWeeks: played.length,
        starterWeeks: played.filter((w) => w.fantasyStatus === "starter").length,
        totalPoints,
        ppg: played.length ? totalPoints / played.length : 0,
      };
    }

    return [...map.entries()]
      .sort(([a], [b]) => parseInt(b, 10) - parseInt(a, 10))
      .map(([season, stintMap]) => ({
        key: season,
        heading: `${season} Season`,
        rows: [...stintMap.values()]
          .map((stint) => ({ stint, agg: aggregate(stint.weeks) }))
          .sort((a, b) => b.agg.totalPoints - a.agg.totalPoints)
          .map(({ stint, agg }) => ({
            key: stint.key,
            title: stint.managerDisplayName ?? "Unrostered",
            meta: (
              <>
                <span>{agg.totalWeeks} wks</span>
                <span>{agg.starterWeeks} started</span>
                <span>{agg.totalPoints.toFixed(1)} pts</span>
                <span>{agg.ppg.toFixed(1)} ppg</span>
              </>
            ),
            detail: <WeeklyDetail weeks={stint.weeks} />,
          })),
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 mb-8">
          <SituationTile
            team={player.team}
            age={player.age}
            yearsExp={player.yearsExp}
            statusLabel={statusLabel}
          />
          <CurrentManagerTile
            familyId={familyId}
            currentManager={currentManager}
          />
          {stats && (
            <ProductionTile
              stats={stats}
              className="sm:row-span-2 lg:row-span-1"
            />
          )}
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-3 mb-6">
          {seasonsWithData.length > 1 && (
            <div className="flex flex-wrap gap-2">
              <FilterChip
                active={!selectedSeason}
                onClick={() => setSelectedSeason(null)}
              >
                All Seasons
              </FilterChip>
              {seasonsWithData.map((s) => (
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

          <div className="flex flex-wrap gap-2">
            <FilterChip
              active={selectedLocation === "all"}
              onClick={() => setSelectedLocation("all")}
            >
              All
            </FilterChip>
            <FilterChip
              active={selectedLocation === "home"}
              onClick={() => setSelectedLocation("home")}
            >
              Home
            </FilterChip>
            <FilterChip
              active={selectedLocation === "away"}
              onClick={() => setSelectedLocation("away")}
            >
              Away
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

function opponentLabel(w: WeekEntry): string {
  if (w.isByeWeek) return "BYE";
  if (!w.opponent) return "—";
  return w.isAway ? `@${w.opponent}` : w.opponent;
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
            <th className="px-3 py-2 font-medium font-mono text-xs uppercase tracking-wide">
              <span className="hidden md:inline">Opponent</span>
              <span className="md:hidden">Opp</span>
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
                <td className="px-3 py-2 font-mono">{opponentLabel(w)}</td>
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

function TileLabel({ children }: { children: ReactNode }) {
  return (
    <div className="text-[11px] font-mono uppercase tracking-wide text-muted-foreground">
      {children}
    </div>
  );
}

function StatBlock({
  value,
  label,
  tooltip,
  className,
}: {
  value: ReactNode;
  label: ReactNode;
  tooltip?: string;
  className?: string;
}) {
  const valueClass = tooltip
    ? "text-2xl font-bold font-mono tabular-nums underline decoration-dotted decoration-muted-foreground/40 underline-offset-4 cursor-help"
    : "text-2xl font-bold font-mono tabular-nums";
  return (
    <div className={`min-w-0 flex-1 ${className ?? ""}`}>
      <div className={valueClass} title={tooltip}>
        {value}
      </div>
      <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
    </div>
  );
}

function SituationTile({
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
  const facts: { label: string; value: ReactNode }[] = [];
  if (team) facts.push({ label: "Team", value: team });
  if (age != null) facts.push({ label: "Age", value: age });
  if (yearsExp != null) {
    facts.push({
      label: "Exp",
      value: yearsExp === 0 ? "Rookie" : `${yearsExp}y`,
    });
  }
  if (statusLabel) {
    facts.push({
      label: "Status",
      value: (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-grade-d/10 text-grade-d">
          {statusLabel}
        </span>
      ),
    });
  }

  return (
    <div className="border rounded-lg p-4 flex flex-col gap-3">
      <TileLabel>Situation</TileLabel>
      <div className="flex items-center divide-x divide-border/60">
        {facts.map((f, i) => (
          <div
            key={i}
            className="px-3 first:pl-0 last:pr-0 min-w-0 flex-1"
          >
            <div className="text-base font-semibold truncate">{f.value}</div>
            <div className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground mt-0.5">
              {f.label}
            </div>
          </div>
        ))}
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
      <div className="border rounded-lg p-4 flex flex-col gap-3">
        <TileLabel>Currently</TileLabel>
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
      <div className="min-w-0 flex-1">
        <TileLabel>Currently rostered by</TileLabel>
        <div className="mt-1 text-sm font-semibold text-foreground truncate group-hover:text-primary transition-colors">
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
      <ManagerAvatar
        displayName={currentManager.displayName}
        avatarUrl={currentManager.avatar}
        size={40}
      />
    </Link>
  );
}

function ProductionTile({
  stats,
  className,
}: {
  stats: {
    totalWeeks: number;
    starterWeeks: number;
    ppg: number;
    ppgLabel: string;
  };
  className?: string;
}) {
  return (
    <div
      className={`border rounded-lg p-4 flex flex-col gap-3 ${className ?? ""}`}
    >
      <TileLabel>Production</TileLabel>
      <div className="flex-1 flex flex-row sm:flex-col lg:flex-row sm:justify-center gap-4 sm:gap-3 lg:gap-4">
        <StatBlock
          value={`${stats.starterWeeks}/${stats.totalWeeks}`}
          label="Weeks Started"
          tooltip={`Started ${stats.starterWeeks} of ${stats.totalWeeks} weeks rostered`}
        />
        <div
          aria-hidden
          className="border-l sm:border-l-0 sm:border-t lg:border-t-0 lg:border-l border-border/60"
        />
        <StatBlock value={stats.ppg.toFixed(1)} label={stats.ppgLabel} />
      </div>
    </div>
  );
}
