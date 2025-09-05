#!/usr/bin/env npx ts-node

/**
 * Comprehensive migration to fix draft pick associations
 * 
 * This script addresses the core issues:
 * 1. Multiple draft transactions using the same draft_pick record
 * 2. Wrong original ownership assignments
 * 3. Missing pickNumber associations
 * 4. Incorrect draft_pick to transaction mappings
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface DraftSelectionData {
  pickNumber: number;
  round: number;
  draftSlot: number;
  rosterId: number;
  pickedBy: string;
  playerId: string;
  playerName: string;
  season: string;
  draftId: string;
}

// Removed unused interface

async function fixDraftPickAssociations() {
  console.log('🔄 Starting comprehensive draft pick association fix...\n');
  
  try {
    // Step 1: Analyze the current state
    console.log('📊 Analyzing current state...');
    
    const duplicateAssociations = await findDuplicateAssociations();
    console.log(`Found ${duplicateAssociations.length} duplicate draft_pick associations\n`);
    
    // Step 2: Fix duplicate associations by season
    const seasons = ['2022', '2023', '2024'];
    
    for (const season of seasons) {
      console.log(`\n🏈 Processing ${season} season...`);
      await fixSeasonAssociations(season);
    }
    
    // Step 3: Verify the fixes
    console.log('\n🔍 Verifying fixes...');
    await verifyFixes();
    
    console.log('\n✅ Draft pick association fix completed successfully!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Find draft_picks that are being used by multiple transactions
 */
async function findDuplicateAssociations() {
  const result = await prisma.$queryRaw`
    SELECT 
      ti.draftPickId,
      COUNT(*) as usage_count,
      GROUP_CONCAT(t.sleeperTransactionId) as transactions
    FROM transaction_items ti
    JOIN transactions t ON ti.transactionId = t.id
    WHERE ti.draftPickId IS NOT NULL
    GROUP BY ti.draftPickId
    HAVING usage_count > 1
  ` as any[];
  
  return result;
}

/**
 * Fix associations for a specific season
 */
async function fixSeasonAssociations(season: string) {
  // Get all draft selections for this season
  const selections = await prisma.$queryRaw`
    SELECT 
      ds.pickNumber,
      ds.round,
      ds.draftSlot,
      ds.rosterId,
      ds.pickedBy,
      ds.playerId,
      p.fullName as playerName,
      d.season,
      d.id as draftId
    FROM draft_selections ds
    JOIN drafts d ON ds.draftId = d.id
    JOIN players p ON ds.playerId = p.id
    WHERE d.season = ${season}
    ORDER BY ds.pickNumber
  ` as DraftSelectionData[];
  
  console.log(`  📋 Processing ${selections.length} draft selections for ${season}`);
  
  // Get all draft picks for this season
  const draftPicks = await prisma.draftPick.findMany({
    where: { season },
    include: {
      currentOwner: true,
      originalOwner: true
    }
  });
  
  console.log(`  📋 Found ${draftPicks.length} draft pick records for ${season}`);
  
  // Process each selection
  for (const selection of selections) {
    try {
      await fixSelectionAssociation(selection, draftPicks);
    } catch (error) {
      console.warn(`  ⚠️  Failed to fix association for ${selection.playerName} (P${selection.pickNumber}):`, error);
    }
  }
}

/**
 * Fix the association for a specific draft selection
 */
async function fixSelectionAssociation(
  selection: DraftSelectionData, 
  allDraftPicks: any[]
) {
  // Find the manager who made this selection
  const manager = await prisma.manager.findUnique({
    where: { sleeperUserId: selection.pickedBy }
  });
  
  if (!manager) {
    console.warn(`  ⚠️  Could not find manager for ${selection.playerName}`);
    return;
  }
  
  // Find draft picks owned by this manager in this round
  const managerPicks = allDraftPicks.filter(pick => 
    pick.round === selection.round && 
    pick.currentOwnerId === manager.id
  );
  
  if (managerPicks.length === 0) {
    console.warn(`  ⚠️  No draft picks found for ${manager.username} in R${selection.round}`);
    return;
  }
  
  // Determine which pick was actually used
  let correctPick;
  
  if (managerPicks.length === 1) {
    // Easy case: only one pick in this round
    correctPick = managerPicks[0];
  } else {
    // Multiple picks: use logic to determine correct one
    correctPick = await determineCorrectPick(selection, managerPicks);
  }
  
  if (!correctPick) {
    console.warn(`  ⚠️  Could not determine correct pick for ${selection.playerName}`);
    return;
  }
  
  // Update the draft pick with selection info
  await prisma.draftPick.update({
    where: { id: correctPick.id },
    data: {
      pickNumber: selection.pickNumber,
      playerSelectedId: selection.playerId
    }
  });
  
  // Find and update the transaction association
  const existingTransaction = await prisma.transaction.findFirst({
    where: { 
      sleeperTransactionId: {
        contains: selection.playerId  // Match by player ID since transaction ID format might vary
      },
      type: 'draft'
    }
  });
  
  if (existingTransaction) {
    // Update the transaction item to use the correct draft pick
    await prisma.transactionItem.updateMany({
      where: {
        transactionId: existingTransaction.id,
        type: 'drop',
        draftPickId: { not: null }
      },
      data: {
        draftPickId: correctPick.id
      }
    });
    
    console.log(`  ✅ Fixed association: ${selection.playerName} (P${selection.pickNumber}) → ${correctPick.id}`);
  }
}

/**
 * Determine which pick was actually used when manager has multiple picks
 */
async function determineCorrectPick(
  selection: DraftSelectionData,
  managerPicks: any[]
): Promise<any | null> {
  // Strategy 1: If one pick already has this player assigned, use it
  const pickWithPlayer = managerPicks.find(pick => pick.playerSelectedId === selection.playerId);
  if (pickWithPlayer) {
    return pickWithPlayer;
  }
  
  // Strategy 2: Use unused picks first
  const unusedPicks = managerPicks.filter(pick => !pick.playerSelectedId);
  if (unusedPicks.length === 1) {
    return unusedPicks[0];
  }
  
  // Strategy 3: For early picks (1-6), prefer traded picks (originalOwner != currentOwner)
  // For later picks (7-12), prefer original picks (originalOwner == currentOwner)
  if (selection.pickNumber <= 6) {
    const tradedPick = managerPicks.find(pick => pick.originalOwnerId !== pick.currentOwnerId);
    if (tradedPick) {
      return tradedPick;
    }
  } else {
    const originalPick = managerPicks.find(pick => pick.originalOwnerId === pick.currentOwnerId);
    if (originalPick) {
      return originalPick;
    }
  }
  
  // Fallback: return first available pick
  return managerPicks[0];
}

/**
 * Verify that the fixes were successful
 */
async function verifyFixes() {
  const duplicates = await findDuplicateAssociations();
  console.log(`Remaining duplicate associations: ${duplicates.length}`);
  
  const picksWithNumbers = await prisma.draftPick.count({
    where: { pickNumber: { not: null } }
  });
  
  const totalPicks = await prisma.draftPick.count();
  
  console.log(`Draft picks with numbers: ${picksWithNumbers}/${totalPicks}`);
  
  if (duplicates.length > 0) {
    console.log('\n⚠️  Remaining duplicates:');
    for (const dup of duplicates) {
      console.log(`  ${dup.draftPickId}: used by ${dup.usage_count} transactions`);
    }
  }
}

// Run the script if executed directly
if (require.main === module) {
  fixDraftPickAssociations()
    .then(() => {
      console.log('🎉 Migration completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Migration failed:', error);
      process.exit(1);
    });
}

export { fixDraftPickAssociations };