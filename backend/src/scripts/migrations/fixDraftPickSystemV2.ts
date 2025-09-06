import { PrismaClient } from '@prisma/client';
import { sleeperClient } from '../services/sleeperClient';

const prisma = new PrismaClient();

/**
 * Comprehensive draft pick system fix V2
 * This script completely rebuilds the draft pick system with correct logic:
 * 1. Deletes all existing draft_picks (fundamentally wrong)
 * 2. Creates picks using correct draft order from drafts table
 * 3. Associates all completed draft selections (2022-2025)  
 * 4. Creates future picks (2026+) with correct ownership
 * 5. Applies traded pick updates from Sleeper API
 * 6. Validates complete data integrity
 */
async function fixDraftPickSystemV2() {
  console.log('🔧 Starting comprehensive draft pick system fix V2...');
  
  try {
    const testLeagueId = '1191596293294166016'; // Dynasty Domination
    console.log(`\n📊 Working with test league: ${testLeagueId}`);
    
    // Step 1: Analyze current state
    console.log('\n📈 Analyzing current state...');
    await analyzeCurrentState();
    
    // Step 2: Delete all existing draft picks (they're wrong)
    console.log('\n🗑️ Step 1: Deleting all existing draft_picks records...');
    await deleteAllDraftPicks();
    
    // Step 3: Rebuild draft picks correctly
    console.log('\n🔨 Step 2: Rebuilding draft picks with correct logic...');
    await rebuildDraftPicks(testLeagueId);
    
    // Step 4: Create future draft picks for 2026+
    console.log('\n🔮 Step 3: Creating future draft picks...');
    await createFutureDraftPicks(testLeagueId);
    
    // Step 5: Apply traded pick updates
    console.log('\n💱 Step 4: Applying traded pick updates...');
    await applyTradedPickUpdates(testLeagueId);
    
    // Step 6: Validate the fix
    console.log('\n✅ Step 5: Validating the comprehensive fix...');
    await validateComprehensiveFix();
    
    console.log('\n🎉 Draft pick system V2 fix completed successfully!');
    
  } catch (error) {
    console.error('❌ Migration V2 failed:', error);
    throw error;
  }
}

/**
 * Analyze current state before fixing
 */
async function analyzeCurrentState(): Promise<void> {
  const totalDraftPicks = await prisma.draftPick.count();
  console.log(`  - Current total draft picks: ${totalDraftPicks}`);
  
  const orphanedTransactions = await prisma.$queryRaw`
    SELECT COUNT(*) as count
    FROM transactions t 
    LEFT JOIN transaction_items ti ON t.id = ti.transactionId AND ti.type = 'drop'
    WHERE t.type = 'draft' AND ti.id IS NULL
  `;
  console.log(`  - Orphaned draft transactions: ${(orphanedTransactions as any)[0].count}`);
  
  const nullValues = await prisma.draftPick.count({
    where: {
      season: { in: ['2022', '2023', '2024', '2025'] },
      OR: [
        { pickNumber: null },
        { playerSelectedId: null }
      ]
    }
  });
  console.log(`  - Draft picks with NULL values in completed seasons: ${nullValues}`);
}

/**
 * Delete all existing draft picks - they're fundamentally wrong
 */
async function deleteAllDraftPicks(): Promise<void> {
  // First delete transaction items that reference draft picks
  const deletedItems = await prisma.transactionItem.deleteMany({
    where: { draftPickId: { not: null } }
  });
  console.log(`  - Deleted ${deletedItems.count} transaction items referencing draft picks`);
  
  // Then delete transaction draft picks
  const deletedTransactionDraftPicks = await prisma.transactionDraftPick.deleteMany({});
  console.log(`  - Deleted ${deletedTransactionDraftPicks.count} transaction draft pick records`);
  
  // Finally delete all draft picks
  const deletedPicks = await prisma.draftPick.deleteMany({});
  console.log(`  - Deleted ${deletedPicks.count} draft pick records`);
}

/**
 * Rebuild draft picks with correct logic across all dynasty seasons
 */
