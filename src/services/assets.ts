import { Sleeper } from '@/lib/sleeper';
import { getDb } from '@/db/index';
import { leagues, rosters, drafts, draftPicks, transactions } from '@/db/schema';
import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { replaceAssetEventsForLeagues, NewAssetEvent } from '@/repositories/assetEvents';
import { upsertLeague } from '@/repositories/leagues';

export async function getLeagueFamily(rootLeagueId: string): Promise<string[]> {
  const db = await getDb();
  const family: string[] = [];
  let cursor: string | null = rootLeagueId;
  const visited = new Set<string>();
  while (cursor && !visited.has(cursor)) {
    visited.add(cursor);
    family.push(cursor);
    // find in DB
    const rowsForLeague = await db.select().from(leagues).where(eq(leagues.id, cursor)).limit(1);
    const row = rowsForLeague[0] as { id: string; previousLeagueId: string | null } | undefined;
    if (row?.previousLeagueId) {
      cursor = row.previousLeagueId;
      continue;
    }
    // if missing, fetch minimally and upsert, then continue
    try {
      const data = await Sleeper.getLeague(cursor);
      await upsertLeague({
        id: data.league_id ?? cursor,
        name: data.name ?? 'Unknown League',
        season: String(data.season ?? ''),
        previousLeagueId: data.previous_league_id ?? null,
        settings: data.settings ?? null,
      });
      cursor = data?.previous_league_id ?? null;
    } catch {
      cursor = null;
    }
  }
  return family;
}

