import { Sleeper } from '@/lib/sleeper';
import { upsertPlayersBulk } from '@/repositories/players';
import { upsertNFLState } from '@/repositories/state';

export async function syncPlayers(): Promise<{ upserted: number }> {
  const dict = await Sleeper.getPlayers();
  const rows = Object.entries(dict).map(([id, p]: [string, any]) => ({
    id,
    name: p.full_name || p.first_name && p.last_name ? `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() : p.first_name || p.last_name || p?.metadata?.name || id,
    position: p.position ?? null,
    team: p.team ?? p.active_team ?? null,
    status: p.status ?? p.injury_status ?? null,
  }));
  const upserted = await upsertPlayersBulk(rows);
  return { upserted };
}

export async function syncNFLState(): Promise<{ season: string; week: number }> {
  const state = await Sleeper.getState();
  const season = String(state.season ?? new Date().getFullYear());
  const week = Number(state.week ?? 1);
  await upsertNFLState({ season, week });
  return { season, week };
}