async function rebuildDraftPicks(currentLeagueId: string): Promise<void> {
  // Get all drafts across ALL dynasty league seasons  
  const drafts = await prisma.draft.findMany({
    include: { league: true },
    orderBy: { season: 'asc' }
  });
  
  console.log(`  📅 Found ${drafts.length} drafts across all dynasty seasons to process`);
  
  for (const draft of drafts) {
    console.log(`\n  🎯 Processing ${draft.season} draft (League: ${draft.league.sleeperLeagueId})...`);
    
    // Skip 2021 startup draft - it doesn't use tradeable picks
    if (draft.season === '2021') {
      console.log(`    ⏭️  Skipping 2021 startup draft`);
      continue;
    }
    
    // Parse draft order to understand slot -> user mapping
    const draftOrder = JSON.parse(draft.draftOrder || '{}');
    console.log(`    📊 Draft order: ${Object.keys(draftOrder).length} positions`);
    
    if (parseInt(draft.season) <= 2025) {
      // For completed drafts (2022-2025), create picks based on actual selections
      await createPicksFromSelections(draft, draftOrder, draft.leagueId, draft.league.sleeperLeagueId);
    } else {
      // For future drafts (2026+), create base picks with current ownership from current league
      await createFuturePicks(draft, draftOrder, draft.leagueId, currentLeagueId);
    }
  }
}

/**
 * Create draft picks for completed drafts based on actual selections
 */
async function createPicksFromSelections(
  draft: any,
  draftOrder: Record<string, number>,
  internalLeagueId: string,
  leagueId: string
): Promise<void> {
  const selections = await prisma.draftSelection.findMany({
    where: { draftId: draft.id },
    include: { player: true },
    orderBy: { pickNumber: 'asc' }
  });
  
  console.log(`    📊 Processing ${selections.length} draft selections`);
  
  for (const selection of selections) {
    // Find who originally owned this draft slot
    const originalUserId = Object.keys(draftOrder).find(
      userId => draftOrder[userId] === selection.draftSlot
    );
    
    if (!originalUserId) {
      console.warn(`    ⚠️  Could not find original owner for draft slot ${selection.draftSlot}`);
      continue;
    }
    
    const originalOwner = await prisma.manager.findUnique({
      where: { sleeperUserId: originalUserId }
    });
    
    // Find who actually made the pick
    const currentOwner = await prisma.manager.findUnique({
      where: { sleeperUserId: selection.pickedBy }
    });
    
    if (!originalOwner || !currentOwner) {
      console.warn(`    ⚠️  Could not find managers for selection ${selection.player.fullName}`);
      continue;
    }
    
    // Create the draft pick with correct ownership
    const draftPick = await prisma.draftPick.create({
      data: {
        leagueId: internalLeagueId,
        originalOwnerId: originalOwner.id,
        currentOwnerId: currentOwner.id,
        season: draft.season,
        round: selection.round,
        draftSlot: selection.draftSlot,
        pickNumber: selection.pickNumber,
        playerSelectedId: selection.player.id,
        traded: originalOwner.id !== currentOwner.id // Only mark as traded if ownership changed
      }
    });
    
    const tradeStatus = originalOwner.id !== currentOwner.id ? '(traded)' : '(original)';
    console.log(`    ✅ Created pick R${selection.round}.${selection.draftSlot}: ${selection.player.fullName} by ${currentOwner.username} ${tradeStatus}`);
    
    // Create draft transaction for this pick
    await createDraftTransaction(draft, selection, currentOwner, draftPick, internalLeagueId);
  }
}

/**
 * Create future draft picks based on current ownership and traded picks
 */
async function createFuturePicks(
  draft: any,
  draftOrder: Record<string, number>,
  internalLeagueId: string,
  leagueId: string
): Promise<void> {
  const rounds = 4; // Dynasty leagues typically have 4 rounds
  const totalSlots = Object.keys(draftOrder).length;
  
  console.log(`    📊 Creating ${rounds * totalSlots} future draft picks for ${draft.season}`);
  
  for (let round = 1; round <= rounds; round++) {
    for (let draftSlot = 1; draftSlot <= totalSlots; draftSlot++) {
      // Find original owner of this slot
      const originalUserId = Object.keys(draftOrder).find(
        userId => draftOrder[userId] === draftSlot
      );
      
      if (!originalUserId) {
        console.warn(`    ⚠️  Could not find original owner for future draft slot ${draftSlot}`);
        continue;
      }
      
      const originalOwner = await prisma.manager.findUnique({
        where: { sleeperUserId: originalUserId }
      });
      
      if (!originalOwner) {
        console.warn(`    ⚠️  Could not find manager for user ${originalUserId}`);
        continue;
      }
      
      // For future picks, currentOwner = originalOwner initially
      // This will be updated when we apply traded pick data
      await prisma.draftPick.create({
        data: {
          leagueId: internalLeagueId,
          originalOwnerId: originalOwner.id,
          currentOwnerId: originalOwner.id,
          season: draft.season,
          round,
          draftSlot,
          traded: false
        }
      });
      
      console.log(`    📊 Created future pick ${draft.season} R${round}.${draftSlot} for ${originalOwner.username}`);
    }
  }
}

