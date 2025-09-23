#!/usr/bin/env npx tsx

import { config } from 'dotenv';
config(); // Load environment variables from .env file

import { getDb } from '../src/db';
import { sql } from 'drizzle-orm';

async function debugTradeLabel() {
  console.log('🔍 Debugging trade event label issue...\n');
  const db = await getDb();

  try {
    // Find some trade events to check their eventType values
    console.log('Checking eventType values for trade events...');
    const tradeEvents = await db.execute(sql`
      SELECT
        id,
        event_type,
        transaction_id,
        player_id,
        LENGTH(event_type) as type_length,
        ASCII(SUBSTRING(event_type, 1, 1)) as first_char_ascii,
        ASCII(SUBSTRING(event_type, 2, 1)) as second_char_ascii
      FROM asset_events
      WHERE league_id = '1191596293294166016'
        AND event_type = 'trade'
      LIMIT 5
    `);

    if (tradeEvents.rows.length > 0) {
      console.log('Trade event data:');
      console.table(tradeEvents.rows);

      // Test the formatEventType function logic
      const formatEventType = (eventType: string): string => {
        return eventType
          .split(/[_-]/)
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join(' ');
      };

      console.log('\nTesting formatEventType function:');
      for (const row of tradeEvents.rows) {
        const formatted = formatEventType(row.event_type);
        console.log(`"${row.event_type}" -> "${formatted}"`);
      }
    } else {
      console.log('No trade events found');
    }

    // Check for any unusual characters in event_type
    console.log('\nChecking for events with unusual characters...');
    const unusualEvents = await db.execute(sql`
      SELECT
        event_type,
        transaction_id,
        COUNT(*) as count,
        ARRAY_AGG(DISTINCT id) as sample_ids
      FROM asset_events
      WHERE league_id = '1191596293294166016'
        AND (
          event_type ~ '[^a-z_-]' OR
          LENGTH(event_type) > 20 OR
          event_type != LOWER(event_type)
        )
      GROUP BY event_type, transaction_id
      LIMIT 10
    `);

    if (unusualEvents.rows.length > 0) {
      console.log('Events with unusual characters or formatting:');
      console.table(unusualEvents.rows);
    } else {
      console.log('✅ No events with unusual characters found');
    }

  } catch (error: any) {
    console.error('❌ Error during debug:', error.message);
    console.error('Full error:', error);
  }
}

debugTradeLabel().catch((error) => {
  console.error('❌ Unhandled error:', error);
  process.exit(1);
});