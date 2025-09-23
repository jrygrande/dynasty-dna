#!/usr/bin/env npx tsx

import { config } from 'dotenv';
config(); // Load environment variables from .env file

import { getDb } from '../src/db';
import { sql } from 'drizzle-orm';

async function removeDuplicates() {
  console.log('Removing duplicate asset events from database...\n');
  const db = await getDb();

  // Find and remove duplicates by keeping only the first occurrence of each business key
  const result = await db.execute(sql`
    WITH ranked_events AS (
      SELECT
        id,
        ROW_NUMBER() OVER (
          PARTITION BY
            league_id,
            event_type,
            asset_kind,
            COALESCE(player_id, ''),
            COALESCE(pick_season, ''),
            COALESCE(pick_round, 0),
            COALESCE(pick_original_roster_id, 0),
            COALESCE(transaction_id, ''),
            COALESCE(from_user_id, ''),
            COALESCE(to_user_id, '')
          ORDER BY created_at ASC
        ) as rn
      FROM asset_events
    )
    DELETE FROM asset_events
    WHERE id IN (
      SELECT id FROM ranked_events WHERE rn > 1
    )
  `);

  console.log(`✅ Removed ${result.rowCount} duplicate asset events`);

  // Verify no duplicates remain
  const remainingDuplicates = await db.execute(sql`
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
    LIMIT 5
  `);

  if (remainingDuplicates.rows.length > 0) {
    console.log('❌ Some duplicates still remain:');
    console.table(remainingDuplicates.rows);
  } else {
    console.log('✅ All duplicates have been removed');
  }

  // Show final stats
  const finalStats = await db.execute(sql`
    SELECT
      event_type,
      COUNT(*) as count
    FROM asset_events
    GROUP BY event_type
    ORDER BY count DESC
  `);

  console.log('\nFinal asset event statistics:');
  console.table(finalStats.rows);

  process.exit(0);
}

removeDuplicates().catch((error) => {
  console.error('Error removing duplicates:', error);
  process.exit(1);
});