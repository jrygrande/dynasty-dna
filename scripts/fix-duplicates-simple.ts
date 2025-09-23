#!/usr/bin/env npx tsx

import { config } from 'dotenv';
config(); // Load environment variables from .env file

import { getDb } from '../src/db';
import { sql } from 'drizzle-orm';

async function fixDuplicates() {
  console.log('Fixing duplicate asset events...\n');
  const db = await getDb();

  // Delete the duplicate entries by keeping only the newest of each duplicate set
  const result = await db.execute(sql`
    DELETE FROM asset_events
    WHERE id IN (
      SELECT id FROM (
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
            ORDER BY created_at DESC
          ) as rn
        FROM asset_events
        WHERE transaction_id IS NOT NULL
      ) duplicates
      WHERE rn > 1
    )
  `);

  console.log(`✅ Removed ${result.rowCount} duplicate rows`);

  // Verify fix
  const remainingDuplicates = await db.execute(sql`
    SELECT COUNT(*) as count
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
        COUNT(*) as dup_count
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
    ) remaining
  `);

  console.log(`Remaining duplicate groups: ${remainingDuplicates.rows[0]?.count || 0}`);

  process.exit(0);
}

fixDuplicates().catch((error) => {
  console.error('Error fixing duplicates:', error);
  process.exit(1);
});