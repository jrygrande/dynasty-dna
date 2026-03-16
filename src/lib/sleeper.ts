/**
 * Sleeper Fantasy Football API client with rate limiting.
 *
 * API docs: https://docs.sleeper.com/
 * Rate limit: 1000 requests/minute
 * Auth: None required (public, read-only)
 */

const BASE_URL = "https://api.sleeper.app/v1";

// Rate limiting: max 15 requests per second (~900/min, well under 1000 limit)
const MAX_RPS = 15;
const MIN_INTERVAL_MS = Math.ceil(1000 / MAX_RPS);
let lastRequestTime = 0;
const queue: Array<() => void> = [];
let processing = false;

async function processQueue() {
  if (processing) return;
  processing = true;
  while (queue.length > 0) {
    const now = Date.now();
    const elapsed = now - lastRequestTime;
    if (elapsed < MIN_INTERVAL_MS) {
      await new Promise((r) => setTimeout(r, MIN_INTERVAL_MS - elapsed));
    }
    lastRequestTime = Date.now();
    const next = queue.shift();
    next?.();
  }
  processing = false;
}

async function rateLimitedFetch(url: string): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    queue.push(async () => {
      try {
        const res = await fetchWithRetry(url);
        resolve(res);
      } catch (err) {
        reject(err);
      }
    });
    processQueue();
  });
}

async function fetchWithRetry(
  url: string,
  retries = 3,
  backoff = 1000
): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url);
    if (res.ok) return res;
    if (res.status === 429 || res.status >= 500) {
      if (attempt < retries) {
        await new Promise((r) =>
          setTimeout(r, backoff * Math.pow(2, attempt))
        );
        continue;
      }
    }
    throw new Error(`Sleeper API error: ${res.status} ${res.statusText} for ${url}`);
  }
  throw new Error(`Sleeper API: max retries exceeded for ${url}`);
}

async function get<T>(path: string): Promise<T> {
  const res = await rateLimitedFetch(`${BASE_URL}${path}`);
  return res.json();
}

// ---- Types ----

export interface SleeperUser {
  user_id: string;
  username: string;
  display_name: string;
  avatar: string | null;
}

export interface SleeperLeague {
  league_id: string;
  name: string;
  season: string;
  previous_league_id: string | null;
  status: string;
  settings: Record<string, unknown>;
  scoring_settings: Record<string, number>;
  roster_positions: string[];
  total_rosters: number;
  draft_id: string;
}

export interface SleeperRoster {
  roster_id: number;
  owner_id: string;
  players: string[] | null;
  starters: string[] | null;
  reserve: string[] | null;
  settings: {
    wins: number;
    losses: number;
    ties: number;
    fpts: number;
    fpts_decimal?: number;
    fpts_against?: number;
    fpts_against_decimal?: number;
  };
}

export interface SleeperLeagueUser {
  user_id: string;
  display_name: string;
  metadata?: {
    team_name?: string;
  };
  avatar: string | null;
}

export interface SleeperTransaction {
  transaction_id: string;
  type: string; // trade, waiver, free_agent, commissioner
  status: string;
  roster_ids: number[];
  adds: Record<string, number> | null; // { playerId: rosterId }
  drops: Record<string, number> | null;
  draft_picks: SleeperTradedPick[];
  leg: number; // week
  settings?: Record<string, unknown>;
  created: number; // timestamp ms
}

export interface SleeperTradedPick {
  season: string;
  round: number;
  roster_id: number; // original owner
  previous_owner_id: number;
  owner_id: number; // current owner
}

export interface SleeperDraft {
  draft_id: string;
  league_id: string;
  season: string;
  type: string;
  status: string;
  start_time: number;
  settings: Record<string, unknown>;
}

export interface SleeperDraftPick {
  round: number;
  pick_no: number;
  roster_id: number;
  player_id: string;
  is_keeper: boolean | null;
  metadata: Record<string, unknown>;
}

export interface SleeperMatchup {
  roster_id: number;
  matchup_id: number;
  points: number;
  starters: string[];
  starters_points: number[];
  players: string[];
  players_points: Record<string, number>;
}

export interface SleeperNFLState {
  season: number;
  week: number;
  season_type: string;
  display_week: number;
}

export type SleeperPlayerMap = Record<
  string,
  {
    player_id: string;
    gsis_id: string | null;
    full_name: string;
    first_name: string;
    last_name: string;
    position: string;
    team: string | null;
    age: number | null;
    status: string;
    injury_status: string | null;
    years_exp: number;
  }
>;

// ---- API Methods ----

export const Sleeper = {
  getUserByUsername: (username: string) =>
    get<SleeperUser>(`/user/${username}`),

  getUserById: (userId: string) =>
    get<SleeperUser>(`/user/${userId}`),

  getLeaguesByUser: (userId: string, season: string) =>
    get<SleeperLeague[]>(`/user/${userId}/leagues/nfl/${season}`),

  getLeague: (leagueId: string) =>
    get<SleeperLeague>(`/league/${leagueId}`),

  getRosters: (leagueId: string) =>
    get<SleeperRoster[]>(`/league/${leagueId}/rosters`),

  getLeagueUsers: (leagueId: string) =>
    get<SleeperLeagueUser[]>(`/league/${leagueId}/users`),

  getMatchups: (leagueId: string, week: number) =>
    get<SleeperMatchup[]>(`/league/${leagueId}/matchups/${week}`),

  getTransactions: (leagueId: string, week: number) =>
    get<SleeperTransaction[]>(`/league/${leagueId}/transactions/${week}`),

  getDrafts: (leagueId: string) =>
    get<SleeperDraft[]>(`/league/${leagueId}/drafts`),

  getDraftPicks: (draftId: string) =>
    get<SleeperDraftPick[]>(`/draft/${draftId}/picks`),

  getTradedPicks: (leagueId: string) =>
    get<SleeperTradedPick[]>(`/league/${leagueId}/traded_picks`),

  getPlayers: () => get<SleeperPlayerMap>(`/players/nfl`),

  getNFLState: () => get<SleeperNFLState>(`/state/nfl`),

  getWinnersBracket: (leagueId: string) =>
    get<unknown[]>(`/league/${leagueId}/winners_bracket`),
};
