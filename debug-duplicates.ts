import { getDb } from './src/db/index';
import { transactions, assetEvents } from './src/db/schema';
import { and, eq, inArray, sql } from 'drizzle-orm';

async function investigateDuplicates() {
  const db = await getDb();

  console.log('=== Investigating duplicate pick_trade events ===\n');

  // Find duplicate pick_trade events
  const duplicatePickTrades = await db
    .select({
      transactionId: assetEvents.transactionId,
      leagueId: assetEvents.leagueId,
      pickSeason: assetEvents.pickSeason,
      pickRound: assetEvents.pickRound,
      pickOriginalRosterId: assetEvents.pickOriginalRosterId,
      fromUserId: assetEvents.fromUserId,
      toUserId: assetEvents.toUserId,
      count: sql<number>`count(*)`
    })
    .from(assetEvents)
    .where(eq(assetEvents.eventType, 'pick_trade'))
    .groupBy(
      assetEvents.transactionId,
      assetEvents.leagueId,
      assetEvents.pickSeason,
      assetEvents.pickRound,
      assetEvents.pickOriginalRosterId,
      assetEvents.fromUserId,
      assetEvents.toUserId
    )
    .having(sql`count(*) > 1`);

  console.log(`Found ${duplicatePickTrades.length} groups of duplicate pick_trade events:`);
  duplicatePickTrades.forEach((dup, i) => {
    console.log(`${i + 1}. Transaction: ${dup.transactionId}, League: ${dup.leagueId}, Pick: ${dup.pickSeason}R${dup.pickRound} (orig roster ${dup.pickOriginalRosterId}), Count: ${dup.count}`);
  });

  if (duplicatePickTrades.length > 0) {
    console.log('\n=== Checking corresponding transactions ===\n');

    // Check if the transactions themselves are duplicated
    const transactionIds = duplicatePickTrades.map(d => d.transactionId).filter(Boolean);
    const uniqueTransactionIds = [...new Set(transactionIds)];

    const transactionCounts = await db
      .select({
        id: transactions.id,
        leagueId: transactions.leagueId,
        type: transactions.type,
        count: sql<number>`count(*)`
      })
      .from(transactions)
      .where(inArray(transactions.id, uniqueTransactionIds))
      .groupBy(transactions.id, transactions.leagueId, transactions.type)
      .having(sql`count(*) > 1`);

    if (transactionCounts.length > 0) {
      console.log('Found duplicate transactions:');
      transactionCounts.forEach((tx, i) => {
        console.log(`${i + 1}. Transaction ID: ${tx.id}, League: ${tx.leagueId}, Type: ${tx.type}, Count: ${tx.count}`);
      });
    } else {
      console.log('No duplicate transactions found - the transactions are unique.');
    }

    // Check the transaction payloads for a specific duplicate
    const firstDup = duplicatePickTrades[0];
    if (firstDup.transactionId) {
      console.log(`\n=== Examining transaction ${firstDup.transactionId} ===\n`);

      const txData = await db.select().from(transactions).where(eq(transactions.id, firstDup.transactionId));
      console.log(`Transaction count in DB: ${txData.length}`);

      if (txData.length > 0) {
        const payload = txData[0].payload as any;
        console.log('Transaction payload:', JSON.stringify(payload, null, 2));

        if (payload.draft_picks) {
          console.log(`Draft picks in payload: ${payload.draft_picks.length}`);
          payload.draft_picks.forEach((pick: any, i: number) => {
            console.log(`  Pick ${i + 1}:`, pick);
          });
        }
      }

      // Show all asset events for this transaction
      const allEvents = await db
        .select()
        .from(assetEvents)
        .where(eq(assetEvents.transactionId, firstDup.transactionId));

      console.log(`\nAll asset events for transaction ${firstDup.transactionId}: ${allEvents.length}`);
      allEvents.forEach((event, i) => {
        console.log(`  Event ${i + 1}: ${event.eventType} - ${event.assetKind} - ID: ${event.id}`);
        if (event.eventType === 'pick_trade') {
          console.log(`    Pick: ${event.pickSeason}R${event.pickRound} (orig ${event.pickOriginalRosterId})`);
          console.log(`    From: ${event.fromUserId} -> To: ${event.toUserId}`);
        }
      });
    }
  }
}

investigateDuplicates().catch(console.error);