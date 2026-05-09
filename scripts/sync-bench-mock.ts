/**
 * Synthetic Sleeper mock for the sync benchmark.
 *
 * Patches the `Sleeper` API client object (a const export with mutable
 * properties — see src/lib/sleeper.ts) with deterministic in-memory shims so
 * the benchmark exercises the REAL syncLeagueFamily/syncLeague code path
 * without any network traffic. Generates an N-season family chain via
 * `previous_league_id`.
 *
 * No recorded JSON. No fixtures on disk. The synthetic data is intentionally
 * small (12 rosters, 1 trade per season, 1 waiver per season, 18 weeks of
 * matchups) — this is a smoke benchmark, not a load test.
 *
 * Why we DON'T mock the heavy downstream services (playerSync,
 * fantasyCalcSync, lineup/trade/draft/waiver grading): tsx loads `.ts` files
 * with sealed ESM exports, so namespace-import getters are non-configurable.
 * Instead we keep `familyId` undefined when calling syncLeagueFamily, which
 * already short-circuits the nflverse + grading paths in src/services/sync.ts.
 * `syncPlayers` runs against an empty mock player map (no network), and
 * `syncFantasyCalcValues` bails when the leagueId isn't in the DB yet (no
 * network). The cost of those DB-only paths IS part of the benchmark — that's
 * intentional, since they live in the cold-sync critical path.
 *
 * Usage (from the benchmark script):
 *
 *   import { installSleeperMock, getMockStats } from "./sync-bench-mock";
 *   const { leagueIds, uninstall } = installSleeperMock({ seasons: 5 });
 *   await syncLeagueFamily(leagueIds);
 *   const stats = getMockStats();
 *   uninstall();
 */

import { Sleeper } from "@/lib/sleeper";

const REGULAR_WEEKS = 18;
const ROSTER_COUNT = 12;

export interface MockOptions {
  /** How many seasons in the family chain (default 5). */
  seasons?: number;
  /** Per-call latency in ms (deterministic; default 50). 0 disables. */
  latencyMs?: number;
  /** Stable prefix for league/draft IDs (default `bench`). */
  idPrefix?: string;
  /** Mark the most recent season as in-progress instead of complete. */
  inProgressTail?: boolean;
}

export interface MockStats {
  apiCalls: number;
  callsByEndpoint: Record<string, number>;
  peakConcurrency: number;
  currentInFlight: number;
}

const stats: MockStats = {
  apiCalls: 0,
  callsByEndpoint: {},
  peakConcurrency: 0,
  currentInFlight: 0,
};

export function getMockStats(): MockStats {
  return {
    apiCalls: stats.apiCalls,
    callsByEndpoint: { ...stats.callsByEndpoint },
    peakConcurrency: stats.peakConcurrency,
    currentInFlight: stats.currentInFlight,
  };
}

export function resetMockStats(): void {
  stats.apiCalls = 0;
  stats.callsByEndpoint = {};
  stats.peakConcurrency = 0;
  stats.currentInFlight = 0;
}

async function track<T>(
  endpoint: string,
  latencyMs: number,
  body: () => T | Promise<T>,
): Promise<T> {
  stats.apiCalls += 1;
  stats.callsByEndpoint[endpoint] = (stats.callsByEndpoint[endpoint] ?? 0) + 1;
  stats.currentInFlight += 1;
  if (stats.currentInFlight > stats.peakConcurrency) {
    stats.peakConcurrency = stats.currentInFlight;
  }
  try {
    if (latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, latencyMs));
    }
    return await body();
  } finally {
    stats.currentInFlight -= 1;
  }
}

interface ChainLeague {
  league_id: string;
  draft_id: string;
  season: string;
  previous_league_id: string | null;
  status: "complete" | "in_season";
}