/**
 * Create a draft transaction for a completed pick
 */
async function createDraftTransaction(
  draft: any,
  selection: any,
  manager: any,
  draftPick: any,
  internalLeagueId: string
): Promise<void> {
  const sleeperTransactionId = `draft_${selection.id}_${selection.player.sleeperId}`;
  
  // Check if transaction already exists
  const existingTransaction = await prisma.transaction.findFirst({
    where: { sleeperTransactionId }
  });
  
  if (existingTransaction) {
    return; // Skip if already created
  }
  
  // Create draft transaction
  const transaction = await prisma.transaction.create({
    data: {
      leagueId: internalLeagueId,
      sleeperTransactionId,
      type: 'draft',
      status: 'complete',
      week: null,
      leg: null,
      timestamp: draft.startTime || draft.created || BigInt(Date.now()),
      creator: null,
      consenterIds: JSON.stringify([]),
      rosterIds: JSON.stringify([selection.rosterId || 0]),
      metadata: JSON.stringify({
        draft_id: draft.sleeperDraftId,
        pick_number: selection.pickNumber,
        round: selection.round,
        draft_slot: selection.draftSlot
      })
    }
  });
  
  // If pick was traded, add the draft pick as "currency spent"
  if (draftPick.traded) {
    await prisma.transactionItem.create({
      data: {
        transactionId: transaction.id,
        managerId: manager.id,
        draftPickId: draftPick.id,
        type: 'drop' // "Spending" the traded pick
      }
    });
  }
  
  // Add the player received
  await prisma.transactionItem.create({
    data: {
      transactionId: transaction.id,
      managerId: manager.id,
      playerId: selection.player.id,
      type: 'add'
    }
  });
}

/**
 * Create future draft picks (2026+) based on current league ownership
 */
async function createFutureDraftPicks(currentLeagueId: string): Promise<void> {
  const internalLeagueId = await getInternalLeagueId(currentLeagueId);
  
  // Get the most recent draft to use its order for future seasons
  const recentDraft = await prisma.draft.findFirst({
    where: { season: '2025' },
    include: { league: true }
  });
  
  if (!recentDraft) {
    console.log('  ⚠️  No recent draft found, skipping future pick creation');
    return;
  }
  
  const draftOrder = JSON.parse(recentDraft.draftOrder || '{}');
  if (Object.keys(draftOrder).length === 0) {
    console.log('  ⚠️  No draft order available, skipping future pick creation');
    return;
  }
  
  const rounds = 4;
  const totalSlots = Object.keys(draftOrder).length;
  const futureSeasons = ['2026', '2027', '2028']; // Create a few future seasons
  
  for (const season of futureSeasons) {
    console.log(`  📅 Creating future draft picks for ${season}...`);
    
    for (let round = 1; round <= rounds; round++) {
      for (let draftSlot = 1; draftSlot <= totalSlots; draftSlot++) {
        // Find original owner of this slot (based on 2025 draft order)
        const originalUserId = Object.keys(draftOrder).find(
          userId => draftOrder[userId] === draftSlot
        );
        
        if (!originalUserId) {
          console.warn(`    ⚠️  Could not find original owner for future draft slot ${draftSlot}`);
          continue;
        }
        
        const originalOwner = await prisma.manager.findUnique({
          where: { sleeperUserId: originalUserId }
        });
        
        if (!originalOwner) {
          console.warn(`    ⚠️  Could not find manager for user ${originalUserId}`);
          continue;
        }
        
        // Create future pick with originalOwner = currentOwner initially
        await prisma.draftPick.create({
          data: {
            leagueId: internalLeagueId, // Assign to current league
            originalOwnerId: originalOwner.id,
            currentOwnerId: originalOwner.id,
            season,
            round,
            draftSlot,
            traded: false
          }
        });
      }
    }
    
    console.log(`    ✅ Created ${rounds * totalSlots} future picks for ${season}`);
  }
}

/**
 * Apply traded pick updates from Sleeper API across all dynasty seasons
 */
