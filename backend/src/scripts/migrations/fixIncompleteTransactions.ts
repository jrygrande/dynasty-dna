import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface IncompleteTransaction {
  id: string;
  sleeperTransactionId: string;
  type: string;
  week: number;
  timestamp: bigint;
  rosterIds: string;
  leagueId: string;
  seasonYear: string;
}

/**
 * Fix incomplete transactions that have no transaction items
 * 
 * These are typically draft pick-only trades from the off-season
 * that were not properly processed during initial data sync.
 */
async function fixIncompleteTransactions(): Promise<void> {
  console.log('🔧 Starting fix for incomplete transactions...\n');

  try {
    // 1. Identify all incomplete transactions
    const incompleteTransactions = await prisma.$queryRaw<IncompleteTransaction[]>`
      SELECT t.id, t.sleeperTransactionId, t.type, t.week, t.timestamp, t.rosterIds, t.leagueId,
             l.season as seasonYear
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

    console.log(`📊 Found ${incompleteTransactions.length} incomplete transactions to fix\n`);

    if (incompleteTransactions.length === 0) {
      console.log('✅ No incomplete transactions found!');
      return;
    }

    let fixedCount = 0;
    let skippedCount = 0;

    for (const transaction of incompleteTransactions) {
      console.log(`\n🔍 Processing transaction ${transaction.sleeperTransactionId} (${transaction.seasonYear} Week ${transaction.week})`);
      
      try {
        const success = await fixSingleTransaction(transaction);
        if (success) {
          fixedCount++;
          console.log(`✅ Fixed transaction ${transaction.sleeperTransactionId}`);
        } else {
          skippedCount++;
          console.log(`⏭️  Skipped transaction ${transaction.sleeperTransactionId} (no draft picks found)`);
        }
      } catch (error) {
        console.error(`❌ Error fixing transaction ${transaction.sleeperTransactionId}:`, error);
        skippedCount++;
      }

      // Add delay to avoid overwhelming database
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log('\n' + '='.repeat(60));
    console.log('📋 INCOMPLETE TRANSACTIONS FIX SUMMARY');
    console.log('='.repeat(60));
    console.log(`📊 Total processed: ${incompleteTransactions.length}`);
    console.log(`✅ Successfully fixed: ${fixedCount}`);
    console.log(`⏭️  Skipped: ${skippedCount}`);
    console.log(`❌ Errors: ${incompleteTransactions.length - fixedCount - skippedCount}`);

    if (fixedCount > 0) {
      console.log('\n🎉 Incomplete transactions have been fixed!');
      console.log('💡 Run validation script to verify all checks now pass.');
    }

  } catch (error) {
    console.error('❌ Failed to fix incomplete transactions:', error);
    throw error;
  }
}

/**
 * Fix a single incomplete transaction by finding associated draft picks
 */
async function fixSingleTransaction(transaction: IncompleteTransaction): Promise<boolean> {
  console.log(`  📅 Season: ${transaction.seasonYear}, Week: ${transaction.week}`);
  console.log(`  👥 Roster IDs: ${transaction.rosterIds}`);

  // Parse roster IDs to see who was involved
  let rosterIds: number[] = [];
  try {
    rosterIds = JSON.parse(transaction.rosterIds || '[]');
  } catch (error) {
    console.log(`  ❌ Could not parse roster IDs: ${transaction.rosterIds}`);
    return false;
  }

  if (rosterIds.length < 2) {
    console.log(`  ❌ Not enough roster IDs for a trade: ${rosterIds.length}`);
    return false;
  }

  console.log(`  👥 Involved rosters: ${rosterIds.join(', ')}`);

  // Find draft picks that were traded around this time involving these rosters
  const timeWindow = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
  const startTime = transaction.timestamp - BigInt(timeWindow);
  const endTime = transaction.timestamp + BigInt(timeWindow);

  // Look for draft picks that changed ownership around this time
  const candidatePicks = await prisma.$queryRaw<any[]>`
    SELECT dp.id, dp.season, dp.round, dp.originalOwnerId, dp.currentOwnerId, dp.previousOwnerId,
           om.sleeperUserId as originalUserId, cm.sleeperUserId as currentUserId, pm.sleeperUserId as previousUserId,
           or1.sleeperRosterId as originalRosterId, or2.sleeperRosterId as currentRosterId, or3.sleeperRosterId as previousRosterId
    FROM draft_picks dp
    JOIN managers om ON dp.originalOwnerId = om.id
    JOIN managers cm ON dp.currentOwnerId = cm.id
    LEFT JOIN managers pm ON dp.previousOwnerId = pm.id
    JOIN rosters or1 ON om.id = or1.managerId AND or1.leagueId = dp.leagueId AND or1.week IS NULL
    JOIN rosters or2 ON cm.id = or2.managerId AND or2.leagueId = dp.leagueId AND or2.week IS NULL
    LEFT JOIN rosters or3 ON pm.id = or3.managerId AND or3.leagueId = dp.leagueId AND or3.week IS NULL
    WHERE dp.leagueId = ${transaction.leagueId}
    AND dp.traded = true
    AND (or1.sleeperRosterId IN (${rosterIds.join(',')}) OR or2.sleeperRosterId IN (${rosterIds.join(',')}))
  `;

  if (candidatePicks.length === 0) {
    console.log(`  ❌ No draft picks found for rosters ${rosterIds.join(', ')} in this timeframe`);
    return false;
  }

  console.log(`  📋 Found ${candidatePicks.length} candidate draft pick(s)`);

  // Create transaction items for the draft picks
  let itemsCreated = 0;

  for (const pick of candidatePicks) {
    console.log(`    📅 ${pick.season} R${pick.round}: ${pick.originalRosterId} → ${pick.currentRosterId}`);

    // Create drop item for previous owner (if different from original)
    if (pick.previousOwnerId && pick.previousRosterId && rosterIds.includes(pick.previousRosterId)) {
      const existingDrop = await prisma.transactionItem.findFirst({
        where: {
          transactionId: transaction.id,
          draftPickId: pick.id,
          type: 'drop'
        }
      });

      if (!existingDrop) {
        await prisma.transactionItem.create({
          data: {
            transactionId: transaction.id,
            managerId: pick.previousOwnerId,
            draftPickId: pick.id,
            type: 'drop'
          }
        });
        itemsCreated++;
        console.log(`    ➖ Created drop item for roster ${pick.previousRosterId}`);
      }
    } else if (pick.originalRosterId !== pick.currentRosterId && rosterIds.includes(pick.originalRosterId)) {
      // If no previous owner but original != current, original owner drops
      const existingDrop = await prisma.transactionItem.findFirst({
        where: {
          transactionId: transaction.id,
          draftPickId: pick.id,
          type: 'drop'
        }
      });

      if (!existingDrop) {
        await prisma.transactionItem.create({
          data: {
            transactionId: transaction.id,
            managerId: pick.originalOwnerId,
            draftPickId: pick.id,
            type: 'drop'
          }
        });
        itemsCreated++;
        console.log(`    ➖ Created drop item for original owner roster ${pick.originalRosterId}`);
      }
    }

    // Create add item for current owner
    if (pick.currentOwnerId && rosterIds.includes(pick.currentRosterId)) {
      const existingAdd = await prisma.transactionItem.findFirst({
        where: {
          transactionId: transaction.id,
          draftPickId: pick.id,
          type: 'add'
        }
      });

      if (!existingAdd) {
        await prisma.transactionItem.create({
          data: {
            transactionId: transaction.id,
            managerId: pick.currentOwnerId,
            draftPickId: pick.id,
            type: 'add'
          }
        });
        itemsCreated++;
        console.log(`    ➕ Created add item for roster ${pick.currentRosterId}`);
      }
    }
  }

  console.log(`  📊 Created ${itemsCreated} transaction items`);
  return itemsCreated > 0;
}

/**
 * Main execution
 */
async function main() {
  try {
    await fixIncompleteTransactions();
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

export { fixIncompleteTransactions };