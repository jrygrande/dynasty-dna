#!/usr/bin/env npx tsx

import { config } from 'dotenv';
config(); // Load environment variables from .env file

import { syncLeagueFamily } from '../src/services/sync';

async function main() {
  const leagueId = process.argv[2];
  if (!leagueId) {
    console.error('Usage: npx tsx scripts/sync-league-incremental.ts <league_id>');
    process.exit(1);
  }

  console.log(`🔄 Starting incremental sync for league family: ${leagueId}`);

  try {
    const result = await syncLeagueFamily(leagueId, { incremental: true });

    console.log('\n✅ Incremental sync completed successfully!');
    console.log(`📊 Results:`);
    console.log(`   - Leagues in family: ${result.leagues.length}`);
    console.log(`   - Total leagues synced: ${result.results.length}`);

    for (const { leagueId: lid, result: syncResult } of result.results) {
      console.log(`   - League ${lid}:`);
      console.log(`     - Users: ${syncResult.users}`);
      console.log(`     - Transactions: ${syncResult.transactions}`);
      console.log(`     - Player scores: ${syncResult.playerScores}`);
    }

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