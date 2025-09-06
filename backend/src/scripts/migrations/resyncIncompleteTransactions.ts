import { PrismaClient } from '@prisma/client';
import { sleeperClient } from '../../services/sleeperClient';

const prisma = new PrismaClient();

interface IncompleteTransaction {
  id: string;
  sleeperTransactionId: string;
  leagueId: string;
  sleeperLeagueId: string;
  season: string;
  week: number;
}

/**
 * Re-sync incomplete transactions directly from Sleeper API
 * 
 * This will fetch the actual transaction data from Sleeper and properly
 * process any draft picks that were missed during initial sync.
 */
async function resyncIncompleteTransactions(): Promise<void> {
  console.log('🔄 Starting re-sync of incomplete transactions from Sleeper API...\n');

  try {
    // 1. Get all incomplete transactions with their league info
    const incompleteTransactions = await prisma.$queryRaw<IncompleteTransaction[]>`
      SELECT t.id, t.sleeperTransactionId, t.leagueId, l.sleeperLeagueId, l.season, t.week
      FROM transactions t
      JOIN leagues l ON t.leagueId = l.id
      WHERE t.type = 'trade'
      AND t.id NOT IN (
        SELECT DISTINCT transactionId 
        FROM transaction_items 
        WHERE transactionId IS NOT NULL
      )
      ORDER BY t.timestamp
    `;

    console.log(`📊 Found ${incompleteTransactions.length} incomplete transactions to re-sync\n`);

    if (incompleteTransactions.length === 0) {
      console.log('✅ No incomplete transactions found!');
      return;
    }

    let fixedCount = 0;
    let notFoundCount = 0;
    let errorCount = 0;

    // Group by league and week to minimize API calls
    const transactionsByLeagueAndWeek = incompleteTransactions.reduce((acc, txn) => {
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
    }, {} as Record<string, {sleeperLeagueId: string; season: string; week: number; transactions: IncompleteTransaction[]}>);

    for (const [key, group] of Object.entries(transactionsByLeagueAndWeek)) {
      console.log(`\n🏈 Processing league ${group.sleeperLeagueId} (${group.season} Week ${group.week})...`);
      
      try {
        // Fetch transactions from this league and week
        const sleeperTransactions = await sleeperClient.getLeagueTransactions(group.sleeperLeagueId, group.week);
        
        console.log(`  📥 Fetched ${sleeperTransactions.length} transactions from Sleeper API`);
        
        for (const incompleteTransaction of group.transactions) {
          console.log(`\n  🔍 Processing transaction ${incompleteTransaction.sleeperTransactionId}...`);
          
          // Find the transaction in the Sleeper data
          const sleeperTransaction = sleeperTransactions.find(
            t => t.transaction_id === incompleteTransaction.sleeperTransactionId
          );
          
          if (!sleeperTransaction) {
            console.log(`    ❌ Transaction not found in Sleeper API`);
            notFoundCount++;
            continue;
          }
          
          console.log(`    📋 Found transaction: ${sleeperTransaction.type} with ${sleeperTransaction.draft_picks?.length || 0} draft picks`);
          
          // Process the draft picks from this transaction
          if (sleeperTransaction.draft_picks && sleeperTransaction.draft_picks.length > 0) {
            const itemsCreated = await processDraftPicksFromTransaction(
              incompleteTransaction.leagueId,
              incompleteTransaction.id,
              group.sleeperLeagueId,
              sleeperTransaction.draft_picks
            );
            
            if (itemsCreated > 0) {
              console.log(`    ✅ Created ${itemsCreated} transaction items`);
              fixedCount++;
            } else {
              console.log(`    ⚠️ No transaction items created`);
            }
          } else {
            console.log(`    ⚠️ No draft picks found in transaction`);
          }
        }
        
        // Add delay between leagues to be respectful to API
        await new Promise(resolve => setTimeout(resolve, 500));
        
      } catch (error) {
        console.error(`  ❌ Error processing league ${group.sleeperLeagueId} week ${group.week}:`, error);
        errorCount += group.transactions.length;
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('📋 TRANSACTION RE-SYNC SUMMARY');
    console.log('='.repeat(60));
    console.log(`📊 Total processed: ${incompleteTransactions.length}`);
    console.log(`✅ Successfully fixed: ${fixedCount}`);
    console.log(`❓ Not found in API: ${notFoundCount}`);
    console.log(`❌ Errors: ${errorCount}`);

    if (fixedCount > 0) {
      console.log('\n🎉 Incomplete transactions have been re-synced!');
      console.log('💡 Run validation script to verify all checks now pass.');
    }

  } catch (error) {
    console.error('❌ Failed to re-sync incomplete transactions:', error);
    throw error;
  }
}

/**
 * Process draft picks from a Sleeper transaction and create transaction items
 */
async function processDraftPicksFromTransaction(
  leagueId: string,
  transactionId: string,
  sleeperLeagueId: string,
  draftPicks: any[]
): Promise<number> {
  let itemsCreated = 0;

  for (const pick of draftPicks) {
    console.log(`      📅 ${pick.season} R${pick.round}: ${pick.roster_id} → ${pick.owner_id}`);

    try {
      // Find or create managers
      const originalOwnerManager = await getManagerByRosterId(sleeperLeagueId, pick.roster_id);
      const currentOwnerManager = await getManagerByRosterId(sleeperLeagueId, pick.owner_id);
      const previousOwnerManager = pick.previous_owner_id 
        ? await getManagerByRosterId(sleeperLeagueId, pick.previous_owner_id)
        : null;

      if (!originalOwnerManager || !currentOwnerManager) {
        console.log(`      ❌ Could not find managers: original=${pick.roster_id}, current=${pick.owner_id}`);
        continue;
      }

      // Find or create the draft pick
      const draftPick = await prisma.draftPick.upsert({
        where: {
          leagueId_season_round_originalOwnerId: {
            leagueId,
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
          leagueId,
          season: pick.season,
          round: pick.round,
          originalOwnerId: originalOwnerManager.id,
          currentOwnerId: currentOwnerManager.id,
          previousOwnerId: previousOwnerManager?.id || null,
          traded: true
        }
      });

      // Create drop transaction item (who gave up the pick)
      if (previousOwnerManager) {
        const existingDrop = await prisma.transactionItem.findFirst({
          where: {
            transactionId,
            draftPickId: draftPick.id,
            type: 'drop'
          }
        });

        if (!existingDrop) {
          await prisma.transactionItem.create({
            data: {
              transactionId,
              managerId: previousOwnerManager.id,
              draftPickId: draftPick.id,
              type: 'drop'
            }
          });
          itemsCreated++;
          console.log(`        ➖ Drop item created for roster ${pick.previous_owner_id}`);
        }
      } else if (originalOwnerManager.id !== currentOwnerManager.id) {
        // If no previous owner but different from original, original owner drops
        const existingDrop = await prisma.transactionItem.findFirst({
          where: {
            transactionId,
            draftPickId: draftPick.id,
            type: 'drop'
          }
        });

        if (!existingDrop) {
          await prisma.transactionItem.create({
            data: {
              transactionId,
              managerId: originalOwnerManager.id,
              draftPickId: draftPick.id,
              type: 'drop'
            }
          });
          itemsCreated++;
          console.log(`        ➖ Drop item created for original owner roster ${pick.roster_id}`);
        }
      }

      // Create add transaction item (who received the pick)
      const existingAdd = await prisma.transactionItem.findFirst({
        where: {
          transactionId,
          draftPickId: draftPick.id,
          type: 'add'
        }
      });

      if (!existingAdd) {
        await prisma.transactionItem.create({
          data: {
            transactionId,
            managerId: currentOwnerManager.id,
            draftPickId: draftPick.id,
            type: 'add'
          }
        });
        itemsCreated++;
        console.log(`        ➕ Add item created for roster ${pick.owner_id}`);
      }

    } catch (error) {
      console.error(`      ❌ Error processing pick ${pick.season} R${pick.round}:`, error);
    }
  }

  return itemsCreated;
}

/**
 * Get manager by roster ID in a specific league
 */
async function getManagerByRosterId(leagueId: string, rosterId: number) {
  const rosters = await sleeperClient.getLeagueRosters(leagueId);
  const roster = rosters.find(r => r.roster_id === rosterId);
  
  if (!roster) {
    return null;
  }

  return prisma.manager.findFirst({
    where: { sleeperUserId: roster.owner_id }
  });
}

/**
 * Main execution
 */
async function main() {
  try {
    await resyncIncompleteTransactions();
    process.exit(0);
  } catch (error) {
    console.error('Re-sync failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

export { resyncIncompleteTransactions };