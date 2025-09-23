#!/usr/bin/env npx tsx

import { config } from 'dotenv';
config(); // Load environment variables from .env file

import { getDb } from '../src/db';
import { sql } from 'drizzle-orm';

async function checkDuplicates() {
  console.log('Checking for duplicates in the database...\n');
  const db = await getDb();

  // Check for duplicate asset events
  console.log('1. Checking asset_events table for duplicates...');
  const assetEventDuplicates = await db.execute(sql`
    SELECT
      league_id,
      event_type,
      asset_kind,
      player_id,
      pick_season,
      pick_round,
      transaction_id,
      to_user_id,
      from_user_id,
      COUNT(*) as duplicate_count
    FROM asset_events
    WHERE transaction_id IS NOT NULL
    GROUP BY
      league_id,
      event_type,
      asset_kind,
      player_id,
      pick_season,
      pick_round,
      transaction_id,
      to_user_id,
      from_user_id
    HAVING COUNT(*) > 1
    ORDER BY duplicate_count DESC
    LIMIT 10
  `);

  if (assetEventDuplicates.rows.length > 0) {
    console.log('❌ Found duplicate asset events:');
    console.table(assetEventDuplicates.rows);
  } else {
    console.log('✅ No duplicate asset events found');
  }

  // Check for duplicate transactions
  console.log('\n2. Checking transactions table for duplicates...');
  const transactionDuplicates = await db.execute(sql`
    SELECT
      id,
      COUNT(*) as duplicate_count
    FROM transactions
    GROUP BY id
    HAVING COUNT(*) > 1
    LIMIT 10
  `);

  if (transactionDuplicates.rows.length > 0) {
    console.log('❌ Found duplicate transactions:');
    console.table(transactionDuplicates.rows);
  } else {
    console.log('✅ No duplicate transactions found');
  }

  // Check for duplicate player scores
  console.log('\n3. Checking player_scores table for duplicates...');
  const playerScoreDuplicates = await db.execute(sql`
    SELECT
      league_id,
      week,
      roster_id,
      player_id,
      COUNT(*) as duplicate_count
    FROM player_scores
    GROUP BY league_id, week, roster_id, player_id
    HAVING COUNT(*) > 1
    LIMIT 10
  `);

  if (playerScoreDuplicates.rows.length > 0) {
    console.log('❌ Found duplicate player scores:');
    console.table(playerScoreDuplicates.rows);
  } else {
    console.log('✅ No duplicate player scores found');
  }

  // Check for duplicate rosters
  console.log('\n4. Checking rosters table for duplicates...');
  const rosterDuplicates = await db.execute(sql`
    SELECT
      league_id,
      roster_id,
      COUNT(*) as duplicate_count
    FROM rosters
    GROUP BY league_id, roster_id
    HAVING COUNT(*) > 1
    LIMIT 10
  `);

  if (rosterDuplicates.rows.length > 0) {
    console.log('❌ Found duplicate rosters:');
    console.table(rosterDuplicates.rows);
  } else {
    console.log('✅ No duplicate rosters found');
  }

  // Check for duplicate matchups
  console.log('\n5. Checking matchups table for duplicates...');
  const matchupDuplicates = await db.execute(sql`
    SELECT
      league_id,
      week,
      roster_id,
      COUNT(*) as duplicate_count
    FROM matchups
    GROUP BY league_id, week, roster_id
    HAVING COUNT(*) > 1
    LIMIT 10
  `);

  if (matchupDuplicates.rows.length > 0) {
    console.log('❌ Found duplicate matchups:');
    console.table(matchupDuplicates.rows);
  } else {
    console.log('✅ No duplicate matchups found');
  }

  // Count total asset events
  console.log('\n6. Asset event statistics:');
  const eventStats = await db.execute(sql`
    SELECT
      event_type,
      COUNT(*) as count
    FROM asset_events
    GROUP BY event_type
    ORDER BY count DESC
  `);
  console.table(eventStats.rows);

  // Check for orphaned asset events (no transaction ID where expected)
  console.log('\n7. Checking for orphaned asset events...');
  const orphanedEvents = await db.execute(sql`
    SELECT
      event_type,
      COUNT(*) as count
    FROM asset_events
    WHERE transaction_id IS NULL
      AND event_type IN ('trade', 'waiver_add', 'waiver_drop', 'free_agent_add', 'free_agent_drop')
    GROUP BY event_type
  `);

  if (orphanedEvents.rows.length > 0) {
    console.log('⚠️ Found asset events without transaction IDs:');
    console.table(orphanedEvents.rows);
  } else {
    console.log('✅ All transactional events have transaction IDs');
  }

  // Get total counts
  console.log('\n8. Total record counts:');
  const counts = await db.execute(sql`
    SELECT
      'transactions' as table_name,
      COUNT(*) as count
    FROM transactions
    UNION ALL
    SELECT
      'asset_events' as table_name,
      COUNT(*) as count
    FROM asset_events
    UNION ALL
    SELECT
      'player_scores' as table_name,
      COUNT(*) as count
    FROM player_scores
    UNION ALL
    SELECT
      'rosters' as table_name,
      COUNT(*) as count
    FROM rosters
    UNION ALL
    SELECT
      'matchups' as table_name,
      COUNT(*) as count
    FROM matchups
    ORDER BY table_name
  `);
  console.table(counts.rows);

  process.exit(0);
}

checkDuplicates().catch((error) => {
  console.error('Error checking duplicates:', error);
  process.exit(1);
});