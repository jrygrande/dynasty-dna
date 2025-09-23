#!/usr/bin/env npx tsx

import { config } from 'dotenv';
config(); // Load environment variables from .env file

import { getDb } from '../src/db';
import { sql } from 'drizzle-orm';

async function checkTransactionDuplicates() {
  console.log('Checking for transaction duplicates specifically...\n');
  const db = await getDb();

  // Check for duplicate transactions more thoroughly
  console.log('1. Checking for exact duplicate transaction IDs...');
  const exactDuplicates = await db.execute(sql`
    SELECT
      id,
      league_id,
      type,
      COUNT(*) as duplicate_count
    FROM transactions
    GROUP BY id, league_id, type
    HAVING COUNT(*) > 1
    ORDER BY duplicate_count DESC
    LIMIT 20
  `);

  if (exactDuplicates.rows.length > 0) {
    console.log('❌ Found duplicate transaction records (same ID, same league):');
    console.table(exactDuplicates.rows);
  } else {
    console.log('✅ No exact duplicate transaction records found');
  }

  // Check for transactions that might be processed multiple times during asset building
  console.log('\n2. Checking specific pick trade transactions from our duplicates...');
  const pickTradeTransactions = await db.execute(sql`
    SELECT
      id,
      league_id,
      type,
      payload
    FROM transactions
    WHERE id IN (
      '1089400022141067264',
      '815796378851721216',
      '1157489567117893632',
      '829204071884902400',
      '753367758003146752'
    )
    ORDER BY id, league_id
  `);

  console.log('Pick trade transactions:');
  console.table(pickTradeTransactions.rows.map(row => ({
    id: row.id,
    league_id: row.league_id,
    type: row.type,
    has_draft_picks: Array.isArray((row.payload as any)?.draft_picks) && (row.payload as any).draft_picks.length > 0
  })));

  // Check if the issue is in the rebuilding logic - count how many leagues have each transaction
  console.log('\n3. Checking if transactions span multiple leagues...');
  const transactionLeagueSpread = await db.execute(sql`
    SELECT
      id,
      COUNT(DISTINCT league_id) as league_count,
      array_agg(DISTINCT league_id) as leagues
    FROM transactions
    WHERE id IN (
      '1089400022141067264',
      '815796378851721216',
      '1157489567117893632',
      '829204071884902400',
      '753367758003146752'
    )
    GROUP BY id
    ORDER BY league_count DESC
  `);

  console.log('Transaction league distribution:');
  console.table(transactionLeagueSpread.rows);

  process.exit(0);
}

checkTransactionDuplicates().catch((error) => {
  console.error('Error checking transaction duplicates:', error);
  process.exit(1);
});