"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LinkSleeperForm } from "@/components/LinkSleeperForm";
import { LeagueFamilyCard } from "@/components/LeagueFamilyCard";

interface LeagueSummary {
  league_id: string;
  name: string;
  season: string;
  total_rosters: number;
  status: string;
  previous_league_id: string | null;
}

interface LeagueFamily {
  name: string;
  currentLeagueId: string;
  currentSeason: string;
  seasons: LeagueSummary[];
}

interface SleeperLinkStatus {
  linked: boolean;
  sleeperId?: string;
  sleeperUsername?: string;
}

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [linkStatus, setLinkStatus] = useState<SleeperLinkStatus | null>(null);
  const [families, setFamilies] = useState<LeagueFamily[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    }
  }, [status, router]);

  useEffect(() => {
    if (!session) return;
    checkSleeperLink();
  }, [session]);

  async function checkSleeperLink() {
    const res = await fetch("/api/user/link-sleeper");
    const data = await res.json();
    setLinkStatus(data);

    if (data.linked) {
      await loadLeagues();
    } else {
      setLoading(false);
    }
  }

  async function loadLeagues() {
    const res = await fetch("/api/leagues/discover");
    const data = await res.json();
    setFamilies(data.families || []);
    setLoading(false);
  }


  if (status === "loading" || !session) {
    return (
      <main className="container mx-auto px-6 py-8">
        <div className="h-7 w-40 bg-muted animate-pulse rounded mb-6" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <LeagueCardSkeleton key={i} />
          ))}
        </div>
      </main>
    );
  }

  return (
      <main className="container mx-auto px-6 py-8">
        {!linkStatus?.linked ? (
          <div className="max-w-md mx-auto">
            <h2 className="text-xl font-semibold mb-4">
              Link your Sleeper account
            </h2>
            <p className="text-muted-foreground mb-6">
              Enter your Sleeper username to get started. We&apos;ll find all
              your dynasty leagues and start analyzing your trades, drafts, and
              lineups.
            </p>
            <LinkSleeperForm onLinked={checkSleeperLink} />
          </div>
        ) : loading ? (
          <div>
            <h2 className="text-xl font-semibold mb-6">Your Leagues</h2>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <LeagueCardSkeleton key={i} />
              ))}
            </div>
          </div>
        ) : families.length === 0 ? (
          <div className="text-center py-20 max-w-md mx-auto">
            <p className="text-lg font-medium mb-2">No leagues found</p>
            <p className="text-muted-foreground mb-6">
              Make sure your Sleeper username is correct and that you have at
              least one dynasty league.
            </p>
            <button
              onClick={() => setLinkStatus(null)}
              className="text-sm text-primary hover:underline"
            >
              Try a different username
            </button>
          </div>
        ) : (
          <div>
            <h2 className="text-xl font-semibold mb-6">Your Leagues</h2>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {families.map((family) => (
                <LeagueFamilyCard key={family.currentLeagueId} family={family} />
              ))}
            </div>
          </div>
        )}
      </main>
  );
}

function LeagueCardSkeleton() {
  return (
    <div className="rounded-lg border bg-card p-5 animate-pulse">
      <div className="flex items-start justify-between mb-2">
        <div className="h-5 w-32 bg-muted rounded" />
        <div className="h-4 w-14 bg-muted rounded-full" />
      </div>
      <div className="space-y-2 mt-3">
        <div className="h-4 w-24 bg-muted rounded" />
        <div className="h-4 w-28 bg-muted rounded" />
        <div className="h-4 w-16 bg-muted rounded" />
      </div>
    </div>
  );
}
