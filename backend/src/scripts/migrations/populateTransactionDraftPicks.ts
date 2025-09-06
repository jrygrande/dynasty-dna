import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Populate TransactionDraftPick table
 * 
 * This table provides direct links between transactions and the specific
 * draft picks involved, making it easier to query and visualize trade chains.
 */
async function populateTransactionDraftPicks(): Promise<void> {
  console.log('📊 Starting TransactionDraftPick population...\n');

  try {
    // First, clear existing data
    const deletedCount = await prisma.transactionDraftPick.deleteMany({});
    console.log(`🧹 Cleared ${deletedCount.count} existing TransactionDraftPick records\n`);

    // Get all transaction items that involve draft picks
    const draftPickItems = await prisma.transactionItem.findMany({
      where: {
        draftPickId: { not: null }
      },
      include: {
        transaction: {
          include: {
            league: true
          }
        },
        draftPick: true,
        manager: true
      },
      orderBy: [
        { transaction: { timestamp: 'asc' } },
        { transactionId: 'asc' }
      ]
    });

    console.log(`📋 Found ${draftPickItems.length} transaction items with draft picks\n`);

    // Group by transaction ID to process each transaction once
    const transactionGroups = draftPickItems.reduce((acc, item) => {
      const txnId = item.transactionId;
      if (!acc[txnId]) {
        acc[txnId] = {
          transaction: item.transaction,
          items: []
        };
      }
      acc[txnId].items.push(item);
      return acc;
    }, {} as Record<string, { transaction: any; items: typeof draftPickItems }>);

    console.log(`🏈 Processing ${Object.keys(transactionGroups).length} transactions with draft picks\n`);

    let recordsCreated = 0;
    let transactionsProcessed = 0;

    for (const [transactionId, group] of Object.entries(transactionGroups)) {
      transactionsProcessed++;
      const { transaction, items } = group;

      console.log(`🎯 ${transaction.sleeperTransactionId} (${transaction.league.season}): ${items.length} draft pick items`);

      // Group items by draft pick to handle add/drop pairs
      const pickGroups = items.reduce((acc, item) => {
        const pickId = item.draftPickId!;
        if (!acc[pickId]) {
          acc[pickId] = {
            draftPick: item.draftPick,
            adds: [],
            drops: []
          };
        }
        if (item.type === 'add') {
          acc[pickId].adds.push(item);
        } else if (item.type === 'drop') {
          acc[pickId].drops.push(item);
        }
        return acc;
      }, {} as Record<string, { draftPick: any; adds: any[]; drops: any[] }>);

      for (const [pickId, pickGroup] of Object.entries(pickGroups)) {
        const { draftPick, adds, drops } = pickGroup;
        
        // Determine the key participants
        const addManager = adds[0]?.manager;
        const dropManager = drops[0]?.manager;

        // Find roster IDs from manager-roster associations
        const addManagerRoster = await prisma.roster.findFirst({
          where: {
            leagueId: transaction.leagueId,
            managerId: addManager?.id
          }
        });

        const dropManagerRoster = await prisma.roster.findFirst({
          where: {
            leagueId: transaction.leagueId,
            managerId: dropManager?.id
          }
        });

        // Create TransactionDraftPick record
        const transactionDraftPick = await prisma.transactionDraftPick.create({
          data: {
            transactionId: transaction.id,
            draftPickId: draftPick.id,
            season: draftPick.season,
            round: draftPick.round,
            rosterId: dropManagerRoster?.sleeperRosterId || draftPick.originalOwnerId,
            ownerId: addManagerRoster?.sleeperRosterId || draftPick.currentOwnerId,
            previousOwnerId: dropManagerRoster?.sleeperRosterId || null
          }
        });

        recordsCreated++;
        console.log(`   📅 Created: ${draftPick.season} R${draftPick.round} (${dropManagerRoster?.sleeperRosterId || '?'} → ${addManagerRoster?.sleeperRosterId || '?'})`);
      }

      console.log('');
    }

    console.log('='.repeat(80));
    console.log('📋 TRANSACTION DRAFT PICKS POPULATION SUMMARY');
    console.log('='.repeat(80));
    console.log(`📊 Transactions processed: ${transactionsProcessed}`);
    console.log(`✅ TransactionDraftPick records created: ${recordsCreated}`);

    // Verify the population
    const finalCount = await prisma.transactionDraftPick.count();
    console.log(`📈 Final TransactionDraftPick count: ${finalCount}`);

    // Show some sample data
    const sampleRecords = await prisma.transactionDraftPick.findMany({
      take: 5,
      include: {
        transaction: {
          select: {
            sleeperTransactionId: true,
            league: { select: { season: true } }
          }
        },
        draftPick: {
          include: {
            originalOwner: { select: { username: true } },
            currentOwner: { select: { username: true } }
          }
        }
      },
      orderBy: {
        transaction: { timestamp: 'desc' }
      }
    });

    console.log('\n📋 Sample TransactionDraftPick records:');
    sampleRecords.forEach(record => {
      console.log(`   ${record.transaction.sleeperTransactionId} (${record.transaction.league.season}): ${record.season} R${record.round}`);
      console.log(`     ${record.draftPick.originalOwner.username} → ${record.draftPick.currentOwner.username}`);
    });

    if (recordsCreated > 0) {
      console.log('\n🎉 TransactionDraftPick table has been populated!');
      console.log('💡 Draft pick transaction chains are now fully trackable.');
    } else {
      console.log('\n✅ No new TransactionDraftPick records needed.');
    }

  } catch (error) {
    console.error('❌ Failed to populate TransactionDraftPick table:', error);
    throw error;
  }
}

/**
 * Main execution
 */
async function main() {
  try {
    await populateTransactionDraftPicks();
    process.exit(0);
  } catch (error) {
    console.error('TransactionDraftPick population failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

export { populateTransactionDraftPicks };