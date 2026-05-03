"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Network } from "lucide-react";
import {
  LineupEfficiencyCard,
  type RosterGrade,
} from "@/components/LineupEfficiencyCard";
import { ManagerName, ManagerSecondaryName } from "@/components/ManagerName";
import { ChampionshipTrophies } from "@/components/ChampionshipTrophy";
import { useFlag } from "@/lib/useFlag";

interface Roster {
  rosterId: number;
  ownerId: string;
  wins: number;
  losses: number;
  ties: number;
  fpts: number;
  fptsAgainst: number;
  seasonsPlayed: number;
  championshipYears: string[];
}

interface LeagueUser {
  userId: string;
  displayName: string | null;
  teamName: string | null;
  avatar: string | null;
}

interface LeagueOverviewData {
  league: {
    id: string;
    name: string;
    season: string;
    totalRosters: number | null;
    status: string | null;
  };
  familyId: string | null;
  seasons: Array<{ leagueId: string; season: string }>;
  rosters: Roster[];
  users: LeagueUser[];
}

const ALL_TIME = "all";

export default function LeagueOverviewPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const familyId = params.familyId as string;
  const seasonParam = searchParams.get("season") ?? ALL_TIME;
  const isAllTime = seasonParam === ALL_TIME;
  const [data, setData] = useState<LeagueOverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoSyncing, setAutoSyncing] = useState(false);
  const [lineupGrades, setLineupGrades] = useState<RosterGrade[] | null>(null);
  const graphEnabled = useFlag("ASSET_GRAPH_BROWSER");

  const loadLeagueData = useCallback(async () => {
    setLoading(true);
    setLineupGrades(null);
    const seasonQuery = `?season=${seasonParam}`;
    const res = await fetch(`/api/leagues/${familyId}${seasonQuery}`);
    if (res.ok) {
      const result = await res.json();
      setData(result);
      setLoading(false);
      if (seasonParam !== ALL_TIME) {
        fetch(`/api/leagues/${familyId}/lineup-grades${seasonQuery}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((r) => setLineupGrades(r?.rosters || null))
          .catch(() => setLineupGrades(null));
      }
    } else if (res.status === 404) {
      // First-time visit for an unseeded family — kick off ingestion in the
      // background so the page settles into real data without exposing a
      // manual sync surface to the user.
      setAutoSyncing(true);
      const syncRes = await fetch("/api/sync/league", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leagueId: familyId }),
      });
      if (syncRes.ok) {
        const retryRes = await fetch(`/api/leagues/${familyId}${seasonQuery}`);
        if (retryRes.ok) {
          const result = await retryRes.json();
          setData(result);
        }
      }
      setAutoSyncing(false);
      setLoading(false);
    } else {
      setLoading(false);
    }
  }, [familyId, seasonParam]);

  useEffect(() => {
    loadLeagueData();
  }, [loadLeagueData]);

  function setSeason(value: string) {
    const sp = new URLSearchParams(searchParams.toString());
    sp.set("season", value);
    router.replace(`?${sp.toString()}`, { scroll: false });
  }

  if (loading || autoSyncing) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">
          {autoSyncing
            ? "Loading league data from Sleeper..."
            : "Loading league..."}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">League not found</p>
      </div>
    );
  }

  const userMap = new Map(data.users.map((u) => [u.userId, u]));
  const standings = data.rosters;

  return (
    <div>
      <div className="border-b">
        <div className="container mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 sm:gap-4 min-w-0">
            <Link
              href="/start"
              className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 shrink-0"
            >
              <ArrowLeft className="h-4 w-4" />
              <span className="hidden sm:inline">My leagues</span>
            </Link>
            <h1 className="text-base sm:text-lg font-semibold truncate">
              {data.league.name}
            </h1>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <Link
              href={`/league/${familyId}/transactions`}
              className="px-2.5 sm:px-3 py-1.5 text-sm rounded-md border hover:bg-secondary transition-colors"
            >
              Transactions
            </Link>
            <Link
              href={`/league/${familyId}/drafts`}
              className="px-2.5 sm:px-3 py-1.5 text-sm rounded-md border hover:bg-secondary transition-colors"
            >
              Drafts
            </Link>
            {graphEnabled && (
              <Link
                href={`/league/${familyId}/graph?from=overview`}
                className="px-2.5 sm:px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors inline-flex items-center gap-2 font-medium"
              >
                <Network className="h-4 w-4" />
                <span className="hidden sm:inline">Lineage Tracer</span>
              </Link>
            )}
          </div>
        </div>
      </div>

      <main className="container mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="-mx-4 sm:mx-0 mb-6 overflow-x-auto">
          <div className="px-4 sm:px-0 flex gap-2 w-max">
            <SeasonChip active={isAllTime} onClick={() => setSeason(ALL_TIME)}>
              All-time
            </SeasonChip>
            {data.seasons.map((s) => (
              <SeasonChip
                key={s.leagueId}
                active={!isAllTime && seasonParam === s.season}
                onClick={() => setSeason(s.season)}
              >
                {s.season}
              </SeasonChip>
            ))}
          </div>
        </div>

        <section>
          <h2 className="text-lg font-semibold mb-4">Standings</h2>

          <div className="hidden md:block border rounded-lg overflow-hidden">
            <table className="w-full">
              <thead className="bg-muted/50">
                <tr className="text-left text-sm">
                  <th className="px-4 py-3 font-medium w-10">#</th>
                  <th className="px-4 py-3 font-medium">Manager</th>
                  <th className="px-4 py-3 font-medium text-right">W</th>
                  <th className="px-4 py-3 font-medium text-right">L</th>
                  {isAllTime && (
                    <th className="px-4 py-3 font-medium text-right">T</th>
                  )}
                  <th className="px-4 py-3 font-medium text-right">PF</th>
                  <th className="px-4 py-3 font-medium text-right">PA</th>
                </tr>
              </thead>
              <tbody>
                {standings.map((roster, idx) => {
                  const user = userMap.get(roster.ownerId);
                  return (
                    <tr
                      key={roster.ownerId}
                      className="border-t hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-4 py-3 text-sm font-mono text-muted-foreground">
                        {idx + 1}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <Link
                            href={`/league/${familyId}/manager/${roster.ownerId}`}
                            className="font-medium hover:text-primary transition-colors"
                          >
                            <ManagerName
                              userId={roster.ownerId}
                              rosterId={roster.rosterId}
                              displayName={user?.displayName}
                              teamName={user?.teamName}
                            />
                          </Link>
                          <ChampionshipTrophies
                            years={roster.championshipYears}
                          />
                          <ManagerSecondaryName
                            userId={roster.ownerId}
                            rosterId={roster.rosterId}
                            displayName={user?.displayName}
                            teamName={user?.teamName}
                            className="text-sm text-muted-foreground"
                          />
                          {isAllTime && (
                            <span className="text-xs font-mono text-muted-foreground">
                              {roster.seasonsPlayed} season
                              {roster.seasonsPlayed === 1 ? "" : "s"}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-sm">
                        {roster.wins}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-sm">
                        {roster.losses}
                      </td>
                      {isAllTime && (
                        <td className="px-4 py-3 text-right font-mono text-sm">
                          {roster.ties}
                        </td>
                      )}
                      <td className="px-4 py-3 text-right font-mono text-sm">
                        {roster.fpts.toFixed(1)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-sm">
                        {roster.fptsAgainst.toFixed(1)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <ul className="md:hidden space-y-2">
            {standings.map((roster, idx) => {
              const user = userMap.get(roster.ownerId);
              return (
                <li
                  key={roster.ownerId}
                  className="border rounded-lg bg-card p-3"
                >
                  <div className="flex items-start gap-3">
                    <span className="font-mono text-sm text-muted-foreground pt-0.5 w-6 shrink-0">
                      {idx + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <Link
                          href={`/league/${familyId}/manager/${roster.ownerId}`}
                          className="font-medium hover:text-primary transition-colors break-words"
                        >
                          <ManagerName
                            userId={roster.ownerId}
                            rosterId={roster.rosterId}
                            displayName={user?.displayName}
                            teamName={user?.teamName}
                          />
                        </Link>
                        <ChampionshipTrophies
                          years={roster.championshipYears}
                        />
                      </div>
                      <ManagerSecondaryName
                        userId={roster.ownerId}
                        rosterId={roster.rosterId}
                        displayName={user?.displayName}
                        teamName={user?.teamName}
                        className="text-xs text-muted-foreground"
                        parens={false}
                      />
                      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                        <Stat label="Record">
                          {roster.wins}-{roster.losses}
                          {isAllTime ? `-${roster.ties}` : ""}
                        </Stat>
                        <Stat label="PF">{roster.fpts.toFixed(1)}</Stat>
                        <Stat label="PA">{roster.fptsAgainst.toFixed(1)}</Stat>
                        {isAllTime && (
                          <Stat label="Seasons">{roster.seasonsPlayed}</Stat>
                        )}
                      </dl>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        {!isAllTime && lineupGrades && lineupGrades.length > 0 && (
          <div className="mt-8">
            <LineupEfficiencyCard rosters={lineupGrades} />
          </div>
        )}
      </main>
    </div>
  );
}

function SeasonChip({
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
      className={`px-3 py-1 text-sm rounded-full transition-colors whitespace-nowrap shrink-0 ${
        active
          ? "bg-primary text-primary-foreground"
          : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
      }`}
    >
      {children}
    </button>
  );
}

function Stat({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="font-mono">{children}</dd>
    </div>
  );
}
