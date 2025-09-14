import { getDb, persistDb } from '@/db/index';
import { assetEvents } from '@/db/schema';
import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';

export type NewAssetEvent = {
  leagueId: string;
  season?: string | null;
  week?: number | null;
  eventTime?: Date | null;
  eventType: string;
  assetKind: 'player' | 'pick';
  playerId?: string | null;
  pickSeason?: string | null;
  pickRound?: number | null;
  pickOriginalRosterId?: number | null;
  fromUserId?: string | null;
  toUserId?: string | null;
  fromRosterId?: number | null;
  toRosterId?: number | null;
  transactionId?: string | null;
  details?: unknown;
};

export async function replaceAssetEventsForLeagues(leagueIds: string[], rows: NewAssetEvent[]) {
  if (!leagueIds.length) return 0;
  const db = await getDb();
  await db.delete(assetEvents).where(inArray(assetEvents.leagueId, leagueIds));
  if (!rows.length) return 0;
  const values = rows.map((e) => ({
    leagueId: e.leagueId,
    season: e.season ?? null,
    week: e.week ?? null,
    eventTime: e.eventTime ?? null,
    eventType: e.eventType,
    assetKind: e.assetKind,
    playerId: e.playerId ?? null,
    pickSeason: e.pickSeason ?? null,
    pickRound: e.pickRound ?? null,
    pickOriginalRosterId: e.pickOriginalRosterId ?? null,
    fromUserId: e.fromUserId ?? null,
    toUserId: e.toUserId ?? null,
    fromRosterId: e.fromRosterId ?? null,
    toRosterId: e.toRosterId ?? null,
    transactionId: e.transactionId ?? null,
    details: (e.details ?? null) as any,
  }));
  await db.insert(assetEvents).values(values);
  await persistDb();
  return values.length;
}

export async function getPlayerTimeline(leagueIds: string[], playerId: string) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(assetEvents)
    .where(
      and(
        inArray(assetEvents.leagueId, leagueIds),
        eq(assetEvents.assetKind, 'player'),
        eq(assetEvents.playerId, playerId)
      )
    )
    .orderBy(assetEvents.season, assetEvents.week, assetEvents.eventTime);
  return rows;
}

export async function getPickTimeline(leagueIds: string[], season: string, round: number, originalRosterId: number) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(assetEvents)
    .where(
      and(
        inArray(assetEvents.leagueId, leagueIds),
        eq(assetEvents.assetKind, 'pick'),
        eq(assetEvents.pickSeason, season),
        eq(assetEvents.pickRound, round),
        eq(assetEvents.pickOriginalRosterId, originalRosterId)
      )
    )
    .orderBy(assetEvents.season, assetEvents.week, assetEvents.eventTime);
  return rows;
}

