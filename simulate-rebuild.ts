#!/usr/bin/env npx tsx

import { config } from 'dotenv';
config(); // Load environment variables from .env file

import { getDb } from './src/db';
import { transactions, rosters, leagues } from './src/db/schema';
import { inArray, eq } from 'drizzle-orm';
import { NewAssetEvent } from './src/repositories/assetEvents';

async function simulateRebuild() {
  const db = await getDb();

  // Use the same logic as rebuildAssetEventsForLeagueFamily but without actually saving
  const leagueIds = ['1051592789462589440', '926647116724891648', '784554710463127552', '716048884559835136'];

  console.log('=== Simulating rebuildAssetEventsForLeagueFamily ===\n');

  // Build roster owner maps for each league
  const rosterOwnerMaps = new Map<string, Map<number, string>>();
  for (const lid of leagueIds) {
    const rows = await db.select().from(rosters).where(eq(rosters.leagueId, lid));
    const map = new Map<number, string>();
    for (const r of rows) map.set(r.rosterId, r.ownerId);
    rosterOwnerMaps.set(lid, map);
    console.log(`League ${lid}: ${rows.length} rosters`);
  }

  // League seasons map
  const leaguesRows = await db.select().from(leagues).where(inArray(leagues.id, leagueIds));
  const leagueSeasonById = new Map<string, string>();
  for (const lg of leaguesRows) leagueSeasonById.set(lg.id, String(lg.season));

  console.log('\nLeague seasons:');
  leaguesRows.forEach(lg => {
    console.log(`  ${lg.id}: ${lg.season}`);
  });

  const events: NewAssetEvent[] = [];

  // Get transactions
  const txs = await db.select().from(transactions).where(inArray(transactions.leagueId, leagueIds));
  console.log(`\nProcessing ${txs.length} transactions...`);

  // Filter to just trade transactions with picks for testing
  const tradeTxsWithPicks = txs.filter(t => {
    if (t.type !== 'trade') return false;
    const payload = t.payload as any;
    return Array.isArray(payload?.draft_picks) && payload.draft_picks.length > 0;
  });

  console.log(`Found ${tradeTxsWithPicks.length} trade transactions with picks`);

  // Test one specific transaction
  const testTxId = '1089400022141067264';
  const testTx = tradeTxsWithPicks.find(t => t.id === testTxId);

  if (!testTx) {
    console.log(`Test transaction ${testTxId} not found`);
    return;
  }

  console.log(`\n=== Processing test transaction ${testTxId} ===`);
  console.log(`League: ${testTx.leagueId}`);
  console.log(`Type: ${testTx.type}`);

  const rosterMap = rosterOwnerMaps.get(testTx.leagueId) || new Map<number, string>();
  const seasonForLeague = leagueSeasonById.get(testTx.leagueId) || null;
  const payload: any = testTx.payload || {};
  const week = testTx.week ?? null;

  const toSafeDate = (v: any): Date | null => {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return null;
    const ms = n > 1e12 ? n : n * 1000;
    const min = Date.UTC(2000, 0, 1);
    const max = Date.UTC(2100, 0, 1);
    if (ms < min || ms > max) return null;
    return new Date(ms);
  };

  const eventTime = toSafeDate(payload?.status_updated) || toSafeDate(payload?.created) || null;

  console.log(`Season for league: ${seasonForLeague}`);
  console.log(`Week: ${week}`);
  console.log(`Event time: ${eventTime}`);

  // Process draft_picks
  const dp: any[] = Array.isArray(payload.draft_picks) ? payload.draft_picks : [];
  console.log(`\nProcessing ${dp.length} draft picks:`);

  for (let i = 0; i < dp.length; i++) {
    const pr = dp[i];
    console.log(`\nPick ${i + 1}:`, JSON.stringify(pr, null, 2));

    const pickSeason = String(pr.season ?? '');
    const pickRound = Number(pr.round ?? 0);
    const originalRosterId = Number(pr.roster_id ?? pr.roster ?? 0);

    console.log(`  Parsed - Season: ${pickSeason}, Round: ${pickRound}, Original Roster: ${originalRosterId}`);

    // User ID mapping logic
    let fromUserId: string | null = null;
    let toUserId: string | null = null;

    if (typeof pr.previous_owner_id === 'string') fromUserId = pr.previous_owner_id;
    if (typeof pr.owner_id === 'string') toUserId = pr.owner_id;
    if (!fromUserId && typeof pr.previous_owner_id === 'number') fromUserId = rosterMap.get(Number(pr.previous_owner_id)) || null;
    if (!toUserId && typeof pr.owner_id === 'number') toUserId = rosterMap.get(Number(pr.owner_id)) || null;

    console.log(`  From roster ID ${pr.previous_owner_id} -> User ID ${fromUserId}`);
    console.log(`  To roster ID ${pr.owner_id} -> User ID ${toUserId}`);

    const event: NewAssetEvent = {
      leagueId: testTx.leagueId,
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
      transactionId: testTx.id,
      details: { type: testTx.type },
    };

    events.push(event);
    console.log(`  Created event: ${event.eventType} for ${event.pickSeason}R${event.pickRound} (orig ${event.pickOriginalRosterId})`);
  }

  console.log(`\n=== Summary ===`);
  console.log(`Total events created: ${events.length}`);

  // Check for duplicates in the created events
  const eventKeys = events.map(e => `${e.transactionId}-${e.pickSeason}-${e.pickRound}-${e.pickOriginalRosterId}-${e.fromUserId}-${e.toUserId}`);
  const uniqueEventKeys = new Set(eventKeys);

  if (eventKeys.length !== uniqueEventKeys.size) {
    console.log('\n❌ FOUND DUPLICATE EVENTS IN SIMULATION!');
    console.log('Event keys:', eventKeys);
    console.log('Unique event keys:', Array.from(uniqueEventKeys));
  } else {
    console.log('\n✅ No duplicate events created in simulation');
  }
}

simulateRebuild().catch(console.error);