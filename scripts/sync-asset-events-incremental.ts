#!/usr/bin/env npx tsx

import { config } from 'dotenv';
config(); // Load environment variables from .env file

import { syncAssetEventsIncremental } from '../src/services/assets';

async function main() {
  const leagueId = process.argv[2];
  if (!leagueId) {
    console.error('Usage: npx tsx scripts/sync-asset-events-incremental.ts <league_id>');
    process.exit(1);
  }

  console.log(`🔄 Starting incremental asset events sync for league: ${leagueId}`);

  try {
    const result = await syncAssetEventsIncremental(leagueId);

    console.log('\n✅ Incremental sync completed successfully!');
    console.log(`📊 Results:`);
    console.log(`   - Leagues in family: ${result.leagues}`);
    console.log(`   - Transactions processed: ${result.transactionsProcessed}`);
    console.log(`   - Events generated: ${result.eventsGenerated}`);
    console.log(`   - Previous sync time: ${result.lastSyncTime || 'never'}`);

    process.exit(0);
  } catch (error) {
    console.error('❌ Error during incremental sync:', error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('❌ Unhandled error:', error);
  process.exit(1);
});