function buildChain(
  seasons: number,
  idPrefix: string,
  inProgressTail: boolean,
): ChainLeague[] {
  // Oldest -> newest. previous_league_id of season N points to N-1.
  const startSeason = 2026 - seasons + 1;
  const chain: ChainLeague[] = [];
  for (let i = 0; i < seasons; i++) {
    const yr = startSeason + i;
    const isLast = i === seasons - 1;
    chain.push({
      league_id: `${idPrefix}_L${i + 1}`,
      draft_id: `${idPrefix}_D${i + 1}`,
      season: String(yr),
      previous_league_id: i === 0 ? null : `${idPrefix}_L${i}`,
      status: isLast && inProgressTail ? "in_season" : "complete",
    });
  }
  return chain;
}

export interface InstallResult {
  leagueIds: string[];
  chain: ChainLeague[];
  uninstall: () => void;
}

/**
 * Patch Sleeper.* with synthetic implementations. Returns the league IDs
 * (oldest -> newest) and an `uninstall` to restore originals.
 */
export function installSleeperMock(opts: MockOptions = {}): InstallResult {
  const seasons = opts.seasons ?? 5;
  const latencyMs = opts.latencyMs ?? 50;
  const idPrefix = opts.idPrefix ?? "bench";
  const inProgressTail = opts.inProgressTail ?? false;

  const chain = buildChain(seasons, idPrefix, inProgressTail);
  const byId = new Map(chain.map((c) => [c.league_id, c]));

  resetMockStats();

  // Snapshot originals so callers can uninstall.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sleeperOriginals: Record<string, any> = {};
  for (const key of Object.keys(Sleeper)) {
    sleeperOriginals[key] = (Sleeper as Record<string, unknown>)[key];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const S = Sleeper as any;

  S.getLeague = (leagueId: string) =>
    track(`/league/{id}`, latencyMs, () => {
      const league = byId.get(leagueId);
      if (!league) throw new Error(`mock: unknown league ${leagueId}`);
      return {
        league_id: league.league_id,
        name: `Bench League ${league.season}`,
        season: league.season,
        previous_league_id: league.previous_league_id,
        status: league.status,
        settings: { playoff_week_start: 15 },
        scoring_settings: { rec: 1 },
        roster_positions: ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "BN"],
        total_rosters: ROSTER_COUNT,
        draft_id: league.draft_id,
      };
    });

  S.getLeagueUsers = (_leagueId: string) =>
    track(`/league/{id}/users`, latencyMs, () =>
      Array.from({ length: ROSTER_COUNT }, (_, i) => ({
        user_id: `${idPrefix}_u${i + 1}`,
        display_name: `User ${i + 1}`,
        metadata: { team_name: `Team ${i + 1}` },
        avatar: null,
      })),
    );

  S.getRosters = (_leagueId: string) =>
    track(`/league/{id}/rosters`, latencyMs, () =>
      Array.from({ length: ROSTER_COUNT }, (_, i) => {
        const rosterId = i + 1;
        return {
          roster_id: rosterId,
          owner_id: `${idPrefix}_u${rosterId}`,
          players: [`${idPrefix}_p${rosterId}_a`, `${idPrefix}_p${rosterId}_b`],
          starters: [`${idPrefix}_p${rosterId}_a`],
          reserve: [],
          settings: {
            wins: rosterId % 14,
            losses: 14 - (rosterId % 14),
            ties: 0,
            fpts: 1500 + rosterId,
            fpts_decimal: 0,
          },
        };
      }),
    );

  S.getDrafts = (leagueId: string) =>
    track(`/league/{id}/drafts`, latencyMs, () => {
      const league = byId.get(leagueId);
      if (!league) return [];
      return [
        {
          draft_id: league.draft_id,
          league_id: league.league_id,
          season: league.season,
          type: "snake",
          status: "complete",
          start_time: 1_700_000_000_000,
          settings: {},
          slot_to_roster_id: Object.fromEntries(
            Array.from({ length: ROSTER_COUNT }, (_, i) => [String(i + 1), i + 1]),
          ),
        },
      ];
    });

  S.getDraftPicks = (_draftId: string) =>
    track(`/draft/{id}/picks`, latencyMs, () =>
      Array.from({ length: ROSTER_COUNT }, (_, i) => ({
        round: 1,
        pick_no: i + 1,
        draft_slot: i + 1,
        roster_id: i + 1,
        player_id: `${idPrefix}_p${i + 1}_a`,
        is_keeper: null,
        metadata: {},
      })),
    );

  S.getTradedPicks = (leagueId: string) =>
    track(`/league/{id}/traded_picks`, latencyMs, () => [
      {
        season: String(parseInt(byId.get(leagueId)?.season ?? "2025", 10) + 1),
        round: 1,
        roster_id: 1,
        previous_owner_id: 1,
        owner_id: 2,
      },
    ]);

  S.getTransactions = (leagueId: string, week: number) =>
    track(`/league/{id}/transactions/{week}`, latencyMs, () => {
      // Sparse data: ~1 trade in week 4, a waiver in week 7. Keeps DB writes
      // realistic without ballooning the synthetic fixture.
      if (week === 4) {
        return [
          {
            transaction_id: `${leagueId}_tx_w4`,
            type: "trade",
            status: "complete",
            roster_ids: [1, 2],
            adds: { [`${idPrefix}_p1_a`]: 2 },
            drops: { [`${idPrefix}_p2_a`]: 1 },
            draft_picks: [],
            leg: week,
            settings: {},
            created: 1_700_000_001_000 + week,
          },
        ];
      }
      if (week === 7) {
        return [
          {
            transaction_id: `${leagueId}_tx_w7`,
            type: "waiver",
            status: "complete",
            roster_ids: [3],
            adds: { [`${idPrefix}_p3_b`]: 3 },
            drops: null,
            draft_picks: [],
            leg: week,
            settings: { waiver_bid: 5 },
            created: 1_700_000_002_000 + week,
          },
        ];
      }
      return [];
    });

  S.getMatchups = (_leagueId: string, week: number) =>
    track(`/league/{id}/matchups/{week}`, latencyMs, () => {
      if (week < 1 || week > REGULAR_WEEKS) return [];
      return Array.from({ length: ROSTER_COUNT }, (_, i) => {
        const rosterId = i + 1;
        const matchupId = Math.ceil(rosterId / 2);
        return {
          roster_id: rosterId,
          matchup_id: matchupId,
          points: 100 + week + rosterId,
          starters: [`${idPrefix}_p${rosterId}_a`],
          starters_points: [10 + week],
          players: [`${idPrefix}_p${rosterId}_a`, `${idPrefix}_p${rosterId}_b`],
          players_points: {
            [`${idPrefix}_p${rosterId}_a`]: 10 + week,
            [`${idPrefix}_p${rosterId}_b`]: 5,
          },
        };
      });
    });

  S.getWinnersBracket = (_leagueId: string) =>
    track(`/league/{id}/winners_bracket`, latencyMs, () => [
      { r: 1, m: 1, t1: 1, t2: 2, w: 1, l: 2 },
    ]);

  // Auxiliary endpoints — only `getPlayers` is in the cold-sync path (called
  // by syncPlayers). The others exist so any caller that happens to invoke
  // them gets a valid empty shape rather than hitting Sleeper.
  S.getPlayers = () => track(`/players/nfl`, latencyMs, () => ({}));
  S.getNFLState = () =>
    track(`/state/nfl`, latencyMs, () => ({
      season: 2025,
      week: 1,
      season_type: "regular",
      display_week: 1,
    }));
  S.getUserByUsername = (u: string) =>
    track(`/user/{username}`, latencyMs, () => ({
      user_id: u,
      username: u,
      display_name: u,
      avatar: null,
    }));
  S.getUserById = (u: string) =>
    track(`/user/{id}`, latencyMs, () => ({
      user_id: u,
      username: u,
      display_name: u,
      avatar: null,
    }));
  S.getLeaguesByUser = () => track(`/user/{id}/leagues`, latencyMs, () => []);

  const uninstall = () => {
    for (const key of Object.keys(sleeperOriginals)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (Sleeper as any)[key] = sleeperOriginals[key];
    }
  };

  return {
    leagueIds: chain.map((c) => c.league_id),
    chain,
    uninstall,
  };
}
