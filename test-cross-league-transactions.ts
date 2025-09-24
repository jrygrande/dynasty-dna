#!/usr/bin/env npx tsx

import { config } from 'dotenv';
config(); // Load environment variables from .env file

import { Sleeper } from './src/lib/sleeper';

async function testCrossLeagueTransactions() {
  console.log('=== Testing cross-league transaction fetching ===\n');

  // Test the family leagues
  const familyLeagues = ['716048884559835136', '784554710463127552', '926647116724891648', '1051592789462589440'];

  // Test transaction that we know caused duplicates
  const testTxId = '1089400022141067264';

  // Test a few weeks for each league to see if the same transaction appears
  const testWeeks = [1, 2, 3];

  const transactionAppearances = new Map<string, Array<{ leagueId: string, week: number }>>();

  for (const leagueId of familyLeagues) {
    console.log(`\nTesting league ${leagueId}:`);

    for (const week of testWeeks) {
      try {
        console.log(`  Fetching week ${week}...`);
        const txs = await Sleeper.getTransactions(leagueId, week);
        console.log(`    Found ${txs.length} transactions`);

        for (const tx of txs) {
          const txId = String(tx.transaction_id);
          if (!transactionAppearances.has(txId)) {
            transactionAppearances.set(txId, []);
          }
          transactionAppearances.get(txId)!.push({ leagueId, week });

          // Log our specific test transaction
          if (txId === testTxId) {
            console.log(`    ⭐ Found test transaction ${testTxId} in league ${leagueId}, week ${week}`);
          }
        }

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.log(`    Error fetching week ${week}:`, error);
      }
    }
  }

  console.log('\n=== Cross-league transaction analysis ===');

  // Find transactions that appear in multiple leagues
  const crossLeagueTransactions = Array.from(transactionAppearances.entries())
    .filter(([txId, appearances]) => appearances.length > 1);

  if (crossLeagueTransactions.length > 0) {
    console.log(`\n❌ Found ${crossLeagueTransactions.length} transactions that appear in multiple leagues:`);

    crossLeagueTransactions.slice(0, 10).forEach(([txId, appearances]) => {
      console.log(`  Transaction ${txId}:`);
      appearances.forEach(({ leagueId, week }) => {
        console.log(`    - League ${leagueId}, Week ${week}`);
      });
    });

    if (crossLeagueTransactions.length > 10) {
      console.log(`    ... and ${crossLeagueTransactions.length - 10} more`);
    }
  } else {
    console.log('\n✅ No transactions appear in multiple leagues');
  }

  // Check specifically for our test transaction
  const testTxAppearances = transactionAppearances.get(testTxId);
  if (testTxAppearances) {
    console.log(`\nTest transaction ${testTxId} appears in:`);
    testTxAppearances.forEach(({ leagueId, week }) => {
      console.log(`  - League ${leagueId}, Week ${week}`);
    });
  } else {
    console.log(`\nTest transaction ${testTxId} not found in any of the tested weeks`);
  }
}

testCrossLeagueTransactions().catch(console.error);