"use client";

import {
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ChevronDown, GitBranch, IdCard } from "lucide-react";
import { GradeBadge } from "@/components/GradeBadge";
import { ManagerRadarChart } from "@/components/ManagerRadarChart";
import {
  ManagerGradeCard,
  type ManagerScore,
} from "@/components/ManagerGradeCard";
import { ManagerName, ManagerSecondaryName } from "@/components/ManagerName";
import { Subheader } from "@/components/Subheader";
import { TypeBadge } from "@/components/TransactionCard";
import { PositionChip } from "@/components/PositionChip";
import { FilterChip } from "@/components/FilterChip";
import {
  CollapsibleSeasonTable,
  type CollapsibleSection,
} from "@/components/CollapsibleSeasonTable";
import {
  ChampionshipTrophy,
  ChampionshipTrophies,
} from "@/components/ChampionshipTrophy";
import { PILLAR_KEYS, PILLAR_LABELS } from "@/lib/pillars";
import { getRoundSuffix, ordinal } from "@/lib/utils";

interface RecordRow {
  wins: number;
  losses: number;
  ties: number;
  fpts: number;
  recordRank: number;
  fptsRank: number;
  total: number;
}

interface SeasonHistoryRow {
  season: string;
  wins: number;
  losses: number;
  ties: number;
  fpts: number;
  mps: ManagerScore | null;
  pillars: Record<string, ManagerScore | null>;
}

interface RosterPlayer {
  id: string;
  name: string;
  position: string | null;
  team: string | null;
  age: number | null;
  ppg: number | null;
  startPct: number | null;
}

interface RosterSnapshot {
  season: string;
  asOf: number | null;
  players: RosterPlayer[];
}

interface PlayerRef {
  id: string;
  name: string;
  position: string | null;
  team: string | null;
}

interface PickRef {
  season: string;
  round: number;
}

interface Transaction {
  id: string;
  type: string;
  season: string;
  week: number;
  adds: PlayerRef[];
  drops: PlayerRef[];
  picksReceived: PickRef[];
  picksSent: PickRef[];
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
  allTime: RecordRow;
  seasonStats: Record<string, RecordRow & { leagueId: string }>;
  championshipYears: string[];
  mps: ManagerScore | null;
  pillarScores: Record<string, ManagerScore | null>;
  seasonHistory: SeasonHistoryRow[];
  rosters: Record<string, RosterSnapshot>;
  recentTransactions: Transaction[];
  seasons: Array<{ leagueId: string; season: string }>;
}

type SeasonFilter = "all" | string; // "all" or a season label

const EMPTY_PILLAR_SCORES: Record<string, ManagerScore | null> = PILLAR_KEYS.reduce(
  (acc, k) => {
    acc[k] = null;
    return acc;
  },
  {} as Record<string, ManagerScore | null>,
);

