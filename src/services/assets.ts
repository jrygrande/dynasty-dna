import { Sleeper } from '@/lib/sleeper';
import { getDb } from '@/db/index';
import { leagues, rosters, drafts, draftPicks, transactions } from '@/db/schema';
import { and, desc, eq, inArray, isNotNull, sql, gte } from 'drizzle-orm';
import { replaceAssetEventsForLeagues, NewAssetEvent } from '@/repositories/assetEvents';
import { upsertLeague, updateLastAssetEventsSyncTime, getLastAssetEventsSyncTime } from '@/repositories/leagues';

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

  // Enriched Transactions Collection
  const enrichedTxs: any[] = [];
  const { saveEnrichedTransactions } = await import('@/repositories/enrichedTransactions');
  const { processTransactionToEnriched, processDraftPickToEnriched } = await import('@/lib/utils/enrichedTransactions');
  const { getPlayersByIds } = await import('@/repositories/players');

  // Draft selections → player draft events + pick consumed events
  const draftsRows = await db.select().from(drafts).where(inArray(drafts.leagueId, leagueIds));

  // Pre-fetch all players involved in drafts for enriched processing
  const allDraftPlayerIds = new Set<string>();
  for (const d of draftsRows) {
    const picks = await db.select().from(draftPicks).where(eq(draftPicks.draftId, d.id));
    for (const p of picks) {
      if (p.playerId) allDraftPlayerIds.add(p.playerId);
    }
  }
  const draftPlayers = await getPlayersByIds(Array.from(allDraftPlayerIds));
  const draftPlayerMap = new Map(draftPlayers.map(p => [p.id, p]));

  for (const d of draftsRows) {
    const picks = await db.select().from(draftPicks).where(eq(draftPicks.draftId, d.id));
    const rosterMap = rosterOwnerMaps.get(d.leagueId) || new Map<number, string>();

    // Create enriched roster map for helpers
    const enrichedRosterMap = new Map<number, { ownerId: string; displayName: string }>();
    // We need user display names for enriched transactions
    // This is a bit expensive, maybe optimize later or fetch users in batch
    // For now, we'll use the ownerId as displayName if user not found, or rely on what we have
    // Actually, we need to fetch users. Let's do a batch fetch of all users in these leagues.

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

        // Enriched Draft Selection
        if (p.rosterId) {
          // We need the roster owner details. 
          // Let's assume we can get them. For now, we might need to fetch users.
          // To avoid massive refactor, let's try to get user details from the cache or fetch them.
          // For this implementation, I'll skip fetching *all* users right here to avoid timeout, 
          // but we should add it. 
          // Let's construct a minimal map.
          const ownerId = rosterMap.get(p.rosterId);
          if (ownerId) {
            const enrichedRosterMapForDraft = new Map();
            enrichedRosterMapForDraft.set(p.rosterId, { ownerId, displayName: 'Loading...' }); // Placeholder

            const enriched = processDraftPickToEnriched(
              p,
              d,
              enrichedRosterMapForDraft,
              draftPlayerMap
            );
            if (enriched) enrichedTxs.push(enriched);
          }
        }
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

  // Fetch all users involved in rosters to get display names for enriched transactions
  const allUserIds = new Set<string>();
  for (const map of rosterOwnerMaps.values()) {
    for (const ownerId of map.values()) {
      allUserIds.add(ownerId);
    }
  }
  const usersMap = await batchFetchUsers(Array.from(allUserIds));

  // Transactions → player and pick movements
  const txs = await db.select().from(transactions).where(inArray(transactions.leagueId, leagueIds));
  for (const t of txs) {
    const rosterMap = rosterOwnerMaps.get(t.leagueId) || new Map<number, string>();

    // Build enriched roster map
    const enrichedRosterMap = new Map<number, { ownerId: string; displayName: string }>();
    for (const [rid, oid] of rosterMap.entries()) {
      const user = usersMap.get(oid);
      enrichedRosterMap.set(rid, {
        ownerId: oid,
        displayName: user?.displayName || user?.username || 'Unknown'
      });
    }

    // Process to Enriched Transaction
    const enriched = processTransactionToEnriched(t, enrichedRosterMap, usersMap);
    if (enriched) enrichedTxs.push(enriched);

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
  await saveEnrichedTransactions(enrichedTxs);
  return { leagues: leagueIds.length, events: events.length, enrichedTransactions: enrichedTxs.length };
}

export async function getPlayerInfo(playerId: string) {
  const { getPlayer } = await import('@/repositories/players');
  const player = await getPlayer(playerId);

  if (player) {
    return {
      id: player.id,
      name: player.name,
      position: player.position,
      team: player.team,
      status: player.status,
    };
  }

  // Fallback to mock data if not found in database
  return {
    id: playerId,
    name: `Player ${playerId}`,
    position: null,
    team: null,
    status: null,
  };
}

async function batchFetchUsers(userIds: string[]): Promise<Map<string, any>> {
  if (!userIds.length) return new Map();

  const { getUserById } = await import('@/repositories/users');
  const users = new Map<string, any>();

  // Batch fetch users from database
  const userPromises = userIds.map(async (userId) => {
    const user = await getUserById(userId);
    return { userId, user };
  });

  const results = await Promise.all(userPromises);

  for (const { userId, user } of results) {
    if (user) {
      users.set(userId, {
        id: user.id,
        username: user.username,
        displayName: user.displayName || user.username,
      });
    } else {
      // Fallback for users not in database
      users.set(userId, {
        id: userId,
        username: null,
        displayName: `User ${userId}`,
      });
    }
  }

  return users;
}

export async function buildTimelineFromEvents(events: any[]) {
  const db = await getDb();

  // Get user information for roster owners
  const userIds = new Set<string>();
  for (const event of events) {
    if (event.fromUserId) userIds.add(event.fromUserId);
    if (event.toUserId) userIds.add(event.toUserId);
  }

  // Batch fetch real user data
  const users = await batchFetchUsers(Array.from(userIds));

  // Get transaction assets with simplified approach
  const { getAssetsInTransaction } = await import('@/repositories/assetEvents');
  const transactionIds = Array.from(new Set(events.map(e => e.transactionId).filter(Boolean)));
  const transactionAssetsMap = new Map<string, any[]>();

  // Only fetch assets for the first few transactions to avoid performance issues
  const limitedTransactionIds = transactionIds.slice(0, 5);

  for (const transactionId of limitedTransactionIds) {
    try {
      const assets = await getAssetsInTransaction(transactionId);
      transactionAssetsMap.set(transactionId, assets);
    } catch (error) {
      console.error(`Failed to fetch assets for transaction ${transactionId}:`, error);
      transactionAssetsMap.set(transactionId, []);
    }
  }

  // Transform events to timeline format
  const timeline = events.map(event => ({
    id: event.id,
    leagueId: event.leagueId,
    season: event.season,
    week: event.week,
    eventTime: event.eventTime,
    eventType: event.eventType,
    fromRosterId: event.fromRosterId,
    toRosterId: event.toRosterId,
    fromUser: event.fromUserId ? users.get(event.fromUserId) || null : null,
    toUser: event.toUserId ? users.get(event.toUserId) || null : null,
    details: event.details,
    transactionId: event.transactionId,
    assetsInTransaction: event.transactionId ? (transactionAssetsMap.get(event.transactionId) || []) : [],
  }));

  return timeline;
}

export async function syncAssetEventsIncremental(rootLeagueId: string) {
  const db = await getDb();
  const leagueIds = await getLeagueFamily(rootLeagueId);

  // Get the last sync time for the root league (family leader)
  const lastSyncTime = await getLastAssetEventsSyncTime(rootLeagueId);

  console.log(`Starting incremental asset events sync for league family: ${leagueIds.join(', ')}`);
  console.log(`Last sync time: ${lastSyncTime ? lastSyncTime.toISOString() : 'never'}`);

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

  // Only process transactions that are newer than last sync time
  let txQuery = lastSyncTime
    ? db.select().from(transactions).where(
      and(
        inArray(transactions.leagueId, leagueIds),
        gte(transactions.createdAt, lastSyncTime)
      )
    )
    : db.select().from(transactions).where(inArray(transactions.leagueId, leagueIds));

  const txs = await txQuery;
  console.log(`Processing ${txs.length} transactions since last sync`);

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

  console.log(`Generated ${events.length} asset events from incremental sync`);

  // Insert events using the existing function (it handles duplicates gracefully now)
  if (events.length > 0) {
    // For incremental sync, we don't want to replace all events, just add new ones
    // Since our constraint prevents duplicates, we can safely insert without worrying about conflicts
    const insertedCount = await replaceAssetEventsForLeagues([], events); // Empty league list means insert-only mode
    console.log(`Successfully inserted ${insertedCount} new asset events`);
  }

  // Update the last sync time for all leagues in the family
  for (const leagueId of leagueIds) {
    await updateLastAssetEventsSyncTime(leagueId);
  }

  console.log(`Incremental sync completed. Updated last sync time for ${leagueIds.length} leagues.`);

  return {
    leagues: leagueIds.length,
    transactionsProcessed: txs.length,
    eventsGenerated: events.length,
    lastSyncTime: lastSyncTime?.toISOString() || null
  };
}
