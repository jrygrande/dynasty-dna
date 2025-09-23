#!/usr/bin/env npx tsx

import { config } from 'dotenv';
config(); // Load environment variables from .env file

import { getDb } from '../src/db';
import { sql } from 'drizzle-orm';

async function addAssetEventsConstraint() {
  console.log('🔒 Adding unique constraint to asset_events table...\n');
  const db = await getDb();

  try {
    // First, check if the constraint already exists
    console.log('🔍 Checking if unique constraint already exists...');
    const existingConstraint = await db.execute(sql`
      SELECT constraint_name
      FROM information_schema.table_constraints
      WHERE table_name = 'asset_events'
        AND constraint_type = 'UNIQUE'
        AND constraint_name = 'asset_events_business_key_unique'
    `);

    if (existingConstraint.rows.length > 0) {
      console.log('✅ Unique constraint already exists! No action needed.');
      return;
    }

    // Create the unique constraint
    console.log('➕ Creating unique constraint on business key columns...');
    await db.execute(sql`
      ALTER TABLE asset_events
      ADD CONSTRAINT asset_events_business_key_unique
      UNIQUE (
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
      )
    `);

    console.log('✅ Successfully added unique constraint!');
    console.log('\n📋 Constraint details:');
    console.log('   Name: asset_events_business_key_unique');
    console.log('   Columns: league_id, event_type, asset_kind, player_id,');
    console.log('           pick_season, pick_round, pick_original_roster_id,');
    console.log('           transaction_id, from_user_id, to_user_id');

    // Verify the constraint was created
    console.log('\n🔍 Verifying constraint creation...');
    const verification = await db.execute(sql`
      SELECT constraint_name, constraint_type
      FROM information_schema.table_constraints
      WHERE table_name = 'asset_events'
        AND constraint_type = 'UNIQUE'
    `);

    if (verification.rows.length > 0) {
      console.log('✅ Verification successful! Constraint is active.');
      console.table(verification.rows);
    } else {
      console.log('⚠️  Warning: Could not verify constraint creation.');
    }

    console.log('\n🎉 Database is now protected against duplicate asset events!');
    console.log('   Any attempt to insert duplicates will be rejected at the database level.');

  } catch (error: any) {
    console.error('❌ Error adding constraint:', error.message);

    if (error.message.includes('already exists') || error.message.includes('duplicate')) {
      console.log('ℹ️  This might mean the constraint already exists with a different name.');
    } else {
      console.error('   Full error:', error);
      process.exit(1);
    }
  }

  process.exit(0);
}

addAssetEventsConstraint().catch((error) => {
  console.error('❌ Error adding asset events constraint:', error);
  process.exit(1);
});