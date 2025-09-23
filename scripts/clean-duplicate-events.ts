#!/usr/bin/env npx tsx

import { config } from 'dotenv';
config(); // Load environment variables from .env file

import { getDb } from '../src/db';
import { sql } from 'drizzle-orm';

async function cleanDuplicateEvents() {
  console.log('🧹 Cleaning duplicate asset events from database...\n');
  const db = await getDb();

  // First, let's see what we're dealing with
  console.log('📊 Analyzing duplicate events...');
  const duplicateAnalysis = await db.execute(sql`
    SELECT
      event_type,
      COUNT(*) as total_events,
      COUNT(*) - COUNT(DISTINCT (
        transaction_id || '|' ||
        event_type || '|' ||
        asset_kind || '|' ||
        COALESCE(player_id, '') || '|' ||
        COALESCE(pick_season, '') || '|' ||
        COALESCE(pick_round::text, '') || '|' ||
        COALESCE(pick_original_roster_id::text, '') || '|' ||
        COALESCE(from_user_id, '') || '|' ||
        COALESCE(to_user_id, '')
      )) as duplicate_count
    FROM asset_events
    WHERE transaction_id IS NOT NULL
    GROUP BY event_type
    ORDER BY duplicate_count DESC
  `);

  console.log('Duplicate analysis by event type:');
  console.table(duplicateAnalysis.rows);

  // Count total duplicates to remove (using same logic as check script)
  const totalDuplicatesResult = await db.execute(sql`
    WITH duplicate_groups AS (
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
    )
    SELECT COALESCE(SUM(duplicate_count - 1), 0) as duplicates_to_remove
    FROM duplicate_groups
  `);

  const duplicatesToRemove = Number(totalDuplicatesResult.rows[0]?.duplicates_to_remove || 0);
  console.log(`\n🎯 Found ${duplicatesToRemove} duplicate events to remove`);

  if (duplicatesToRemove === 0) {
    console.log('✅ No duplicates found! Database is clean.');
    return;
  }

  // Perform the cleanup
  console.log('\n🗑️  Removing duplicate events (keeping earliest created_at for each business key)...');

  const deleteResult = await db.execute(sql`
    WITH ranked_events AS (
      SELECT
        id,
        ROW_NUMBER() OVER (
          PARTITION BY
            league_id,
            event_type,
            asset_kind,
            player_id,
            pick_season,
            pick_round,
            transaction_id,
            to_user_id,
            from_user_id
          ORDER BY created_at ASC
        ) as row_num
      FROM asset_events
      WHERE transaction_id IS NOT NULL
    )
    DELETE FROM asset_events
    WHERE id IN (
      SELECT id FROM ranked_events WHERE row_num > 1
    )
  `);

  console.log(`✅ Successfully removed ${deleteResult.rowCount} duplicate events`);

  // Verify cleanup (using same logic as check script)
  console.log('\n🔍 Verifying cleanup...');
  const remainingDuplicates = await db.execute(sql`
    SELECT COUNT(*) as remaining_duplicate_groups
    FROM (
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
    ) duplicate_check
  `);

  const remainingCount = Number(remainingDuplicates.rows[0]?.remaining_duplicate_groups || 0);

  if (remainingCount === 0) {
    console.log('✅ Perfect! No duplicate groups remain.');
  } else {
    console.log(`⚠️  Warning: ${remainingCount} duplicate groups still exist.`);
  }

  // Show final stats
  console.log('\n📈 Final asset event statistics:');
  const finalStats = await db.execute(sql`
    SELECT
      event_type,
      COUNT(*) as count
    FROM asset_events
    GROUP BY event_type
    ORDER BY count DESC
  `);
  console.table(finalStats.rows);

  console.log('\n🎉 Duplicate cleanup completed!');
  process.exit(0);
}

cleanDuplicateEvents().catch((error) => {
  console.error('❌ Error cleaning duplicates:', error);
  process.exit(1);
});