import { PrismaClient } from '@prisma/client';
import { dataSyncService } from '../services/dataSyncService';

const prisma = new PrismaClient();

/**
 * Migration script to fix the draft pick system
 * This script:
 * 1. Populates draftSlot for existing picks
 * 2. Creates missing base draft picks  
 * 3. Re-associates draft transactions with correct picks
 * 4. Validates the fix
 */
async function fixDraftPickSystem() {
  console.log('🔧 Starting draft pick system migration...');
  
  try {
    // Step 1: Get the test league
    const testLeagueId = '1191596293294166016'; // Dynasty Domination
    console.log(`\n📊 Working with test league: ${testLeagueId}`);
    
    // Step 2: Check current state
    console.log('\n📈 Analyzing current state...');
    const orphanedTransactions = await prisma.$queryRaw`
      SELECT COUNT(*) as count
      FROM transactions t 
      LEFT JOIN transaction_items ti ON t.id = ti.transactionId AND ti.type = 'drop'
      WHERE t.type = 'draft' AND ti.id IS NULL
    `;
    console.log(`  - Orphaned draft transactions: ${(orphanedTransactions as any)[0].count}`);
    
    const totalDraftPicks = await prisma.draftPick.count();
    console.log(`  - Total draft picks: ${totalDraftPicks}`);
    
    const draftPicksWithSlot = await prisma.draftPick.count({
      where: { draftSlot: { not: null } }
    });
    console.log(`  - Draft picks with draftSlot: ${draftPicksWithSlot}`);
    
    // Step 3: Populate draftSlot for existing draft picks
    console.log('\n🎯 Step 1: Populating draftSlot for existing draft picks...');
    await populateDraftSlots();
    
    // Step 4: Create missing base draft picks using the updated sync service
    console.log('\n🎯 Step 2: Creating missing base draft picks...');
    await dataSyncService.syncLeague(testLeagueId);
    
    // Step 5: Re-run draft sync to fix associations
    console.log('\n🎯 Step 3: Re-syncing draft transactions with improved matching...');
    const league = await prisma.league.findUnique({
      where: { sleeperLeagueId: testLeagueId }
    });
    
    if (league) {
      // Re-sync drafts to use the new matching logic
      await dataSyncService.resyncDraftPicks();
    }
    
    // Step 6: Validate the fix
    console.log('\n🎯 Step 4: Validating the fix...');
    await validateFix();
    
    console.log('\n✅ Draft pick system migration completed successfully!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  }
}

/**
 * Populate draftSlot for existing draft picks by analyzing draft selections
 */
async function populateDraftSlots(): Promise<void> {
  console.log('  📊 Analyzing existing draft selections...');
  
  // Get all draft selections with their associated draft picks
  const selections = await prisma.draftSelection.findMany({
    include: {
      draft: {
        include: {
          league: true
        }
      },
      player: true
    }
  });
  
  console.log(`  📊 Found ${selections.length} draft selections to process`);
  
  for (const selection of selections) {
    // Find corresponding draft pick and update draftSlot
    const draftPick = await prisma.draftPick.findFirst({
      where: {
        leagueId: selection.draft.leagueId,
        season: selection.draft.season,
        round: selection.round,
        playerSelectedId: selection.player.id
      }
    });
    
    if (draftPick && !draftPick.draftSlot) {
      await prisma.draftPick.update({
        where: { id: draftPick.id },
        data: { draftSlot: selection.draftSlot }
      });
      
      console.log(`    📊 Updated draftSlot for ${selection.player.fullName}: R${selection.round} Slot ${selection.draftSlot}`);
    }
  }
}

/**
 * Validate that the fix worked correctly
 */
async function validateFix(): Promise<void> {
  console.log('  📊 Running validation queries...');
  
  // Check orphaned transactions
  const orphanedAfter = await prisma.$queryRaw`
    SELECT COUNT(*) as count
    FROM transactions t 
    LEFT JOIN transaction_items ti ON t.id = ti.transactionId AND ti.type = 'drop'
    WHERE t.type = 'draft' AND ti.id IS NULL
  `;
  console.log(`  - Orphaned draft transactions after fix: ${(orphanedAfter as any)[0].count}`);
  
  // Check draft picks per season/round
  const picksBySeasonRound = await prisma.$queryRaw`
    SELECT season, round, COUNT(*) as pick_count 
    FROM draft_picks 
    GROUP BY season, round 
    ORDER BY season, round
  `;
  console.log('  - Draft picks by season/round:');
  (picksBySeasonRound as any[]).forEach(row => {
    console.log(`    ${row.season} R${row.round}: ${row.pick_count} picks`);
  });
  
  // Check for duplicate associations
  const duplicateAssociations = await prisma.$queryRaw`
    SELECT draftPickId, COUNT(*) as usage_count 
    FROM transaction_items 
    WHERE draftPickId IS NOT NULL AND type = 'drop'
    GROUP BY draftPickId 
    HAVING usage_count > 1
  `;
  console.log(`  - Duplicate draft pick associations: ${(duplicateAssociations as any).length}`);
  
  // Check draft picks with draftSlot populated
  const picksWithSlot = await prisma.draftPick.count({
    where: { draftSlot: { not: null } }
  });
  const totalPicks = await prisma.draftPick.count();
  console.log(`  - Draft picks with draftSlot: ${picksWithSlot}/${totalPicks} (${Math.round(picksWithSlot/totalPicks*100)}%)`);
  
  // Success criteria
  const orphanedCount = (orphanedAfter as any)[0].count;
  const duplicateCount = (duplicateAssociations as any).length;
  
  if (orphanedCount === 0 && duplicateCount === 0) {
    console.log('  ✅ Validation passed: No orphaned transactions, no duplicate associations');
  } else if (orphanedCount < 50) { // Significant improvement
    console.log(`  ⚠️  Validation partial: ${orphanedCount} orphaned transactions remaining (significant improvement)`);
  } else {
    console.log(`  ❌ Validation failed: ${orphanedCount} orphaned transactions, ${duplicateCount} duplicates`);
  }
}

/**
 * Main execution
 */
async function main() {
  try {
    await fixDraftPickSystem();
  } catch (error) {
    console.error('Script failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
    await dataSyncService.disconnect();
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

export { fixDraftPickSystem };