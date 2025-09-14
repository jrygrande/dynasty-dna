import { getDb, persistDb } from '@/db/index';
import { drafts, draftPicks, tradedPicks } from '@/db/schema';
import { and, eq, inArray, sql } from 'drizzle-orm';

export type NewDraft = {
  id: string;
  leagueId: string;
  season: string;
  settings?: unknown;
};

export async function upsertDrafts(rows: NewDraft[]) {
  if (!rows.length) return 0;
  const db = await getDb();
  const values = rows.map((d) => ({
    id: d.id,
    leagueId: d.leagueId,
    season: d.season,
    settings: (d.settings ?? null) as any,
  }));
  await db
    .insert(drafts)
    .values(values)
    .onConflictDoUpdate({
      target: drafts.id,
      set: {
        leagueId: sql`excluded.league_id`,
        season: sql`excluded.season`,
        settings: sql`excluded.settings`,
      },
    });
  await persistDb();
  return values.length;
}

export type NewDraftPick = {
  draftId: string;
  pickNo: number;
  round: number;
  rosterId?: number | null;
  playerId?: string | null;
  isKeeper?: boolean | null;
  tradedFromRosterId?: number | null;
};

export async function upsertDraftPicks(rows: NewDraftPick[]) {
  if (!rows.length) return 0;
  const db = await getDb();
  const values = rows.map((p) => ({
    draftId: p.draftId,
    pickNo: p.pickNo,
    round: p.round,
    rosterId: p.rosterId ?? null,
    playerId: p.playerId ?? null,
    isKeeper: Boolean(p.isKeeper ?? false),
    tradedFromRosterId: p.tradedFromRosterId ?? null,
  }));
  await db
    .insert(draftPicks)
    .values(values)
    .onConflictDoUpdate({
      target: [draftPicks.draftId, draftPicks.pickNo],
      set: {
        round: sql`excluded.round`,
        rosterId: sql`excluded.roster_id`,
        playerId: sql`excluded.player_id`,
        isKeeper: sql`excluded.is_keeper`,
        tradedFromRosterId: sql`excluded.traded_from_roster_id`,
      },
    });
  await persistDb();
  return values.length;
}

export type TradedPickRow = {
  leagueId: string;
  season: string;
  round: number;
  originalRosterId: number;
  currentOwnerId: string; // users.id
};

// Replace all traded picks for a league+season with provided rows (idempotent snapshot)
export async function replaceTradedPicks(leagueId: string, season: string, rows: TradedPickRow[]) {
  const db = await getDb();
  await db.delete(tradedPicks).where(and(eq(tradedPicks.leagueId, leagueId), eq(tradedPicks.season, season)));
  if (!rows.length) return 0;
  const values = rows.map((r) => ({
    leagueId: r.leagueId,
    season: r.season,
    round: r.round,
    originalRosterId: r.originalRosterId,
    currentOwnerId: r.currentOwnerId,
  }));
  await db.insert(tradedPicks).values(values);
  await persistDb();
  return values.length;
}
