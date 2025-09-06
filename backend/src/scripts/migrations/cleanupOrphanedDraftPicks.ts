import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Clean up orphaned draft picks in completed seasons
 * 
 * These are picks that were traded to future seasons but the draft
 * has already completed, making these picks effectively non-existent.
 */
async function cleanupOrphanedDraftPicks(): Promise<void> {
  console.log('🧹 Starting cleanup of orphaned draft picks in completed seasons...\n');

  try {
    // 1. Identify orphaned picks in completed seasons (2022-2025)
    // These are picks without player selections in seasons where drafts are complete
    const completedSeasons = ['2022', '2023', '2024', '2025'];
    
    for (const season of completedSeasons) {
      console.log(`📅 Checking season ${season}...`);
      
      // Check if this season has a completed draft
      const draftSelections = await prisma.draftSelection.count({
        where: {
          draft: {
            season
          }
        }
      });
      
      console.log(`  📊 Found ${draftSelections} draft selections for ${season}`);
      
      if (draftSelections >= 48) { // 4 rounds × 12 teams = full draft
        // Find unselected picks in this completed season
        const orphanedPicks = await prisma.draftPick.findMany({
          where: {
            season,
            playerSelectedId: null
          },
          include: {
            originalOwner: { select: { username: true } },
            currentOwner: { select: { username: true } }
          }
        });
        
        console.log(`  🗑️  Found ${orphanedPicks.length} orphaned picks in ${season}`);
        
        if (orphanedPicks.length > 0) {
          console.log('    📋 Orphaned picks:');
          orphanedPicks.forEach(pick => {
            console.log(`      - ${season} R${pick.round} (slot ${pick.draftSlot || 'N/A'}): ${pick.originalOwner.username} → ${pick.currentOwner.username}`);
          });
          
          // Check if these picks are involved in any transactions
          const pickIds = orphanedPicks.map(p => p.id);
          const transactionItems = await prisma.transactionItem.findMany({
            where: { draftPickId: { in: pickIds } },
            include: { transaction: { select: { sleeperTransactionId: true } } }
          });
          
          if (transactionItems.length > 0) {
            console.log(`    ⚠️  WARNING: ${transactionItems.length} transaction items reference these picks`);
            console.log('    🔄 Cleaning up transaction items first...');
            
            await prisma.transactionItem.deleteMany({
              where: { draftPickId: { in: pickIds } }
            });
            
            console.log(`    ✅ Deleted ${transactionItems.length} transaction items`);
          }
          
          // Delete the orphaned picks
          const deleteResult = await prisma.draftPick.deleteMany({
            where: { id: { in: pickIds } }
          });
          
          console.log(`    ✅ Deleted ${deleteResult.count} orphaned draft picks from ${season}`);
        } else {
          console.log(`    ✅ No orphaned picks found in ${season}`);
        }
      } else {
        console.log(`    ⏭️  Skipping ${season} - draft not complete (only ${draftSelections} selections)`);
      }
      
      console.log('');
    }

    console.log('='.repeat(60));
    console.log('📋 ORPHANED DRAFT PICKS CLEANUP SUMMARY');
    console.log('='.repeat(60));
    console.log('✅ Cleanup completed successfully');
    console.log('💡 Run validation script to verify all checks now pass.');

  } catch (error) {
    console.error('❌ Failed to cleanup orphaned draft picks:', error);
    throw error;
  }
}

/**
 * Main execution
 */
async function main() {
  try {
    await cleanupOrphanedDraftPicks();
    process.exit(0);
  } catch (error) {
    console.error('Cleanup failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

export { cleanupOrphanedDraftPicks };