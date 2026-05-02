"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import { track } from "@/lib/track";
import {
  clearStoredUsername,
  getStoredUsername,
  setStoredUsername,
} from "@/lib/storedUsername";
import {
  addWaitlistedLeague,
  getWaitlistedLeagues,
} from "@/lib/waitlistedLeagues";

type ViewState =
  | "empty"
  | "loading"
  | "leagues"
  | "error_invalid"
  | "error_stale"
  | "error_empty_leagues"
  | "error_api_down"
  | "error_rate_limited"
  | "error_db";

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
  total_league_count: number;
}

export default function StartPage() {
  return (
    <Suspense fallback={null}>
      <StartPageInner />
    </Suspense>
  );
}

function StartPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [viewState, setViewState] = useState<ViewState>("empty");
  const [username, setUsername] = useState("");
  const [response, setResponse] = useState<FindLeaguesResponse | null>(null);
  const autoSubmittedRef = useRef(false);
  const errorUsername = response?.username ?? username.trim();

  const submit = useCallback(
    async (rawUsername: string, opts?: { fromStored?: boolean }) => {
      const trimmed = rawUsername.trim();
      if (!trimmed) return;
      const lower = trimmed.toLowerCase();
      setViewState("loading");
      try {
        const res = await fetch("/api/start/find-leagues", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: lower }),
        });

        if (res.status === 404) {
          if (opts?.fromStored) {
            clearStoredUsername();
            setUsername("");
            setViewState("error_stale");
          } else {
            setViewState("error_invalid");
          }
          return;
        }
        if (res.status === 429) {
          setViewState("error_rate_limited");
          return;
        }
        if (res.status === 502) {
          setViewState("error_api_down");
          return;
        }
        if (res.status >= 500) {
          setViewState("error_db");
          return;
        }
        if (!res.ok) {
          setViewState("error_invalid");
          return;
        }

        const data = (await res.json()) as FindLeaguesResponse;
        setResponse(data);

        const inDbCount = data.leagues.filter((l) => l.family_id).length;
        track("username_submitted", {
          had_in_db_match: inDbCount > 0,
          dynasty_count: data.leagues.length,
          total_league_count: data.total_league_count,
        });

        if (data.leagues.length === 0) {
          setViewState("error_empty_leagues");
          return;
        }

        setStoredUsername(data.username);
        setViewState("leagues");
        track("leagues_loaded");
      } catch {
        setViewState("error_api_down");
      }
    },
    []
  );

  // ?switch=1 must reset the page even when it's already mounted (the nav's
  // "Switch user" routes here while the user is on /start). Run on every
  // searchParams change, not just first mount.
  useEffect(() => {
    if (searchParams?.get("switch") !== "1") return;
    clearStoredUsername();
    setUsername("");
    setResponse(null);
    setViewState("empty");
    autoSubmittedRef.current = true;
    router.replace("/start");
  }, [searchParams, router]);

  useEffect(() => {
    if (autoSubmittedRef.current) return;
    if (searchParams?.get("switch") === "1") return;
    autoSubmittedRef.current = true;
    const stored = getStoredUsername();
    if (stored) {
      setUsername(stored);
      submit(stored, { fromStored: true });
    }
  }, [searchParams, submit]);

  function handleSwitchUser() {
    clearStoredUsername();
    setUsername("");
    setResponse(null);
    setViewState("empty");
  }

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
        viewState === "error_api_down" ||
        viewState === "error_rate_limited" ||
        viewState === "error_db") && (
        <UsernameInput
          value={username}
          onChange={setUsername}
          disabled={viewState === "loading"}
          showStaleHint={viewState === "error_stale"}
          onSubmit={() => submit(username)}
        />
      )}

      {viewState === "error_invalid" && (
        <div className="mt-6 p-4 rounded-md bg-grade-f/8 border border-grade-f/25 text-grade-f text-sm">
          We couldn&apos;t find @{errorUsername} on Sleeper. Check the spelling and try again.{" "}
          <Link href="/demo" className="underline hover:no-underline">
            Or browse a demo league.
          </Link>
        </div>
      )}

      {viewState === "error_empty_leagues" && (
        <div className="mt-6 p-4 rounded-md bg-grade-c/8 border border-grade-c/25 text-grade-c text-sm">
          @{errorUsername} is on Sleeper but has no dynasty leagues this season.
          Dynasty DNA only supports true dynasty leagues (
          <code className="font-mono text-xs">settings.type === 2</code>). Keeper
          leagues aren&apos;t supported yet. In the meantime,{" "}
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
            onClick={() => submit(username)}
            className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {viewState === "error_rate_limited" && (
        <div className="mt-6 p-4 rounded-md bg-grade-c/8 border border-grade-c/25 text-grade-c text-sm">
          Too many requests. Try again in a minute.
        </div>
      )}

      {viewState === "error_db" && (
        <div className="mt-6 p-4 rounded-md bg-grade-f/8 border border-grade-f/25 text-grade-f text-sm">
          Something went wrong on our end. Try refreshing.
        </div>
      )}

      {viewState === "loading" && (
        <div className="mt-8 space-y-3" aria-label="Loading leagues">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-16 rounded-md bg-muted animate-pulse" />
          ))}
        </div>
      )}

      {viewState === "leagues" && response && (
        <LeaguesList
          username={response.username}
          leagues={response.leagues}
          onSwitchUser={handleSwitchUser}
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
  onSubmit,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  showStaleHint: boolean;
  onSubmit: () => void;
}) {
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
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
          autoComplete="username"
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
  onSwitchUser,
}: {
  username: string;
  leagues: FoundLeague[];
  onSwitchUser: () => void;
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
          onClick={onSwitchUser}
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
                <p className="text-xs text-muted-foreground font-mono">
                  {l.season}
                </p>
              </div>
              <Link
                href={`/league/${l.family_id}`}
                onClick={() =>
                  track("league_selected", {
                    family_id: l.family_id,
                    season: l.season,
                  })
                }
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
        <NotInDbList username={username} leagues={notInDb} />
      )}

      {notInDb.length > 0 && inDb.length === 0 && (
        <p className="text-sm text-muted-foreground pt-2">
          None of your leagues are supported yet.{" "}
          <Link href="/demo" className="text-primary hover:underline">
            Browse a demo league →
          </Link>
        </p>
      )}
    </div>
  );
}

