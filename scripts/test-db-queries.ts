#!/usr/bin/env tsx
/**
 * Database query tests for Dynasty DNA sync system
 * Tests the acquisition type fix and database schema changes
 */

import { getDb } from '../src/db/index';
import { sql } from 'drizzle-orm';

async function testAcquisitionTypeFix() {
  console.log('🔍 Testing Acquisition Type Fix...\n');

  const db = await getDb();

  // First, let's see what leagues we have
  console.log('📊 Available leagues:');
  const leagues = await db.execute(sql`
    SELECT id, name, last_sync_at, sync_status
    FROM leagues
    ORDER BY created_at DESC
    LIMIT 5
  `);

  leagues.forEach((league: any) => {
    console.log(`  ${league.id}: ${league.name} (Status: ${league.sync_status || 'null'})`);
  });

  if (leagues.length === 0) {
    console.log('❌ No leagues found in database');
    return;
  }

  const testLeagueId = leagues[0].id;
  console.log(`\n🎯 Testing with league: ${testLeagueId}\n`);

  // Check for players with multiple acquisition events
  console.log('🔍 Looking for players with multiple acquisition event types:');
  const duplicateEvents = await db.execute(sql`
    SELECT
      player_id,
      array_agg(DISTINCT event_type ORDER BY event_type) as event_types,
      COUNT(DISTINCT event_type) as type_count,
      COUNT(*) as total_events
    FROM asset_events
    WHERE asset_kind = 'player'
      AND league_id = ${testLeagueId}
      AND event_type IN ('trade', 'add', 'waiver_add', 'free_agent_add', 'draft_selected')
    GROUP BY player_id
    HAVING COUNT(DISTINCT event_type) > 1
    ORDER BY type_count DESC, total_events DESC
    LIMIT 10
  `);

  if (duplicateEvents.length === 0) {
    console.log('✅ No players found with multiple acquisition event types');
  } else {
    console.log(`📋 Found ${duplicateEvents.length} players with multiple event types:`);
    duplicateEvents.forEach((row: any) => {
      console.log(`  Player ${row.player_id}: ${row.event_types.join(', ')} (${row.total_events} total events)`);
    });
  }

  // Check specific trade vs add conflicts
  console.log('\n🔄 Looking for trade vs add conflicts:');
  const tradeAddConflicts = await db.execute(sql`
    SELECT
      player_id,
      to_roster_id,
      COUNT(CASE WHEN event_type = 'trade' THEN 1 END) as trade_events,
      COUNT(CASE WHEN event_type = 'add' THEN 1 END) as add_events,
      MAX(CASE WHEN event_type = 'trade' THEN event_time END) as last_trade,
      MAX(CASE WHEN event_type = 'add' THEN event_time END) as last_add
    FROM asset_events
    WHERE asset_kind = 'player'
      AND league_id = ${testLeagueId}
      AND event_type IN ('trade', 'add')
    GROUP BY player_id, to_roster_id
    HAVING COUNT(CASE WHEN event_type = 'trade' THEN 1 END) > 0
       AND COUNT(CASE WHEN event_type = 'add' THEN 1 END) > 0
    ORDER BY player_id
    LIMIT 5
  `);

  if (tradeAddConflicts.length === 0) {
    console.log('✅ No trade vs add conflicts found');
  } else {
    console.log(`⚠️ Found ${tradeAddConflicts.length} players with both trade and add events:`);
    tradeAddConflicts.forEach((row: any) => {
      console.log(`  Player ${row.player_id} → Roster ${row.to_roster_id}:`);
      console.log(`    Trade events: ${row.trade_events}, Add events: ${row.add_events}`);
      console.log(`    Last trade: ${row.last_trade}, Last add: ${row.last_add}`);
    });
  }
}

