#!/usr/bin/env npx tsx

import { config } from 'dotenv';
config(); // Load environment variables from .env file

import { getDb } from './src/db';
import { transactions, assetEvents } from './src/db/schema';
import { eq, and } from 'drizzle-orm';

async function examineTransaction() {
  const db = await getDb();

  // Pick one of the problematic transaction IDs
  const transactionId = '1089400022141067264';

  console.log(`=== Examining transaction ${transactionId} ===\n`);

  // Get the transaction data
  const txData = await db.select().from(transactions).where(eq(transactions.id, transactionId));

  if (txData.length === 0) {
    console.log('Transaction not found');
    return;
  }

  const tx = txData[0];
  console.log('Transaction details:');
  console.log(`  ID: ${tx.id}`);
  console.log(`  League: ${tx.leagueId}`);
  console.log(`  Type: ${tx.type}`);
  console.log(`  Week: ${tx.week}`);

  const payload = tx.payload as any;
  console.log('\nPayload:');
  console.log(JSON.stringify(payload, null, 2));

  if (payload.draft_picks && Array.isArray(payload.draft_picks)) {
    console.log(`\nDraft picks in payload: ${payload.draft_picks.length}`);
    payload.draft_picks.forEach((pick: any, i: number) => {
      console.log(`  Pick ${i + 1}:`, JSON.stringify(pick, null, 4));
    });

    // Check for potential duplicates within the payload itself
    const pickKeys = payload.draft_picks.map((p: any) => `${p.season}-${p.round}-${p.roster_id || p.roster || 'unknown'}-${p.owner_id || 'unknown'}-${p.previous_owner_id || 'unknown'}`);
    const uniquePickKeys = new Set(pickKeys);

    if (pickKeys.length !== uniquePickKeys.size) {
      console.log('\n❌ FOUND DUPLICATE PICKS IN PAYLOAD!');
      console.log('Pick keys:', pickKeys);
      console.log('Unique pick keys:', Array.from(uniquePickKeys));
    } else {
      console.log('\n✅ No duplicate picks in payload');
    }
  } else {
    console.log('\nNo draft_picks in payload');
  }

  // Check current asset events for this transaction
  console.log('\n=== Current asset events for this transaction ===');
  const currentEvents = await db.select().from(assetEvents).where(eq(assetEvents.transactionId, transactionId));

  console.log(`Total events: ${currentEvents.length}`);
  const pickTradeEvents = currentEvents.filter(e => e.eventType === 'pick_trade');
  console.log(`Pick trade events: ${pickTradeEvents.length}`);

  pickTradeEvents.forEach((event, i) => {
    console.log(`  Pick trade ${i + 1}:`);
    console.log(`    ID: ${event.id}`);
    console.log(`    Pick: ${event.pickSeason}R${event.pickRound} (orig roster ${event.pickOriginalRosterId})`);
    console.log(`    From: ${event.fromUserId} -> To: ${event.toUserId}`);
    console.log(`    Details: ${JSON.stringify(event.details)}`);
  });

  // Check for duplicates among the events
  if (pickTradeEvents.length > 1) {
    const eventKeys = pickTradeEvents.map(e => `${e.pickSeason}-${e.pickRound}-${e.pickOriginalRosterId}-${e.fromUserId}-${e.toUserId}`);
    const uniqueEventKeys = new Set(eventKeys);

    if (eventKeys.length !== uniqueEventKeys.size) {
      console.log('\n❌ FOUND DUPLICATE PICK TRADE EVENTS!');
      console.log('Event keys:', eventKeys);
      console.log('Unique event keys:', Array.from(uniqueEventKeys));
    } else {
      console.log('\n✅ No duplicate pick trade events found');
    }
  }
}

examineTransaction().catch(console.error);