function NotInDbList({
  username,
  leagues,
}: {
  username: string;
  leagues: FoundLeague[];
}) {
  const [openLeagueId, setOpenLeagueId] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [persisted, setPersisted] = useState<Set<string>>(() => new Set());
  const [justAdded, setJustAdded] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!username) return;
    const stored = getWaitlistedLeagues(username);
    if (stored.length > 0) setPersisted(new Set(stored));
  }, [username]);

  function handleOpen(leagueId: string) {
    setOpenLeagueId(leagueId);
    setError(null);
    track("waitlist_shown", { league_id: leagueId });
  }

  async function handleSubmit(league: FoundLeague) {
    setError(null);
    const trimmed = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError("Enter a valid email address.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: trimmed,
          league_id: league.league_id,
          league_name: league.name,
        }),
      });
      if (res.status === 429) {
        setError("Too many requests. Try again in a minute.");
        return;
      }
      if (!res.ok) {
        setError("Something went wrong. Try again.");
        return;
      }
      addWaitlistedLeague(username, league.league_id);
      setJustAdded((prev) => {
        const next = new Set(prev);
        next.add(league.league_id);
        return next;
      });
      setOpenLeagueId(null);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-xs uppercase tracking-wide text-muted-foreground font-mono">
        Not yet supported
      </p>
      {leagues.map((l) => {
        const isJustAdded = justAdded.has(l.league_id);
        const isPersisted = persisted.has(l.league_id) && !isJustAdded;
        const isOpen = openLeagueId === l.league_id;
        return (
          <div
            key={l.league_id}
            className="p-4 rounded-md border bg-card space-y-3"
          >
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="font-medium truncate">{l.name}</p>
                <p className="text-xs text-muted-foreground font-mono">
                  {l.season}
                </p>
              </div>
              {isPersisted ? (
                <span className="text-sm text-primary font-medium flex-shrink-0">
                  ✓ On waitlist
                </span>
              ) : isJustAdded ? null : isOpen ? null : (
                <button
                  type="button"
                  onClick={() => handleOpen(l.league_id)}
                  className="px-4 py-2 rounded-md border border-primary text-primary text-sm font-medium hover:bg-primary/10 transition-colors flex-shrink-0"
                >
                  Join waitlist
                </button>
              )}
            </div>
            {isOpen && !isJustAdded && !isPersisted && (
              <form
                className="space-y-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSubmit(l);
                }}
              >
                <div className="flex gap-2">
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={submitting}
                    placeholder="you@example.com"
                    aria-label="Email address"
                    autoComplete="email"
                    required
                    className="flex-1 px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
                  />
                  {/* Honeypot — hidden from users, bots fill it */}
                  <input
                    type="text"
                    name="hp"
                    tabIndex={-1}
                    autoComplete="off"
                    aria-hidden="true"
                    style={{
                      position: "absolute",
                      left: "-10000px",
                      width: "1px",
                      height: "1px",
                      opacity: 0,
                    }}
                  />
                  <button
                    type="submit"
                    disabled={submitting || !email.trim()}
                    className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 flex-shrink-0"
                  >
                    {submitting ? "Submitting..." : "Submit"}
                  </button>
                </div>
                {error && (
                  <p className="text-xs text-grade-f">{error}</p>
                )}
              </form>
            )}
            {isJustAdded && (
              <p className="text-sm text-primary font-medium">
                ✓ Added to waitlist — we&apos;ll email you when {l.name} is
                supported.
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
