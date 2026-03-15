"use client";

import Link from "next/link";

interface LeagueSummary {
  league_id: string;
  name: string;
  season: string;
  total_rosters: number;
  status: string;
}

interface LeagueFamily {
  name: string;
  currentLeagueId: string;
  currentSeason: string;
  seasons: LeagueSummary[];
}

interface Props {
  family: LeagueFamily;
}

export function LeagueFamilyCard({ family }: Props) {
  const isDynasty = family.seasons.length > 1;
  const seasonRange =
    family.seasons.length > 1
      ? `${family.seasons[family.seasons.length - 1].season} - ${family.seasons[0].season}`
      : family.seasons[0]?.season;

  return (
    <Link
      href={`/league/${family.currentLeagueId}`}
      className="block rounded-lg border bg-card p-5 hover:border-primary/50 hover:shadow-sm transition-all"
    >
      <div className="flex items-start justify-between mb-2">
        <h3 className="font-semibold text-lg">{family.name}</h3>
        {isDynasty && (
          <span className="text-xs font-medium bg-primary/10 text-primary px-2 py-0.5 rounded-full">
            Dynasty
          </span>
        )}
      </div>
      <div className="space-y-1 text-sm text-muted-foreground">
        <p>{family.seasons[0]?.total_rosters || "?"}-team league</p>
        <p>{seasonRange}</p>
        <p className="capitalize">{family.seasons[0]?.status?.replace("_", " ")}</p>
      </div>
    </Link>
  );
}
