import { Sleeper, SleeperUser } from '@/lib/sleeper';

export async function getUser(input: { username?: string; userId?: string }): Promise<SleeperUser> {
  if (input.userId) {
    // Sleeper has no direct getUserById on our client; reuse username path not possible.
    // Workaround: API supports /user/{user_id} as well.
    const u = await fetch(`https://api.sleeper.app/v1/user/${input.userId}`, { headers: { accept: 'application/json' }, cache: 'no-store' });
    if (!u.ok) throw new Error('User not found');
    return (await u.json()) as SleeperUser;
  }
  if (!input.username) throw new Error('username or userId required');
  return Sleeper.getUserByUsername(input.username);
}

export async function discoverDynastyLeaguesForUser(userId: string): Promise<string[]> {
  const state = await Sleeper.getState();
  const season = String(state.season ?? new Date().getFullYear());
  const currentLeagues = await Sleeper.getLeaguesByUser(userId, season);
  const visited = new Set<string>();
  const result: string[] = [];

  for (const lg of currentLeagues) {
    const startId: string = String(lg.league_id);
    // Walk back via previous_league_id
    let cursor: string | null | undefined = startId;
    while (cursor && !visited.has(cursor)) {
      visited.add(cursor);
      result.push(cursor);
      const data = await Sleeper.getLeague(cursor);
      cursor = data?.previous_league_id ?? null;
    }
  }

  return result;
}

