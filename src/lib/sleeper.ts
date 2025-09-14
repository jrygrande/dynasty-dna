const BASE = 'https://api.sleeper.app/v1';

// Simple in-process rate limiter and retry with exponential backoff
const RATE_PER_MIN = Number(process.env.SLEEPER_RATE_LIMIT_PER_MIN || 600); // ~10 rps
const MIN_INTERVAL_MS = Math.max(1, Math.floor(60000 / RATE_PER_MIN));
let lastCall = 0;
let queue = Promise.resolve();

async function schedule() {
  const now = Date.now();
  const wait = Math.max(0, MIN_INTERVAL_MS - (now - lastCall));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
}

async function get<T>(path: string, init?: RequestInit): Promise<T> {
  queue = queue.then(schedule);
  await queue;
  const url = `${BASE}${path}`;
  let attempt = 0;
  const max = 5;
  let lastErr: any;
  while (attempt < max) {
    attempt++;
    try {
      const res = await fetch(url, {
        ...init,
        headers: {
          accept: 'application/json',
          ...(init?.headers || {}),
        },
        cache: 'no-store',
      });
      if (res.status === 429 || res.status >= 500) {
        throw new Error(`retryable:${res.status}`);
      }
      if (!res.ok) throw new Error(`Sleeper GET ${path} failed: ${res.status}`);
      return (await res.json()) as T;
    } catch (e: any) {
      lastErr = e;
      const isRetry = String(e?.message || '').startsWith('retryable:');
      if (!isRetry && attempt >= max) break;
      const backoff = Math.min(2000 * 2 ** (attempt - 1), 15000);
      await new Promise((r) => setTimeout(r, backoff + Math.floor(Math.random() * 250)));
    }
  }
  throw lastErr || new Error(`Sleeper GET ${path} failed`);
}

export type SleeperUser = { user_id: string; username: string; display_name?: string };

export const Sleeper = {
  getUserByUsername: (username: string) => get<SleeperUser>(`/user/${encodeURIComponent(username)}`),
  getLeaguesByUser: (userId: string, season: string) => get<any[]>(`/user/${userId}/leagues/nfl/${season}`),
  getLeague: (leagueId: string) => get<any>(`/league/${leagueId}`),
  getLeagueRosters: (leagueId: string) => get<any[]>(`/league/${leagueId}/rosters`),
  getLeagueUsers: (leagueId: string) => get<any[]>(`/league/${leagueId}/users`),
  getLeagueMatchups: (leagueId: string, week: number) => get<any[]>(`/league/${leagueId}/matchups/${week}`),
  getTransactions: (leagueId: string, week: number) => get<any[]>(`/league/${leagueId}/transactions/${week}`),
  getDrafts: (leagueId: string) => get<any[]>(`/league/${leagueId}/drafts`),
  getDraftPicks: (draftId: string) => get<any[]>(`/draft/${draftId}/picks`),
  getTradedPicks: (leagueId: string) => get<any[]>(`/league/${leagueId}/traded_picks`),
  getPlayers: () => get<Record<string, any>>(`/players/nfl`),
  getState: () => get<any>(`/state/nfl`),
};