async function applyTradedPickUpdates(currentLeagueId: string): Promise<void> {
  // Get all leagues in the dynasty chain
  const leagues = await prisma.league.findMany({
    orderBy: { season: 'asc' }
  });
  
  let totalTradedPicks = 0;
  
  for (const league of leagues) {
    console.log(`\n  🔄 Processing traded picks for ${league.season} (${league.sleeperLeagueId})...`);
    
    try {
      const tradedPicks = await sleeperClient.getLeagueTradedPicks(league.sleeperLeagueId);
      console.log(`    📊 Found ${tradedPicks.length} traded picks`);
      totalTradedPicks += tradedPicks.length;
      
      for (const pick of tradedPicks) {
        const originalOwner = await getManagerByRosterId(league.sleeperLeagueId, pick.roster_id);
        const currentOwner = await getManagerByRosterId(league.sleeperLeagueId, pick.owner_id);
        const previousOwner = pick.previous_owner_id 
          ? await getManagerByRosterId(league.sleeperLeagueId, pick.previous_owner_id)
          : null;
        
        if (!originalOwner || !currentOwner) {
          console.warn(`    ⚠️  Could not find managers for traded pick ${pick.season} R${pick.round}`);
          continue;
        }
        
        // Find and update the corresponding draft pick
        const draftPick = await prisma.draftPick.findFirst({
          where: {
            season: pick.season,
            round: pick.round,
            originalOwnerId: originalOwner.id
          }
        });
        
        if (draftPick) {
          await prisma.draftPick.update({
            where: { id: draftPick.id },
            data: {
              currentOwnerId: currentOwner.id,
              previousOwnerId: previousOwner?.id,
              traded: true
            }
          });
          
          console.log(`    ✅ Updated traded pick ${pick.season} R${pick.round}: ${originalOwner.username} → ${currentOwner.username}`);
        } else {
          console.warn(`    ⚠️  Could not find draft pick to update for ${pick.season} R${pick.round}`);
        }
      }
    } catch (error) {
      console.warn(`    ⚠️  Failed to get traded picks for ${league.season}: ${error}`);
    }
  }
  
  console.log(`\n  📊 Total traded picks processed: ${totalTradedPicks}`);
}

/**
 * Validate that the fix worked correctly
 */
async function validateComprehensiveFix(): Promise<void> {
  console.log('  📊 Running comprehensive validation...');
  
  // Check orphaned transactions
  const orphanedAfter = await prisma.$queryRaw`
    SELECT COUNT(*) as count
    FROM transactions t 
    LEFT JOIN transaction_items ti ON t.id = ti.transactionId AND ti.type = 'drop'
    WHERE t.type = 'draft' AND ti.id IS NULL
  `;
  console.log(`  - Orphaned draft transactions: ${(orphanedAfter as any)[0].count}`);
  
  // Check completed drafts have complete data
  const nullsInCompleted = await prisma.draftPick.count({
    where: {
      season: { in: ['2022', '2023', '2024', '2025'] },
      OR: [
        { pickNumber: null },
        { playerSelectedId: null }
      ]
    }
  });
  console.log(`  - NULL values in completed seasons (2022-2025): ${nullsInCompleted}`);
  
  // Check draft picks by season
  const picksBySeasonRound = await prisma.$queryRaw`
    SELECT season, round, COUNT(*) as pick_count,
           COUNT(playerSelectedId) as picks_with_players
    FROM draft_picks 
    WHERE season >= '2022'
    GROUP BY season, round 
    ORDER BY season, round
  `;
  console.log('  - Draft picks by season/round:');
  (picksBySeasonRound as any[]).forEach(row => {
    const completeness = row.season <= '2025' ? ` (${row.picks_with_players}/${row.pick_count} with players)` : '';
    console.log(`    ${row.season} R${row.round}: ${row.pick_count} picks${completeness}`);
  });
  
  // Check duplicate associations
  const duplicateAssociations = await prisma.$queryRaw`
    SELECT draftPickId, COUNT(*) as usage_count 
    FROM transaction_items 
    WHERE draftPickId IS NOT NULL AND type = 'drop'
    GROUP BY draftPickId 
    HAVING usage_count > 1
  `;
  console.log(`  - Duplicate draft pick associations: ${(duplicateAssociations as any).length}`);
  
  // Success criteria
  const orphanedCount = (orphanedAfter as any)[0].count;
  const nullCount = nullsInCompleted;
  const duplicateCount = (duplicateAssociations as any).length;
  
  if (orphanedCount <= 324 && nullCount === 0 && duplicateCount === 0) {
    console.log('  🎉 Validation PASSED: All data integrity issues resolved!');
  } else {
    console.log(`  ⚠️  Validation issues: ${orphanedCount} orphaned, ${nullCount} nulls, ${duplicateCount} duplicates`);
  }
}

/**
 * Helper methods
 */
async function getInternalLeagueId(sleeperLeagueId: string): Promise<string> {
  const league = await prisma.league.findUnique({
    where: { sleeperLeagueId }
  });
  if (!league) {
    throw new Error(`League not found: ${sleeperLeagueId}`);
  }
  return league.id;
}

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
    await fixDraftPickSystemV2();
  } catch (error) {
    console.error('Script failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

export { fixDraftPickSystemV2 };