async function testSyncSchemaChanges() {
  console.log('\n📊 Testing Sync Schema Changes...\n');

  const db = await getDb();

  // Check if new columns exist
  console.log('🔧 Checking for new sync tracking columns:');
  const columnCheck = await db.execute(sql`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'leagues'
      AND column_name IN ('last_sync_at', 'sync_status', 'sync_version', 'last_asset_events_sync_at')
    ORDER BY column_name
  `);

  if (columnCheck.length < 4) {
    console.log('❌ Missing sync tracking columns:');
    const expectedColumns = ['last_sync_at', 'sync_status', 'sync_version', 'last_asset_events_sync_at'];
    const foundColumns = columnCheck.map((col: any) => col.column_name);
    const missingColumns = expectedColumns.filter(col => !foundColumns.includes(col));
    console.log(`  Missing: ${missingColumns.join(', ')}`);
  } else {
    console.log('✅ All sync tracking columns found:');
    columnCheck.forEach((col: any) => {
      console.log(`  ${col.column_name}: ${col.data_type} (default: ${col.column_default || 'null'})`);
    });
  }

  // Check sync status values
  console.log('\n📈 Current sync status distribution:');
  const statusDistribution = await db.execute(sql`
    SELECT
      sync_status,
      COUNT(*) as count,
      ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 1) as percentage
    FROM leagues
    GROUP BY sync_status
    ORDER BY count DESC
  `);

  statusDistribution.forEach((row: any) => {
    console.log(`  ${row.sync_status || 'null'}: ${row.count} leagues (${row.percentage}%)`);
  });

  // Check sync timestamps
  console.log('\n⏰ Sync timestamp analysis:');
  const timestampStats = await db.execute(sql`
    SELECT
      COUNT(CASE WHEN last_sync_at IS NOT NULL THEN 1 END) as leagues_with_sync_time,
      COUNT(CASE WHEN last_sync_at > NOW() - INTERVAL '1 hour' THEN 1 END) as synced_last_hour,
      COUNT(CASE WHEN last_sync_at > NOW() - INTERVAL '24 hours' THEN 1 END) as synced_last_day,
      COUNT(*) as total_leagues
    FROM leagues
  `);

  const stats = timestampStats[0] as any;
  console.log(`  Leagues with sync time: ${stats.leagues_with_sync_time}/${stats.total_leagues}`);
  console.log(`  Synced in last hour: ${stats.synced_last_hour}`);
  console.log(`  Synced in last 24h: ${stats.synced_last_day}`);
}

async function testSyncIndexes() {
  console.log('\n🗂️ Testing Sync Indexes...\n');

  const db = await getDb();

  // Check for sync-related indexes
  const indexCheck = await db.execute(sql`
    SELECT
      indexname,
      tablename,
      indexdef
    FROM pg_indexes
    WHERE tablename = 'leagues'
      AND indexname LIKE '%sync%'
    ORDER BY indexname
  `);

  if (indexCheck.length === 0) {
    console.log('⚠️ No sync-related indexes found on leagues table');
  } else {
    console.log('📊 Sync-related indexes:');
    indexCheck.forEach((idx: any) => {
      console.log(`  ${idx.indexname}: ${idx.indexdef}`);
    });
  }

  // Test index performance with a sample query
  console.log('\n⚡ Testing sync status query performance:');
  const start = Date.now();
  const syncingLeagues = await db.execute(sql`
    SELECT id, name, sync_status, last_sync_at
    FROM leagues
    WHERE sync_status = 'syncing'
    ORDER BY last_sync_at DESC
  `);
  const duration = Date.now() - start;

  console.log(`  Query executed in ${duration}ms`);
  console.log(`  Found ${syncingLeagues.length} leagues currently syncing`);
}

async function main() {
  console.log('🧪 Dynasty DNA Database Tests');
  console.log('============================\n');

  try {
    await testSyncSchemaChanges();
    await testSyncIndexes();
    await testAcquisitionTypeFix();

    console.log('\n✅ Database tests completed successfully!');
  } catch (error) {
    console.error('\n❌ Database tests failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}