import { getDb, persistDb } from '@/db/index';
import { assetEvents } from '@/db/schema';
import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';

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
  const CHUNK = 400; // keep payloads small for Neon HTTP limits
  let total = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK).map((e) => ({
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
    await db.insert(assetEvents).values(slice);
    total += slice.length;
  }
  await persistDb();
  return total;
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

export async function topPlayersByEventCount(leagueIds: string[], limit = 5) {
  const db = await getDb();
  const rows = await db
    .select({ playerId: assetEvents.playerId, c: sql<number>`count(*)` })
    .from(assetEvents)
    .where(and(inArray(assetEvents.leagueId, leagueIds), eq(assetEvents.assetKind, 'player'), isNotNull(assetEvents.playerId)))
    .groupBy(assetEvents.playerId)
    .orderBy(desc(sql`count(*)`))
    .limit(limit);
  return rows.filter((r) => r.playerId);
}

export async function topPicksByEventCount(leagueIds: string[], limit = 5) {
  const db = await getDb();
  const rows = await db
    .select({
      pickSeason: assetEvents.pickSeason,
      pickRound: assetEvents.pickRound,
      pickOriginalRosterId: assetEvents.pickOriginalRosterId,
      c: sql<number>`count(*)`,
    })
    .from(assetEvents)
    .where(
      and(
        inArray(assetEvents.leagueId, leagueIds),
        eq(assetEvents.assetKind, 'pick'),
        isNotNull(assetEvents.pickSeason),
        isNotNull(assetEvents.pickRound),
        isNotNull(assetEvents.pickOriginalRosterId)
      )
    )
    .groupBy(assetEvents.pickSeason, assetEvents.pickRound, assetEvents.pickOriginalRosterId)
    .orderBy(desc(sql`count(*)`))
    .limit(limit);
  return rows;
}

export async function getAssetsInTransaction(transactionId: string) {
  if (!transactionId) return [];

  const db = await getDb();
  const rows = await db
    .select()
    .from(assetEvents)
    .where(eq(assetEvents.transactionId, transactionId))
    .orderBy(assetEvents.assetKind, assetEvents.playerId, assetEvents.pickSeason, assetEvents.pickRound);

  return rows;
}
