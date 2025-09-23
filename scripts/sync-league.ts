#!/usr/bin/env npx tsx

import { config } from 'dotenv';
config(); // Load environment variables from .env file

import { syncLeagueFamily } from '../src/services/sync';

async function main() {
  const leagueId = process.argv[2];

  if (!leagueId) {
    console.error('Usage: npx tsx scripts/sync-league.ts <leagueId>');
    console.error('Example: npx tsx scripts/sync-league.ts 1191596293294166016');
    process.exit(1);
  }

  console.log(`Starting sync for league family: ${leagueId}`);

  try {
    const result = await syncLeagueFamily(leagueId);
    console.log('\n✅ Sync completed successfully!');
    console.log(`\nSynced ${result.leagues.length} leagues in family:`);

    result.results.forEach(({ leagueId, result }, index) => {
      console.log(`\n${index + 1}. League ${leagueId}:`);
      console.log(`   - Users: ${result.users}`);
      console.log(`   - Rosters: ${result.rosters}`);
      console.log(`   - Transactions: ${result.transactions}`);
      console.log(`   - Matchups: ${result.matchups}`);
      console.log(`   - Player Scores: ${result.playerScores}`);
      console.log(`   - Drafts: ${result.drafts}`);
      console.log(`   - Draft Picks: ${result.draftPicks}`);
      console.log(`   - Traded Picks: ${result.tradedPicks}`);
    });

  } catch (error) {
    console.error('\n❌ Sync failed:');
    console.error(error);
    process.exit(1);
  }
}

main();