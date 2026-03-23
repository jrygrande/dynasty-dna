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
    setLoading(true);
    const res = await fetch("/api/leagues/discover");
    const data = await res.json();
    setFamilies(data.families || []);
    setLoading(false);
  }

  async function handleSleeperLinked() {
    await checkSleeperLink();
  }

  if (status === "loading" || !session) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
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
              Enter your Sleeper username to connect your fantasy leagues.
            </p>
            <LinkSleeperForm onLinked={handleSleeperLinked} />
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-pulse text-muted-foreground">
              Loading leagues...
            </div>
          </div>
        ) : families.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-muted-foreground">
              No leagues found for your Sleeper account.
            </p>
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
