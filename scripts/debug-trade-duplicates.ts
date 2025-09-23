#!/usr/bin/env npx tsx

import { config } from 'dotenv';
config(); // Load environment variables from .env file

import { getDb } from '../src/db';
import { sql } from 'drizzle-orm';

async function debugTradeDuplicates() {
  console.log('🔍 Investigating trade transaction duplicates...\n');
  const db = await getDb();

  try {
    // Find transactions with multiple events for the same player
    console.log('Looking for transactions with multiple events for the same player...');
    const multipleEventsCheck = await db.execute(sql`
      SELECT
        transaction_id,
        player_id,
        asset_kind,
        COUNT(*) as event_count,
        ARRAY_AGG(event_type) as event_types
      FROM asset_events
      WHERE league_id = '1191596293294166016'
        AND transaction_id IS NOT NULL
        AND asset_kind = 'player'
        AND player_id IS NOT NULL
      GROUP BY transaction_id, player_id, asset_kind
      HAVING COUNT(*) > 1
      ORDER BY event_count DESC
      LIMIT 10
    `);

    if (multipleEventsCheck.rows.length > 0) {
      console.log('Found transactions with multiple events for the same player:');
      console.table(multipleEventsCheck.rows);

      // Look at the first problematic transaction in detail
      const firstProblem = multipleEventsCheck.rows[0];
      console.log(`\nDetailed view of transaction ${firstProblem.transaction_id}:`);

      const detailCheck = await db.execute(sql`
        SELECT
          id,
          event_type,
          asset_kind,
          player_id,
          from_user_id,
          to_user_id,
          from_roster_id,
          to_roster_id,
          created_at
        FROM asset_events
        WHERE transaction_id = ${firstProblem.transaction_id}
          AND player_id = ${firstProblem.player_id}
        ORDER BY created_at
      `);

      console.table(detailCheck.rows);
    } else {
      console.log('✅ No transactions found with multiple events for the same player');
    }

    // Check for any remaining business key duplicates
    console.log('\nChecking for business key duplicates...');
    const businessKeyDupes = await db.execute(sql`
      SELECT
        league_id,
        event_type,
        asset_kind,
        player_id,
        pick_season,
        pick_round,
        pick_original_roster_id,
        transaction_id,
        from_user_id,
        to_user_id,
        COUNT(*) as duplicate_count
      FROM asset_events
      WHERE league_id = '1191596293294166016'
      GROUP BY
        league_id,
        event_type,
        asset_kind,
        player_id,
        pick_season,
        pick_round,
        pick_original_roster_id,
        transaction_id,
        from_user_id,
        to_user_id
      HAVING COUNT(*) > 1
      LIMIT 5
    `);

    if (businessKeyDupes.rows.length > 0) {
      console.log('Found business key duplicates:');
      console.table(businessKeyDupes.rows);
    } else {
      console.log('✅ No business key duplicates found');
    }

  } catch (error: any) {
    console.error('❌ Error during investigation:', error.message);
    console.error('Full error:', error);
  }
}

debugTradeDuplicates().catch((error) => {
  console.error('❌ Unhandled error:', error);
  process.exit(1);
});