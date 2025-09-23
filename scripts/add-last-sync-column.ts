#!/usr/bin/env npx tsx

import { config } from 'dotenv';
config(); // Load environment variables from .env file

import { getDb } from '../src/db';
import { sql } from 'drizzle-orm';

async function addLastSyncColumn() {
  console.log('🔧 Adding last_asset_events_sync_at column to leagues table...\n');
  const db = await getDb();

  try {
    // First, check if the column already exists
    console.log('🔍 Checking if column already exists...');
    const columnCheck = await db.execute(sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'leagues'
        AND column_name = 'last_asset_events_sync_at'
    `);

    if (columnCheck.rows.length > 0) {
      console.log('✅ Column already exists! No action needed.');
      return;
    }

    // Add the column
    console.log('➕ Adding last_asset_events_sync_at column...');
    await db.execute(sql`
      ALTER TABLE leagues
      ADD COLUMN last_asset_events_sync_at TIMESTAMP
    `);

    console.log('✅ Successfully added last_asset_events_sync_at column!');

    // Verify the column was created
    console.log('\n🔍 Verifying column creation...');
    const verification = await db.execute(sql`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'leagues'
        AND column_name = 'last_asset_events_sync_at'
    `);

    if (verification.rows.length > 0) {
      console.log('✅ Verification successful! Column details:');
      console.table(verification.rows);
    } else {
      console.log('⚠️  Warning: Could not verify column creation.');
    }

    console.log('\n🎉 Database schema updated successfully!');
    console.log('   The leagues table now tracks when asset events were last synced.');

  } catch (error: any) {
    console.error('❌ Error adding column:', error.message);

    if (error.message.includes('already exists')) {
      console.log('ℹ️  Column already exists.');
    } else {
      console.error('   Full error:', error);
      process.exit(1);
    }
  }

  process.exit(0);
}

addLastSyncColumn().catch((error) => {
  console.error('❌ Error adding last sync column:', error);
  process.exit(1);
});