export async function rebuildAssetEventsForLeagueFamily(rootLeagueId: string) {
  const db = await getDb();
  const leagueIds = await getLeagueFamily(rootLeagueId);

  // Build roster owner maps for each league
  const rosterOwnerMaps = new Map<string, Map<number, string>>();
  for (const lid of leagueIds) {
    const rows = await db.select().from(rosters).where(eq(rosters.leagueId, lid));
    const map = new Map<number, string>();
    for (const r of rows) map.set(r.rosterId, r.ownerId);
    rosterOwnerMaps.set(lid, map);
  }

  const events: NewAssetEvent[] = [];

  // League seasons map for backfilling season on events
  const leaguesRows = await db.select().from(leagues).where(inArray(leagues.id, leagueIds));
  const leagueSeasonById = new Map<string, string>();
  for (const lg of leaguesRows) leagueSeasonById.set(lg.id, String(lg.season));

  // Draft selections → player draft events + pick consumed events
  const draftsRows = await db.select().from(drafts).where(inArray(drafts.leagueId, leagueIds));
  for (const d of draftsRows) {
    const picks = await db.select().from(draftPicks).where(eq(draftPicks.draftId, d.id));
    const rosterMap = rosterOwnerMaps.get(d.leagueId) || new Map<number, string>();
    for (const p of picks) {
      if (p.playerId) {
        // Player drafted
        events.push({
          leagueId: d.leagueId,
          season: String(d.season),
          week: 0,
          eventTime: d.startTime ?? null,
          eventType: 'draft_selected',
          assetKind: 'player',
          playerId: p.playerId,
          fromUserId: null,
          toUserId: p.rosterId != null ? (rosterMap.get(p.rosterId) || null) : null,
          fromRosterId: null,
          toRosterId: p.rosterId ?? null,
          transactionId: null,
          details: { draftId: d.id, pickNo: p.pickNo, round: p.round },
        });
      }
      // Pick consumed (selected)
      const originalRosterId = p.tradedFromRosterId ?? p.rosterId ?? null;
      if (originalRosterId != null) {
        events.push({
          leagueId: d.leagueId,
          season: String(d.season),
          week: 0,
          eventTime: d.startTime ?? null,
          eventType: 'pick_selected',
          assetKind: 'pick',
          pickSeason: String(d.season),
          pickRound: p.round,
          pickOriginalRosterId: originalRosterId,
          fromUserId: null,
          toUserId: p.rosterId != null ? (rosterMap.get(p.rosterId) || null) : null,
          fromRosterId: null,
          toRosterId: p.rosterId ?? null,
          transactionId: null,
          details: { draftId: d.id, pickNo: p.pickNo, playerId: p.playerId ?? null },
        });
      }
    }
  }

  // Transactions → player and pick movements
  const txs = await db.select().from(transactions).where(inArray(transactions.leagueId, leagueIds));
  for (const t of txs) {
    const rosterMap = rosterOwnerMaps.get(t.leagueId) || new Map<number, string>();
    const seasonForLeague = leagueSeasonById.get(t.leagueId) || null;
    const payload: any = t.payload || {};
    const week = t.week ?? null;
    const toSafeDate = (v: any): Date | null => {
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) return null;
      // Accept either seconds or milliseconds epoch
      const ms = n > 1e12 ? n : n * 1000;
      // guard plausible range: 2000-01-01 .. 2100-01-01
      const min = Date.UTC(2000, 0, 1);
      const max = Date.UTC(2100, 0, 1);
      if (ms < min || ms > max) return null;
      return new Date(ms);
    };
    const eventTime = toSafeDate(payload?.status_updated) || toSafeDate(payload?.created) || null;
    // Adds and drops
    const adds = payload.adds || {};
    const drops = payload.drops || {};
    for (const [playerId, rosterIdRaw] of Object.entries(adds)) {
      const toRosterId = Number(rosterIdRaw);
      events.push({
        leagueId: t.leagueId,
        season: seasonForLeague,
        week,
        eventTime,
        eventType: t.type === 'waiver' ? 'waiver_add' : t.type === 'free_agent' ? 'free_agent_add' : 'add',
        assetKind: 'player',
        playerId,
        fromUserId: null,
        toUserId: rosterMap.get(toRosterId) || null,
        fromRosterId: null,
        toRosterId,
        transactionId: t.id,
        details: { type: t.type },
      });
    }
    for (const [playerId, rosterIdRaw] of Object.entries(drops)) {
      const fromRosterId = Number(rosterIdRaw);
      events.push({
        leagueId: t.leagueId,
        season: seasonForLeague,
        week,
        eventTime,
        eventType: t.type === 'waiver' ? 'waiver_drop' : t.type === 'free_agent' ? 'free_agent_drop' : 'drop',
        assetKind: 'player',
        playerId,
        fromUserId: rosterMap.get(fromRosterId) || null,
        toUserId: null,
        fromRosterId,
        toRosterId: null,
        transactionId: t.id,
        details: { type: t.type },
      });
    }
    // Trades and pick trades
    if (t.type === 'trade') {
      // players traded are represented via adds/drops above; also add explicit trade events linking both sides
      const rostersInvolved: number[] = Array.from(new Set([...Object.values(adds), ...Object.values(drops)].map((v: any) => Number(v)).filter((n) => !Number.isNaN(n))));
      for (const pid of Object.keys(adds)) {
        // find from roster for this player by looking at drops for same player if present
        const toRosterId = Number((adds as any)[pid]);
        const fromRosterId = drops[pid] != null ? Number(drops[pid]) : null;
        events.push({
          leagueId: t.leagueId,
          season: seasonForLeague,
          week,
          eventTime,
          eventType: 'trade',
          assetKind: 'player',
          playerId: pid,
          fromUserId: fromRosterId != null ? (rosterMap.get(fromRosterId) || null) : null,
          toUserId: rosterMap.get(toRosterId) || null,
          fromRosterId: fromRosterId,
          toRosterId: toRosterId,
          transactionId: t.id,
          details: { type: t.type },
        });
      }
      // draft_picks array
      const dp: any[] = Array.isArray(payload.draft_picks) ? payload.draft_picks : [];
      for (const pr of dp) {
        const pickSeason = String(pr.season ?? '');
        const pickRound = Number(pr.round ?? 0);
        const originalRosterId = Number(pr.roster_id ?? pr.roster ?? 0);
        // Sleeper may include owner_id and previous_owner_id as roster ids or user ids depending on context
        let fromUserId: string | null = null;
        let toUserId: string | null = null;
        if (typeof pr.previous_owner_id === 'string') fromUserId = pr.previous_owner_id;
        if (typeof pr.owner_id === 'string') toUserId = pr.owner_id;
        if (!fromUserId && typeof pr.previous_owner_id === 'number') fromUserId = rosterMap.get(Number(pr.previous_owner_id)) || null;
        if (!toUserId && typeof pr.owner_id === 'number') toUserId = rosterMap.get(Number(pr.owner_id)) || null;
        events.push({
          leagueId: t.leagueId,
          season: pickSeason,
          week,
          eventTime,
          eventType: 'pick_trade',
          assetKind: 'pick',
          pickSeason,
          pickRound,
          pickOriginalRosterId: originalRosterId || null,
          fromUserId,
          toUserId,
          fromRosterId: null,
          toRosterId: null,
          transactionId: t.id,
          details: { type: t.type },
        });
      }
    }
  }

  await replaceAssetEventsForLeagues(leagueIds, events);
  return { leagues: leagueIds.length, events: events.length };
}
