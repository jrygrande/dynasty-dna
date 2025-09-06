import { PrismaClient } from '@prisma/client';
import { sleeperClient } from '../../services/sleeperClient';

const prisma = new PrismaClient();

interface TransactionWithLeague {
  id: string;
  sleeperTransactionId: string;
  leagueId: string;
  sleeperLeagueId: string;
  season: string;
  week: number;
  type: string;
}

/**
 * Fix missing draft pick transaction items
 * 
 * Re-processes all trade transactions to find and create missing
 * draft pick transaction items that were skipped due to roster mapping issues.
 */
async function fixMissingDraftPickItems(): Promise<void> {
  console.log('🔧 Starting fix for missing draft pick transaction items...\n');

  try {
    // Find all trade transactions that might have draft picks
    const tradeTransactions = await prisma.$queryRaw<TransactionWithLeague[]>`
      SELECT t.id, t.sleeperTransactionId, t.leagueId, l.sleeperLeagueId, l.season, t.week, t.type
      FROM transactions t
      JOIN leagues l ON t.leagueId = l.id
      WHERE t.type = 'trade'
      ORDER BY t.timestamp
    `;

    console.log(`📊 Found ${tradeTransactions.length} trade transactions to check\n`);

    let tradesProcessed = 0;
    let tradesWithPicks = 0;
    let draftPickItemsCreated = 0;
    let errorCount = 0;

    // Group by league and week to minimize API calls
    const transactionsByLeagueWeek = tradeTransactions.reduce((acc, txn) => {
      const key = `${txn.sleeperLeagueId}-${txn.week}`;
      if (!acc[key]) {
        acc[key] = {
          sleeperLeagueId: txn.sleeperLeagueId,
          season: txn.season,
          week: txn.week,
          transactions: []
        };
      }
      acc[key].transactions.push(txn);
      return acc;
    }, {} as Record<string, {sleeperLeagueId: string; season: string; week: number; transactions: TransactionWithLeague[]}>);

    console.log(`🏈 Processing ${Object.keys(transactionsByLeagueWeek).length} league-week combinations\n`);

    for (const [key, group] of Object.entries(transactionsByLeagueWeek)) {
      console.log(`🏈 Processing ${group.season} Week ${group.week} (League: ${group.sleeperLeagueId})`);
      console.log(`   📋 ${group.transactions.length} transactions in this week`);

      try {
        // Fetch all transactions for this league and week
        const sleeperTransactions = await sleeperClient.getLeagueTransactions(group.sleeperLeagueId, group.week);
        console.log(`   📥 Fetched ${sleeperTransactions.length} transactions from Sleeper API`);

        for (const transaction of group.transactions) {
          tradesProcessed++;
          
          // Find the matching Sleeper transaction
          const sleeperTransaction = sleeperTransactions.find(
            st => st.transaction_id === transaction.sleeperTransactionId
          );

          if (!sleeperTransaction) {
            console.log(`   ❌ Transaction ${transaction.sleeperTransactionId} not found in Sleeper data`);
            errorCount++;
            continue;
          }

          // Check if this transaction has draft picks
          if (!sleeperTransaction.draft_picks || sleeperTransaction.draft_picks.length === 0) {
            continue; // No draft picks in this transaction
          }

          tradesWithPicks++;
          console.log(`   🎯 ${transaction.sleeperTransactionId}: ${sleeperTransaction.draft_picks.length} draft picks`);

          // Process each draft pick
          for (const pick of sleeperTransaction.draft_picks) {
            console.log(`     📅 ${pick.season} R${pick.round}: Roster ${pick.roster_id} → Roster ${pick.owner_id}`);

            try {
              // Find managers using the now-available roster data
              const originalOwnerManager = await getManagerByRosterIdHistorical(
                transaction.leagueId, pick.roster_id
              );
              const currentOwnerManager = await getManagerByRosterIdHistorical(
                transaction.leagueId, pick.owner_id
              );
              const previousOwnerManager = pick.previous_owner_id 
                ? await getManagerByRosterIdHistorical(transaction.leagueId, pick.previous_owner_id)
                : null;

              if (!originalOwnerManager || !currentOwnerManager) {
                console.log(`     ❌ Could not find managers: original=${pick.roster_id}, current=${pick.owner_id}`);
                errorCount++;
                continue;
              }

              // Find or create the draft pick record
              const draftPick = await prisma.draftPick.upsert({
                where: {
                  leagueId_season_round_originalOwnerId: {
                    leagueId: transaction.leagueId,
                    season: pick.season,
                    round: pick.round,
                    originalOwnerId: originalOwnerManager.id
                  }
                },
                update: {
                  currentOwnerId: currentOwnerManager.id,
                  previousOwnerId: previousOwnerManager?.id || null,
                  traded: true,
                  updatedAt: new Date()
                },
                create: {
                  leagueId: transaction.leagueId,
                  season: pick.season,
                  round: pick.round,
                  originalOwnerId: originalOwnerManager.id,
                  currentOwnerId: currentOwnerManager.id,
                  previousOwnerId: previousOwnerManager?.id || null,
                  traded: true
                }
              });

              // Create transaction items for the draft pick trade
              let itemsCreated = 0;

              // Drop item (who gave up the pick)
              const dropManagerId = previousOwnerManager?.id || originalOwnerManager.id;
              const existingDropItem = await prisma.transactionItem.findFirst({
                where: {
                  transactionId: transaction.id,
                  draftPickId: draftPick.id,
                  type: 'drop'
                }
              });

              if (!existingDropItem) {
                await prisma.transactionItem.create({
                  data: {
                    transactionId: transaction.id,
                    managerId: dropManagerId,
                    draftPickId: draftPick.id,
                    type: 'drop'
                  }
                });
                itemsCreated++;
                draftPickItemsCreated++;
              }

              // Add item (who received the pick)
              const existingAddItem = await prisma.transactionItem.findFirst({
                where: {
                  transactionId: transaction.id,
                  draftPickId: draftPick.id,
                  type: 'add'
                }
              });

              if (!existingAddItem) {
                await prisma.transactionItem.create({
                  data: {
                    transactionId: transaction.id,
                    managerId: currentOwnerManager.id,
                    draftPickId: draftPick.id,
                    type: 'add'
                  }
                });
                itemsCreated++;
                draftPickItemsCreated++;
              }

              if (itemsCreated > 0) {
                console.log(`     ✅ Created ${itemsCreated} transaction items`);
              } else {
                console.log(`     ✅ Items already exist`);
              }

            } catch (pickError) {
              console.error(`     ❌ Error processing pick ${pick.season} R${pick.round}:`, pickError);
              errorCount++;
            }
          }
        }

        // Add small delay between API calls
        await new Promise(resolve => setTimeout(resolve, 300));

      } catch (error) {
        console.error(`   ❌ Error processing league-week ${key}:`, error);
        errorCount++;
      }

      console.log('');
    }

    console.log('='.repeat(80));
    console.log('📋 DRAFT PICK ITEMS FIX SUMMARY');
    console.log('='.repeat(80));
    console.log(`📊 Total trades processed: ${tradesProcessed}`);
    console.log(`🎯 Trades with draft picks: ${tradesWithPicks}`);
    console.log(`✅ Draft pick items created: ${draftPickItemsCreated}`);
    console.log(`❌ Errors encountered: ${errorCount}`);

    // Verify the fix by counting transactions with draft picks
    const tradesWithPickItems = await prisma.$queryRaw<{count: bigint}[]>`
      SELECT COUNT(DISTINCT ti.transactionId) as count
      FROM transaction_items ti 
      WHERE ti.draftPickId IS NOT NULL
    `;

    const finalCount = Number(tradesWithPickItems[0].count);
    console.log(`\n📈 Final count: ${finalCount} transactions now have draft pick items`);

    if (draftPickItemsCreated > 0) {
      console.log('\n🎉 Draft pick transaction items have been restored!');
      console.log('💡 Next run populateTransactionDraftPicks.ts to complete the fix.');
    } else {
      console.log('\n✅ All draft pick transaction items were already present.');
    }

  } catch (error) {
    console.error('❌ Failed to fix missing draft pick items:', error);
    throw error;
  }
}

/**
 * Get manager by roster ID using our historical roster data
 */
async function getManagerByRosterIdHistorical(leagueId: string, rosterId: number) {
  const roster = await prisma.roster.findFirst({
    where: {
      leagueId,
      sleeperRosterId: rosterId
    },
    include: {
      manager: true
    }
  });

  return roster?.manager || null;
}

/**
 * Main execution
 */
async function main() {
  try {
    await fixMissingDraftPickItems();
    process.exit(0);
  } catch (error) {
    console.error('Draft pick items fix failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

export { fixMissingDraftPickItems };