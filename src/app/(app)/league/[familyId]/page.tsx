"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  LineupEfficiencyCard,
  type RosterGrade,
} from "@/components/LineupEfficiencyCard";

interface Roster {
  rosterId: number;
  ownerId: string;
  wins: number;
  losses: number;
  ties: number;
  fpts: number;
  fptsAgainst: number;
}

interface LeagueUser {
  userId: string;
  displayName: string;
  teamName: string | null;
  avatar: string | null;
}

interface LeagueOverviewData {
  league: {
    id: string;
    name: string;
    season: string;
    totalRosters: number;
    status: string;
  };
  familyId: string;
  seasons: Array<{ leagueId: string; season: string }>;
  rosters: Roster[];
  users: LeagueUser[];
}

export default function LeagueOverviewPage() {
  const params = useParams();
  const familyId = params.familyId as string;
  const [data, setData] = useState<LeagueOverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [selectedSeason, setSelectedSeason] = useState<string | null>(null);
  const [lineupGrades, setLineupGrades] = useState<RosterGrade[] | null>(null);

  useEffect(() => {
    loadLeagueData();
  }, [familyId, selectedSeason]);

  async function loadLeagueData() {
    setLoading(true);
    const seasonQuery = selectedSeason ? `?season=${selectedSeason}` : "";
    const res = await fetch(`/api/leagues/${familyId}${seasonQuery}`);
    if (res.ok) {
      const result = await res.json();
      setData(result);
      setLoading(false);
      // Fetch lineup grades in background
      fetch(`/api/leagues/${familyId}/lineup-grades${seasonQuery}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((r) => setLineupGrades(r?.rosters || null))
        .catch(() => setLineupGrades(null));
    } else if (res.status === 404) {
      // League not synced yet — auto-sync it
      setSyncing(true);
      const syncRes = await fetch("/api/sync/league", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leagueId: familyId }),
      });
      if (syncRes.ok) {
        // Reload after sync
        const retryRes = await fetch(`/api/leagues/${familyId}${seasonQuery}`);
        if (retryRes.ok) {
          const result = await retryRes.json();
          setData(result);
        }
      }
      setSyncing(false);
      setLoading(false);
    } else {
      setLoading(false);
    }
  }

  async function handleSync() {
    if (!data) return;
    setSyncing(true);
    await fetch("/api/sync/league", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leagueId: data.league.id }),
    });
    await loadLeagueData();
    setSyncing(false);
  }

  function handleSeasonClick(season: string) {
    setSelectedSeason(season);
  }

  if (loading || syncing) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">
          {syncing
            ? "Syncing league data from Sleeper..."
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
  const standings = [...data.rosters].sort(
    (a, b) => b.wins - a.wins || b.fpts - a.fpts
  );

  return (
      <div>
        {/* Sub-header */}
        <div className="border-b">
          <div className="container mx-auto px-6 py-3 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link
                href="/dashboard"
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                &larr; Dashboard
              </Link>
              <h1 className="text-lg font-semibold">{data.league.name}</h1>
              <span className="text-sm text-muted-foreground">
                {data.league.season}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <Link
                href={`/league/${familyId}/transactions`}
                className="px-3 py-1.5 text-sm rounded-md border hover:bg-secondary transition-colors"
              >
                Transactions
              </Link>
              <Link
                href={`/league/${familyId}/drafts`}
                className="px-3 py-1.5 text-sm rounded-md border hover:bg-secondary transition-colors"
              >
                Drafts
              </Link>
              <button
                onClick={handleSync}
                disabled={syncing}
                className="px-3 py-1.5 text-sm rounded-md border hover:bg-secondary transition-colors disabled:opacity-50"
              >
                {syncing ? "Syncing..." : "Sync Data"}
              </button>
            </div>
          </div>
        </div>

        <main className="container mx-auto px-6 py-8">
        {/* Season selector */}
        {data.seasons.length > 1 && (
          <div className="flex gap-2 mb-6">
            {data.seasons.map((s) => (
              <button
                key={s.leagueId}
                onClick={() => handleSeasonClick(s.season)}
                className={`px-3 py-1 text-sm rounded-full transition-colors ${
                  s.leagueId === data.league.id
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                }`}
              >
                {s.season}
              </button>
            ))}
          </div>
        )}

        {/* Standings */}
        <section>
          <h2 className="text-lg font-semibold mb-4">Standings</h2>
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full">
              <thead className="bg-muted/50">
                <tr className="text-left text-sm">
                  <th className="px-4 py-3 font-medium">#</th>
                  <th className="px-4 py-3 font-medium">Manager</th>
                  <th className="px-4 py-3 font-medium text-right">W</th>
                  <th className="px-4 py-3 font-medium text-right">L</th>
                  <th className="px-4 py-3 font-medium text-right">PF</th>
                  <th className="px-4 py-3 font-medium text-right">PA</th>
                </tr>
              </thead>
              <tbody>
                {standings.map((roster, idx) => {
                  const user = userMap.get(roster.ownerId);
                  return (
                    <tr
                      key={roster.rosterId}
                      className="border-t hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-4 py-3 text-sm text-muted-foreground">
                        {idx + 1}
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/league/${familyId}/manager/${roster.ownerId}`}
                          className="font-medium hover:text-primary transition-colors"
                        >
                          {user?.teamName || user?.displayName || "Unknown"}
                        </Link>
                        {user?.teamName && (
                          <span className="text-sm text-muted-foreground ml-2">
                            ({user.displayName})
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-sm">
                        {roster.wins}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-sm">
                        {roster.losses}
                      </td>
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
        </section>

        {/* Lineup Efficiency */}
        {lineupGrades && lineupGrades.length > 0 && (
          <div className="mt-8">
            <LineupEfficiencyCard rosters={lineupGrades} />
          </div>
        )}
      </main>
      </div>
  );
}