export default function ManagerPage() {
  const params = useParams();
  const familyId = params.familyId as string;
  const userId = params.userId as string;
  const router = useRouter();
  const searchParams = useSearchParams();

  const [data, setData] = useState<ManagerData | null>(null);
  const [loading, setLoading] = useState(true);

  const seasonParam = searchParams.get("season");
  const txTypeParam = searchParams.get("txType");
  const txSeasonParam = searchParams.get("txSeason");

  const selectedSeason: SeasonFilter = seasonParam ?? "all";
  const selectedTxType = txTypeParam ?? "all";
  const selectedTxSeason: SeasonFilter = txSeasonParam ?? selectedSeason;

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(searchParams.toString());
    if (value === null || value === "all") next.delete(key);
    else next.set(key, value);
    const qs = next.toString();
    router.replace(qs ? `?${qs}` : `?`, { scroll: false });
  }

  useEffect(() => {
    let cancelled = false;
    async function loadData() {
      setLoading(true);
      try {
        const res = await fetch(`/api/leagues/${familyId}/manager/${userId}`);
        if (res.ok && !cancelled) {
          setData(await res.json());
        }
      } catch (err) {
        console.error("Failed to load manager data:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadData();
    return () => {
      cancelled = true;
    };
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

  return (
    <ManagerPageContent
      data={data}
      familyId={familyId}
      selectedSeason={selectedSeason}
      selectedTxType={selectedTxType}
      selectedTxSeason={selectedTxSeason}
      onSeasonChange={(s) => setParam("season", s === "all" ? null : s)}
      onTxTypeChange={(t) => setParam("txType", t === "all" ? null : t)}
      onTxSeasonChange={(s) => setParam("txSeason", s === "all" ? null : s)}
    />
  );
}

function ManagerPageContent({
  data,
  familyId,
  selectedSeason,
  selectedTxType,
  selectedTxSeason,
  onSeasonChange,
  onTxTypeChange,
  onTxSeasonChange,
}: {
  data: ManagerData;
  familyId: string;
  selectedSeason: SeasonFilter;
  selectedTxType: string;
  selectedTxSeason: SeasonFilter;
  onSeasonChange: (s: SeasonFilter) => void;
  onTxTypeChange: (t: string) => void;
  onTxSeasonChange: (s: SeasonFilter) => void;
}) {
  const { manager, allTime, seasonStats, championshipYears, seasonHistory } =
    data;

  const allSeasons = data.seasons.map((s) => s.season);
  const championshipSet = useMemo(
    () => new Set(championshipYears),
    [championshipYears],
  );

  // Section 1: Stats header — pick all-time vs season-specific
  const headerStats: RecordRow =
    selectedSeason === "all" ? allTime : seasonStats[selectedSeason] ?? allTime;

  // Section 2: MPS card + pillars — switch to season-scoped if filter is set
  const seasonRow = seasonHistory.find((r) => r.season === selectedSeason);
  const mpsForCard: ManagerScore | null =
    selectedSeason === "all" ? data.mps : seasonRow?.mps ?? null;
  const pillarsForCard: Record<string, ManagerScore | null> =
    selectedSeason === "all"
      ? data.pillarScores
      : seasonRow?.pillars ?? EMPTY_PILLAR_SCORES;

  // Section 5: Roster — chosen by season filter
  const rosterKey = selectedSeason === "all" ? "all-time" : selectedSeason;
  const rosterSnapshot = data.rosters[rosterKey] ?? data.rosters["all-time"];

  // Section 4: Recent transactions — apply Season + Type filters
  const filteredTransactions = useMemo(() => {
    return data.recentTransactions.filter((tx) => {
      if (selectedTxSeason !== "all" && tx.season !== selectedTxSeason)
        return false;
      if (selectedTxType !== "all" && tx.type !== selectedTxType) return false;
      return true;
    });
  }, [data.recentTransactions, selectedTxSeason, selectedTxType]);

  return (
    <div>
      <Subheader
        title={
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 min-w-0">
            <h1 className="text-base sm:text-lg md:text-xl font-semibold line-clamp-1">
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
        }
      />

      <main className="container mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6 sm:space-y-8">
        {/* Section 1: Record / Points For / League Rank */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          <RecordTile stats={headerStats} />
          <PointsForTile stats={headerStats} />
          <RankTile
            stats={headerStats}
            championshipYears={
              selectedSeason === "all"
                ? championshipYears
                : championshipSet.has(selectedSeason)
                  ? [selectedSeason]
                  : []
            }
          />
        </section>

        {/* Page-level Season filter — placed in main content per player-page pattern */}
        {allSeasons.length > 0 && (
          <section
            className="flex flex-wrap gap-2"
            aria-label="Season filter"
          >
            <FilterChip
              active={selectedSeason === "all"}
              onClick={() => onSeasonChange("all")}
            >
              All-time
            </FilterChip>
            {allSeasons.map((s) => (
              <FilterChip
                key={s}
                active={selectedSeason === s}
                onClick={() => onSeasonChange(s)}
              >
                {s}
              </FilterChip>
            ))}
          </section>
        )}

        {/* Section 2: MPS card + radar chart */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
          <ManagerGradeCard mps={mpsForCard} pillarScores={pillarsForCard} />
          <div className="border rounded-lg p-4">
            <h2 className="text-sm font-medium text-muted-foreground mb-2">
              Manager DNA
            </h2>
            <ManagerRadarChart pillarScores={pillarsForCard} />
          </div>
        </section>

        {/* Section 3: Season History */}
        <SeasonHistorySection
          seasonHistory={seasonHistory}
          championshipSet={championshipSet}
          allTime={allTime}
        />

        {/* Section 5: Roster */}
        <RosterSection
          familyId={familyId}
          snapshot={rosterSnapshot}
          selectedSeason={selectedSeason}
        />

        {/* Section 4: Recent Transactions */}
        <TransactionsSection
          familyId={familyId}
          transactions={filteredTransactions}
          allCount={data.recentTransactions.length}
          allSeasons={allSeasons}
          selectedSeason={selectedTxSeason}
          selectedType={selectedTxType}
          onSeasonChange={onTxSeasonChange}
          onTypeChange={onTxTypeChange}
        />
      </main>
    </div>
  );
}

// ============================================================
// Section 1 tiles (player-page tile language: divided cells)
// ============================================================

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
  className,
}: {
  value: ReactNode;
  label: ReactNode;
  className?: string;
}) {
  return (
    <div className={`min-w-0 flex-1 ${className ?? ""}`}>
      <div className="text-2xl font-bold font-mono tabular-nums">{value}</div>
      <div className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground mt-0.5">
        {label}
      </div>
    </div>
  );
}

function recordString(stats: RecordRow): string {
  return stats.ties > 0
    ? `${stats.wins}-${stats.losses}-${stats.ties}`
    : `${stats.wins}-${stats.losses}`;
}

function RecordTile({ stats }: { stats: RecordRow }) {
  const pct =
    stats.wins + stats.losses + stats.ties > 0
      ? (stats.wins + stats.ties * 0.5) /
        (stats.wins + stats.losses + stats.ties)
      : 0;
  return (
    <div className="border rounded-lg p-4 flex flex-col gap-3">
      <TileLabel>Record</TileLabel>
      <div className="flex items-center divide-x divide-border/60">
        <StatBlock
          value={recordString(stats)}
          label={stats.ties > 0 ? "W-L-T" : "W-L"}
          className="px-3 first:pl-0 last:pr-0"
        />
        <StatBlock
          value={`${(pct * 100).toFixed(0)}%`}
          label="Win %"
          className="px-3 first:pl-0 last:pr-0"
        />
      </div>
    </div>
  );
}

function PointsForTile({ stats }: { stats: RecordRow }) {
  return (
    <div className="border rounded-lg p-4 flex flex-col gap-3">
      <TileLabel>Points For</TileLabel>
      <div className="flex items-center divide-x divide-border/60">
        <StatBlock
          value={stats.fpts.toLocaleString(undefined, {
            maximumFractionDigits: 1,
          })}
          label="Total"
          className="px-3 first:pl-0 last:pr-0"
        />
        {stats.total > 0 && (
          <StatBlock
            value={ordinal(stats.fptsRank)}
            label={`of ${stats.total}`}
            className="px-3 first:pl-0 last:pr-0"
          />
        )}
      </div>
    </div>
  );
}

function RankTile({
  stats,
  championshipYears,
}: {
  stats: RecordRow;
  championshipYears: string[];
}) {
  const titles = championshipYears.length;
  return (
    <div className="border rounded-lg p-4 flex flex-col gap-3">
      <TileLabel>League Rank</TileLabel>
      <div className="flex items-center divide-x divide-border/60">
        <StatBlock
          value={
            stats.total > 0 ? (
              <>
                {ordinal(stats.recordRank)}
                <span className="text-muted-foreground text-base">
                  {" "}
                  of {stats.total}
                </span>
              </>
            ) : (
              "--"
            )
          }
          label="By Record"
          className="px-3 first:pl-0 last:pr-0"
        />
        {titles > 0 && (
          <div className="px-3 first:pl-0 last:pr-0 min-w-0 flex-1">
            <div className="text-2xl font-bold font-mono tabular-nums flex items-center gap-1.5">
              {titles}
              <ChampionshipTrophies years={championshipYears} />
            </div>
            <div className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground mt-0.5">
              {titles === 1 ? "Title" : "Titles"}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Section 3: Season History — single all-time row whose detail
// renders the per-season table
// ============================================================

function SeasonHistorySection({
  seasonHistory,
  championshipSet,
  allTime,
}: {
  seasonHistory: SeasonHistoryRow[];
  championshipSet: Set<string>;
  allTime: RecordRow;
}) {
  if (seasonHistory.length === 0) return null;

  const sections: CollapsibleSection[] = [
    {
      key: "all-time",
      rows: [
        {
          key: "all-time",
          title: "All-time",
          meta: (
            <>
              <span>
                {allTime.wins}-{allTime.losses}
                {allTime.ties > 0 ? `-${allTime.ties}` : ""}
              </span>
              <span>
                {allTime.fpts.toLocaleString(undefined, {
                  maximumFractionDigits: 1,
                })}{" "}
                pts
              </span>
              {championshipSet.size > 0 && (
                <span className="inline-flex items-center gap-1">
                  {championshipSet.size}× champion
                </span>
              )}
              <span>{seasonHistory.length} seasons</span>
            </>
          ),
          detail: (
            <SeasonHistoryTable
              seasonHistory={seasonHistory}
              championshipSet={championshipSet}
            />
          ),
        },
      ],
    },
  ];

  return (
    <section>
      <h2 className="text-lg font-semibold mb-3">Season History</h2>
      <CollapsibleSeasonTable
        sections={sections}
        emptyMessage="No season data"
      />
    </section>
  );
}

function SeasonHistoryTable({
  seasonHistory,
  championshipSet,
}: {
  seasonHistory: SeasonHistoryRow[];
  championshipSet: Set<string>;
}) {
  return (
    <div className="border-t bg-muted/10 overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead className="bg-muted/30 text-left">
          <tr>
            <th className="sticky left-0 z-10 bg-muted/30 px-3 py-2 font-medium font-mono text-xs uppercase tracking-wide shadow-[1px_0_0_0_var(--border)]">
              Season
            </th>
            <th className="px-3 py-2 font-medium font-mono text-xs uppercase tracking-wide text-right">
              W/L
            </th>
            <th className="px-3 py-2 font-medium font-mono text-xs uppercase tracking-wide text-right">
              Points
            </th>
            <th className="px-3 py-2 font-medium font-mono text-xs uppercase tracking-wide text-center">
              MPS
            </th>
            {PILLAR_KEYS.map((key) => (
              <th
                key={key}
                className="px-3 py-2 font-medium font-mono text-xs uppercase tracking-wide text-center"
              >
                {PILLAR_LABELS[key]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {seasonHistory.map((row) => (
            <tr key={row.season} className="border-t border-border/60">
              <td className="sticky left-0 z-10 bg-card px-3 py-2 font-mono shadow-[1px_0_0_0_var(--border)]">
                <span className="inline-flex items-center gap-1.5">
                  {row.season}
                  {championshipSet.has(row.season) && (
                    <ChampionshipTrophy year={row.season} />
                  )}
                </span>
              </td>
              <td className="px-3 py-2 font-mono text-right tabular-nums">
                {row.wins}-{row.losses}
                {row.ties > 0 ? `-${row.ties}` : ""}
              </td>
              <td className="px-3 py-2 font-mono text-right tabular-nums">
                {row.fpts.toLocaleString(undefined, {
                  maximumFractionDigits: 1,
                })}
              </td>
              <td className="px-3 py-2 text-center">
                <RankCell score={row.mps} />
              </td>
              {PILLAR_KEYS.map((key) => (
                <td key={key} className="px-3 py-2 text-center">
                  <GradeOnlyCell score={row.pillars[key]} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RankCell({ score }: { score: ManagerScore | null }) {
  if (!score) {
    return <span className="text-xs text-muted-foreground">--</span>;
  }
  return (
    <div className="inline-flex items-center gap-2">
      <span className="font-mono text-xs tabular-nums whitespace-nowrap">
        {score.rank}
        <span className="text-muted-foreground">/{score.total}</span>
      </span>
      <GradeBadge grade={score.grade} size="xs" />
    </div>
  );
}

function GradeOnlyCell({ score }: { score: ManagerScore | null }) {
  if (!score) {
    return <span className="text-xs text-muted-foreground">--</span>;
  }
  return <GradeBadge grade={score.grade} size="xs" />;
}

// ============================================================
// Section 5: Roster
// ============================================================

function RosterSection({
  familyId,
  snapshot,
  selectedSeason,
}: {
  familyId: string;
  snapshot: RosterSnapshot;
  selectedSeason: SeasonFilter;
}) {
  const [expanded, setExpanded] = useState(false);

  const seasonLabel = selectedSeason === "all" ? "Current" : selectedSeason;
  const asOfLabel = snapshot.asOf
    ? new Date(snapshot.asOf).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;

  // For past seasons, the snapshot reflects the league's last-synced roster —
  // typically the final roster of that season. For "current", the timestamp
  // is fresh and worth showing.
  const subLine =
    selectedSeason === "all"
      ? asOfLabel
        ? `Last synced ${asOfLabel}`
        : "Last synced"
      : `Final roster of the ${selectedSeason} season`;

  return (
    <section>
      <h2 className="text-lg font-semibold mb-3">Roster: {seasonLabel}</h2>
      <div className="border rounded-lg overflow-hidden bg-card">
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="w-full px-3 sm:px-4 py-3 flex items-center gap-3 text-left hover:bg-muted/30 transition-colors min-h-[44px]"
          aria-expanded={expanded}
        >
          <ChevronDown
            className={`h-4 w-4 text-muted-foreground transition-transform shrink-0 ${
              expanded ? "" : "-rotate-90"
            }`}
          />
          <div className="flex-1 min-w-0">
            <div className="font-medium truncate">
              {snapshot.players.length} player
              {snapshot.players.length !== 1 ? "s" : ""}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {subLine}
            </div>
          </div>
        </button>
        {expanded && (
          <RosterPlayerList
            players={snapshot.players}
            familyId={familyId}
          />
        )}
      </div>
    </section>
  );
}

function RosterPlayerList({
  players,
  familyId,
}: {
  players: RosterPlayer[];
  familyId: string;
}) {
  if (players.length === 0) {
    return (
      <p className="border-t bg-muted/10 px-4 py-6 text-center text-sm text-muted-foreground">
        Roster is empty
      </p>
    );
  }

  return (
    <ul className="border-t bg-muted/10 divide-y divide-border/60">
      {players.map((p) => (
        <li
          key={p.id}
          className="px-3 sm:px-4 py-2 flex items-center gap-2 sm:gap-3 min-h-[44px]"
        >
          <PositionChip position={p.position} />
          <div className="flex-1 min-w-0">
            <Link
              href={`/league/${familyId}/player/${p.id}`}
              className="text-sm font-medium hover:text-primary transition-colors block truncate"
            >
              {p.name}
            </Link>
            <div className="flex flex-wrap gap-x-3 gap-y-0 text-xs text-muted-foreground font-mono">
              {p.team && <span>{p.team}</span>}
              {p.age != null && <span>Age {p.age}</span>}
              {p.ppg != null && <span>{p.ppg.toFixed(1)} PPG</span>}
              {p.startPct != null && (
                <span>{p.startPct.toFixed(0)}% Start</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Link
              href={`/league/${familyId}/graph?seedPlayerId=${p.id}&from=manager`}
              className="inline-flex items-center justify-center h-10 w-10 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              aria-label={`Trace ${p.name} lineage`}
              title="Trace lineage"
            >
              <GitBranch className="h-4 w-4" />
            </Link>
            <Link
              href={`/league/${familyId}/player/${p.id}`}
              className="inline-flex items-center justify-center h-10 w-10 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              aria-label={`View ${p.name} player card`}
              title="Player card"
            >
              <IdCard className="h-4 w-4" />
            </Link>
          </div>
        </li>
      ))}
    </ul>
  );
}

// ============================================================
// Section 4: Recent Transactions
// ============================================================

function TransactionsSection({
  familyId,
  transactions,
  allCount,
  allSeasons,
  selectedSeason,
  selectedType,
  onSeasonChange,
  onTypeChange,
}: {
  familyId: string;
  transactions: Transaction[];
  allCount: number;
  allSeasons: string[];
  selectedSeason: SeasonFilter;
  selectedType: string;
  onSeasonChange: (s: SeasonFilter) => void;
  onTypeChange: (t: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const typeOptions = [
    { value: "all", label: "All" },
    { value: "trade", label: "Trades" },
    { value: "waiver", label: "Waivers" },
    { value: "free_agent", label: "Free Agents" },
  ];

  return (
    <section>
      <h2 className="text-lg font-semibold mb-3">Transactions</h2>
      <div className="border rounded-lg overflow-hidden bg-card">
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="w-full px-3 sm:px-4 py-3 flex items-center gap-3 text-left hover:bg-muted/30 transition-colors min-h-[44px]"
          aria-expanded={expanded}
        >
          <ChevronDown
            className={`h-4 w-4 text-muted-foreground transition-transform shrink-0 ${
              expanded ? "" : "-rotate-90"
            }`}
          />
          <div className="flex-1 min-w-0">
            <div className="font-medium truncate">
              {transactions.length} of {allCount} transaction
              {allCount !== 1 ? "s" : ""}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              Trades, waivers, and free agents
            </div>
          </div>
        </button>
        {expanded && (
          <div className="border-t bg-muted/10">
            <div className="p-3 sm:p-4 flex flex-wrap gap-x-3 gap-y-2 border-b">
              {allSeasons.length > 1 && (
                <div className="flex flex-wrap gap-2">
                  <FilterChip
                    active={selectedSeason === "all"}
                    onClick={() => onSeasonChange("all")}
                  >
                    All Seasons
                  </FilterChip>
                  {allSeasons.map((s) => (
                    <FilterChip
                      key={s}
                      active={selectedSeason === s}
                      onClick={() => onSeasonChange(s)}
                    >
                      {s}
                    </FilterChip>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                {typeOptions.map((o) => (
                  <FilterChip
                    key={o.value}
                    active={selectedType === o.value}
                    onClick={() => onTypeChange(o.value)}
                  >
                    {o.label}
                  </FilterChip>
                ))}
              </div>
            </div>

            {transactions.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                No transactions match the current filters
              </p>
            ) : (
              <ul className="divide-y divide-border/60">
                {transactions.map((tx) => (
                  <li key={tx.id}>
                    <TransactionRow tx={tx} familyId={familyId} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function pickLabel(p: PickRef): string {
  return `${p.season} ${p.round}${getRoundSuffix(p.round)}`;
}

function AssetList({
  players,
  picks,
  sign,
  className,
}: {
  players: PlayerRef[];
  picks: PickRef[];
  sign: "+" | "−";
  className: string;
}) {
  if (players.length === 0 && picks.length === 0) return null;
  const items: string[] = [
    ...players.map((p) => p.name),
    ...picks.map((p) => `${pickLabel(p)} pick`),
  ];
  return (
    <span className={className}>
      {sign}
      {items.join(", ")}
    </span>
  );
}

function TransactionRow({
  tx,
  familyId,
}: {
  tx: Transaction;
  familyId: string;
}) {
  const isTrade = tx.type === "trade";
  const hasReceived = tx.adds.length > 0 || tx.picksReceived.length > 0;
  const hasSent = tx.drops.length > 0 || tx.picksSent.length > 0;

  return (
    <Link
      href={`/league/${familyId}/graph?seedTransactionId=${tx.id}&from=manager`}
      className="px-3 sm:px-4 py-3 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 sm:gap-4 hover:bg-muted/30 transition-colors"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <TypeBadge type={tx.type} />
          <span className="text-xs text-muted-foreground font-mono">
            {tx.season} W{tx.week}
          </span>
        </div>
        {isTrade ? (
          <div className="text-sm space-y-0.5">
            {hasReceived && (
              <div className="flex gap-2">
                <span className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground mt-1 shrink-0 w-16">
                  Received
                </span>
                <AssetList
                  players={tx.adds}
                  picks={tx.picksReceived}
                  sign="+"
                  className="text-primary"
                />
              </div>
            )}
            {hasSent && (
              <div className="flex gap-2">
                <span className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground mt-1 shrink-0 w-16">
                  Sent
                </span>
                <AssetList
                  players={tx.drops}
                  picks={tx.picksSent}
                  sign="−"
                  className="text-muted-foreground"
                />
              </div>
            )}
          </div>
        ) : (
          <div className="text-sm">
            <AssetList
              players={tx.adds}
              picks={tx.picksReceived}
              sign="+"
              className="text-primary"
            />
            {hasReceived && hasSent && (
              <span className="text-muted-foreground mx-1">/</span>
            )}
            <AssetList
              players={tx.drops}
              picks={tx.picksSent}
              sign="−"
              className="text-muted-foreground"
            />
          </div>
        )}
      </div>
      {tx.grade && <GradeBadge grade={tx.grade} size="xs" />}
    </Link>
  );
}
