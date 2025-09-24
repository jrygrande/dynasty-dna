#!/usr/bin/env npx tsx

import { config } from 'dotenv';
config(); // Load environment variables from .env file

import { getDb } from './src/db';
import { transactions } from './src/db/schema';
import { inArray } from 'drizzle-orm';

async function testTransactionLeagues() {
  const db = await getDb();

  // Test the family leagues
  const familyLeagues = ['1051592789462589440', '926647116724891648', '784554710463127552', '716048884559835136'];

  console.log('=== Testing transaction fetching across league family ===\n');

  // Fetch transactions for the entire family
  const allTxs = await db.select().from(transactions).where(inArray(transactions.leagueId, familyLeagues));

  console.log(`Total transactions across family: ${allTxs.length}`);

  // Group by league ID to see distribution
  const byLeague = new Map<string, number>();
  allTxs.forEach(tx => {
    byLeague.set(tx.leagueId, (byLeague.get(tx.leagueId) || 0) + 1);
  });

  console.log('\nTransactions by league:');
  for (const [leagueId, count] of byLeague) {
    console.log(`  ${leagueId}: ${count} transactions`);
  }

  // Check if any transaction ID appears multiple times
  const txIdCounts = new Map<string, number>();
  allTxs.forEach(tx => {
    txIdCounts.set(tx.id, (txIdCounts.get(tx.id) || 0) + 1);
  });

  const duplicateTxIds = Array.from(txIdCounts.entries()).filter(([id, count]) => count > 1);

  if (duplicateTxIds.length > 0) {
    console.log('\n❌ FOUND DUPLICATE TRANSACTION IDs across family:');
    duplicateTxIds.forEach(([id, count]) => {
      console.log(`  ${id}: ${count} times`);
    });
  } else {
    console.log('\n✅ No duplicate transaction IDs found across family');
  }

  // Test specific problematic transactions
  const testTxIds = ['1089400022141067264', '815796378851721216', '829204071884902400', '753367758003146752'];

  console.log('\n=== Testing specific problematic transactions ===');

  for (const txId of testTxIds) {
    const matchingTxs = allTxs.filter(tx => tx.id === txId);
    console.log(`Transaction ${txId}: found ${matchingTxs.length} times`);
    if (matchingTxs.length > 1) {
      console.log('  Leagues:', matchingTxs.map(tx => tx.leagueId));
    } else if (matchingTxs.length === 1) {
      console.log(`  League: ${matchingTxs[0].leagueId}`);
    }
  }
}

testTransactionLeagues().catch(console.error);