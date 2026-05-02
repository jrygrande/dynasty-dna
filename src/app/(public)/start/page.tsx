"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight } from "lucide-react";

type ViewState =
  | "empty"
  | "loading"
  | "leagues"
  | "error_invalid"
  | "error_stale"
  | "error_empty_leagues"
  | "error_api_down";

interface FoundLeague {
  league_id: string;
  family_id: string | null;
  name: string;
  season: string;
  avatar: string | null;
}

interface FindLeaguesResponse {
  username: string;
  user_id: string;
  leagues: FoundLeague[];
}

// Mock data matches the response shape of POST /api/start/find-leagues — wired
// in #82. Toggle MOCK_VIEW_STATE locally to scaffold each state visually.
const MOCK_RESPONSE: FindLeaguesResponse = {
  username: "demo_user",
  user_id: "12345",
  leagues: [
    { league_id: "1", family_id: "fam_a", name: "Demo Dynasty League", season: "2025", avatar: null },
    { league_id: "2", family_id: null, name: "Another Dynasty League", season: "2025", avatar: null },
  ],
};

const MOCK_VIEW_STATE: ViewState = "empty";

export default function StartPage() {
  const [viewState] = useState<ViewState>(MOCK_VIEW_STATE);
  const [username, setUsername] = useState("");
  const response = MOCK_RESPONSE;

  return (
    <main className="container mx-auto px-6 py-16 max-w-xl">
      <h1 className="font-serif text-4xl md:text-5xl font-medium tracking-tight mb-2 text-center">
        Find your leagues
      </h1>
      <p className="text-muted-foreground text-center mb-10">
        Enter your Sleeper username to find your dynasty leagues.
      </p>

      {(viewState === "empty" ||
        viewState === "loading" ||
        viewState === "error_invalid" ||
        viewState === "error_stale" ||
        viewState === "error_empty_leagues" ||
        viewState === "error_api_down") && (
        <UsernameInput
          value={username}
          onChange={setUsername}
          disabled={viewState === "loading"}
          showStaleHint={viewState === "error_stale"}
        />
      )}

      {viewState === "error_invalid" && (
        <div className="mt-6 p-4 rounded-md bg-grade-f/8 border border-grade-f/25 text-grade-f text-sm">
          We couldn&apos;t find @{username || "{username}"} on Sleeper. Check the spelling and try again.{" "}
          <Link href="/demo" className="underline hover:no-underline">
            Or browse a demo league.
          </Link>
        </div>
      )}

      {viewState === "error_empty_leagues" && (
        <div className="mt-6 p-4 rounded-md bg-grade-c/8 border border-grade-c/25 text-grade-c text-sm">
          We didn&apos;t find any dynasty leagues for @{username || "{username}"} on Sleeper.
          Dynasty DNA only supports true dynasty leagues (Sleeper{" "}
          <code className="font-mono text-xs">settings.type === 2</code>). Keeper leagues
          aren&apos;t supported yet. In the meantime,{" "}
          <Link href="/demo" className="underline hover:no-underline">
            browse our demo league
          </Link>
          .
        </div>
      )}

      {viewState === "error_api_down" && (
        <div className="mt-6 p-4 rounded-md bg-grade-c/8 border border-grade-c/25 text-grade-c text-sm flex items-center justify-between gap-3">
          <span>Sleeper&apos;s API isn&apos;t responding. Try again in a moment.</span>
          <button
            type="button"
            className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {viewState === "loading" && (
        <div className="mt-8 space-y-3" aria-label="Loading leagues">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-16 rounded-md bg-muted animate-pulse" />
          ))}
        </div>
      )}

      {viewState === "leagues" && (
        <LeaguesList
          username={response.username}
          leagues={response.leagues}
        />
      )}
    </main>
  );
}

function UsernameInput({
  value,
  onChange,
  disabled,
  showStaleHint,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  showStaleHint: boolean;
}) {
  return (
    <form className="space-y-3" onSubmit={(e) => e.preventDefault()}>
      {showStaleHint && (
        <p className="text-sm text-muted-foreground">
          We couldn&apos;t find that user anymore — try entering a username.
        </p>
      )}
      <div className="flex gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder="Sleeper username"
          aria-label="Sleeper username"
          className="flex-1 px-4 py-2.5 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={disabled || !value.trim()}
          className="px-5 py-2.5 rounded-md bg-primary text-primary-foreground font-medium text-sm hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          Find my leagues
        </button>
      </div>
    </form>
  );
}

function LeaguesList({
  username,
  leagues,
}: {
  username: string;
  leagues: FoundLeague[];
}) {
  const inDb = leagues.filter((l) => l.family_id);
  const notInDb = leagues.filter((l) => !l.family_id);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          @<span className="font-mono">{username}</span> — not you?
        </span>
        <button
          type="button"
          className="text-primary hover:underline"
        >
          Switch user
        </button>
      </div>

      {inDb.length > 0 && (
        <div className="space-y-2">
          {inDb.map((l) => (
            <div
              key={l.league_id}
              className="flex items-center justify-between gap-4 p-4 rounded-md border bg-card"
            >
              <div className="min-w-0">
                <p className="font-medium truncate">{l.name}</p>
                <p className="text-xs text-muted-foreground font-mono">{l.season}</p>
              </div>
              <Link
                href={`/league/${l.family_id}`}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors flex-shrink-0"
              >
                Open
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          ))}
        </div>
      )}

      {notInDb.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-wide text-muted-foreground font-mono">
            Not yet supported
          </p>
          {notInDb.map((l) => (
            <div
              key={l.league_id}
              className="flex items-center justify-between gap-4 p-4 rounded-md border bg-card"
            >
              <div className="min-w-0">
                <p className="font-medium truncate">{l.name}</p>
                <p className="text-xs text-muted-foreground font-mono">{l.season}</p>
              </div>
              <button
                type="button"
                className="px-4 py-2 rounded-md border border-primary text-primary text-sm font-medium hover:bg-primary/10 transition-colors flex-shrink-0"
              >
                Join waitlist
              </button>
            </div>
          ))}
          {inDb.length === 0 && (
            <p className="text-sm text-muted-foreground pt-2">
              None of your leagues are supported yet.{" "}
              <Link href="/demo" className="text-primary hover:underline">
                Browse a demo league →
              </Link>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
