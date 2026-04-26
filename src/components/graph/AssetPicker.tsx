"use client";

import { useEffect, useMemo, useState } from "react";
import type { AssetsListResponse } from "@/app/api/leagues/[familyId]/assets/route";
import type { GraphFocus } from "@/lib/assetGraph";
import { getRoundSuffix } from "@/lib/utils";

interface AssetPickerProps {
  familyId: string;
  onPick: (focus: GraphFocus) => void;
}

type Tab = "players" | "picks";

export function AssetPicker({ familyId, onPick }: AssetPickerProps) {
  const [data, setData] = useState<AssetsListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("players");
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/leagues/${familyId}/assets`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<AssetsListResponse>;
      })
      .then((json) => {
        if (!cancelled) setData(json);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load assets");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [familyId]);

  const q = query.trim().toLowerCase();

  const filteredPlayers = useMemo(() => {
    if (!data) return [];
    if (!q) return data.players.slice(0, 200);
    return data.players
      .filter((p) => {
        const haystack = `${p.name} ${p.position ?? ""} ${p.team ?? ""}`.toLowerCase();
        return haystack.includes(q);
      })
      .slice(0, 200);
  }, [data, q]);

  const filteredPicks = useMemo(() => {
    if (!data) return [];
    if (!q) return data.picks.slice(0, 200);
    return data.picks
      .filter((p) => {
        const haystack = `${p.season} ${p.round} ${p.originalOwnerName ?? ""} ${
          p.resolvedPlayerName ?? ""
        }`.toLowerCase();
        return haystack.includes(q);
      })
      .slice(0, 200);
  }, [data, q]);

  return (
    <div className="flex h-full w-full items-center justify-center p-6">
      <div className="w-full max-w-xl rounded-lg border bg-card shadow-sm">
        <div className="border-b px-5 py-4">
          <h2 className="text-base font-semibold">Pick an asset to start</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Choose a player or draft pick. Each click on a neighbor expands the
            graph one hop at a time.
          </p>
        </div>

        <div className="flex border-b text-sm">
          <TabButton active={tab === "players"} onClick={() => setTab("players")}>
            Players
          </TabButton>
          <TabButton active={tab === "picks"} onClick={() => setTab("picks")}>
            Picks
          </TabButton>
        </div>

        <div className="px-5 py-3">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tab === "players" ? "Search players…" : "Search picks…"}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            autoFocus
          />
        </div>

        <div className="max-h-96 overflow-y-auto px-2 pb-3">
          {loading && (
            <div className="space-y-2 px-3 py-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="h-10 animate-pulse rounded-md bg-muted/30"
                />
              ))}
            </div>
          )}
          {error && (
            <p className="px-3 py-4 text-sm text-destructive">{error}</p>
          )}
          {!loading && !error && tab === "players" && (
            <PlayerList
              players={filteredPlayers}
              empty={data?.players.length === 0 ? "No players found." : "No matches."}
              onPick={(p) => onPick({ kind: "player", playerId: p.id })}
            />
          )}
          {!loading && !error && tab === "picks" && (
            <PickList
              picks={filteredPicks}
              empty={data?.picks.length === 0 ? "No picks found." : "No matches."}
              onPick={(p) =>
                onPick({
                  kind: "pick",
                  leagueId: p.leagueId,
                  pickSeason: p.season,
                  pickRound: p.round,
                  pickOriginalRosterId: p.originalRosterId,
                })
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}

function TabButton({
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
      type="button"
      onClick={onClick}
      className={
        "flex-1 px-4 py-2.5 font-medium transition-colors " +
        (active
          ? "border-b-2 border-foreground text-foreground"
          : "text-muted-foreground hover:text-foreground")
      }
    >
      {children}
    </button>
  );
}

function PlayerList({
  players,
  empty,
  onPick,
}: {
  players: AssetsListResponse["players"];
  empty: string;
  onPick: (p: AssetsListResponse["players"][number]) => void;
}) {
  if (players.length === 0) {
    return <p className="px-3 py-4 text-sm text-muted-foreground">{empty}</p>;
  }
  return (
    <ul className="space-y-1">
      {players.map((p) => (
        <li key={p.id}>
          <button
            type="button"
            onClick={() => onPick(p)}
            className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground"
          >
            <span className="font-medium">{p.name}</span>
            <span className="text-xs text-muted-foreground">
              {[p.position, p.team].filter(Boolean).join(" · ") || "—"}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function PickList({
  picks,
  empty,
  onPick,
}: {
  picks: AssetsListResponse["picks"];
  empty: string;
  onPick: (p: AssetsListResponse["picks"][number]) => void;
}) {
  if (picks.length === 0) {
    return <p className="px-3 py-4 text-sm text-muted-foreground">{empty}</p>;
  }
  return (
    <ul className="space-y-1">
      {picks.map((p) => (
        <li key={p.key}>
          <button
            type="button"
            onClick={() => onPick(p)}
            className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground"
          >
            <span className="font-medium">
              {p.season} · {p.round}
              {getRoundSuffix(p.round)} round
            </span>
            <span className="text-xs text-muted-foreground">
              {p.originalOwnerName ?? "Unknown owner"}
              {p.resolvedPlayerName ? ` → ${p.resolvedPlayerName}` : ""}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
