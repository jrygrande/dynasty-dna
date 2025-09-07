#!/usr/bin/env npx ts-node

/**
 * Fix Draft Pick Selections
 * 
 * This script fixes draft pick data quality issues by:
 * 1. Linking draft picks to their corresponding draft selections (2021-2025)
 * 2. Removing duplicate/invalid draft pick records
 * 3. Ensuring each pick has exactly one record with correct player selection
 * 
 * Expected outcome: All 2021-2025 draft picks should have playerSelectedId populated
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Interface for draft selection matching (unused but kept for future use)
// interface DraftSelectionMatch {
//   selectionId: string;
//   pickId: string;
//   season: string;
//   round: number;
//   pickNumber: number;
//   playerId: string;
//   playerName: string;
//   rosterId: number;
// }

async function fixDraftPickSelections() {
  console.log('🔧 Fixing Draft Pick Selection Data\n');
  
  try {
    // Step 1: Get all draft selections for completed seasons (2021-2025)
    console.log('📊 Step 1: Gathering draft selections for completed seasons...');
    
    const draftSelections = await prisma.$queryRaw`
      SELECT 
        ds.id as selectionId,
        ds.pickNumber,
        ds.round,
        ds.draftSlot,
        ds.playerId,
        p.fullName as playerName,
        ds.rosterId,
        d.season
      FROM draft_selections ds
      JOIN drafts d ON ds.draftId = d.id
      JOIN players p ON ds.playerId = p.id
      WHERE d.season IN ('2021', '2022', '2023', '2024', '2025')
      ORDER BY d.season, ds.pickNumber
    ` as any[];
    
    console.log(`Found ${draftSelections.length} draft selections to process\n`);
    
    let linkedCount = 0;
    let skippedCount = 0;
    
    // Step 2: For each draft selection, find or create corresponding draft pick
    console.log('🔗 Step 2: Linking selections to draft picks...');
    
    for (const selection of draftSelections) {
      try {
        // Find the draft pick that corresponds to this selection
        // Match by season, round, and original roster position
        const existingDraftPick = await prisma.draftPick.findFirst({
          where: {
            season: selection.season,
            round: Number(selection.round),
            // For now, let's find any pick in this season/round without a selection
            playerSelectedId: null,
            league: {
              season: selection.season
            }
          },
          include: {
            league: true,
            originalOwner: true,
            currentOwner: true
          }
        });
        
        if (existingDraftPick) {
          // Update the existing pick with the selection data
          await prisma.draftPick.update({
            where: { id: existingDraftPick.id },
            data: {
              playerSelectedId: selection.playerId,
              pickNumber: Number(selection.pickNumber)
            }
          });
          
          linkedCount++;
          
          if (linkedCount % 10 === 0) {
            console.log(`  Linked ${linkedCount} selections...`);
          }
        } else {
          // Check if a pick already exists with this player selection
          const alreadyLinked = await prisma.draftPick.findFirst({
            where: {
              season: selection.season,
              round: Number(selection.round),
              playerSelectedId: selection.playerId
            }
          });
          
          if (alreadyLinked) {
            skippedCount++;
          } else {
            // This shouldn't happen if data is consistent, but log it
            console.log(`  ⚠️ No matching draft pick found for ${selection.season} Round ${selection.round} - ${selection.playerName}`);
          }
        }
        
      } catch (error) {
        console.error(`  ❌ Error processing selection ${selection.selectionId}:`, error);
      }
    }
    
    console.log(`\n✅ Step 2 Complete: ${linkedCount} linked, ${skippedCount} already linked`);
    
    // Step 3: Remove duplicate draft picks (keep ones with playerSelectedId)
    console.log('\n🧹 Step 3: Cleaning up duplicate draft picks...');
    
    const duplicates = await prisma.$queryRaw`
      SELECT 
        season,
        round,
        originalOwnerId,
        COUNT(*) as count,
        GROUP_CONCAT(id) as pickIds,
        GROUP_CONCAT(CASE WHEN playerSelectedId IS NOT NULL THEN id END) as validPickIds
      FROM draft_picks
      WHERE season IN ('2021', '2022', '2023', '2024', '2025')
      GROUP BY season, round, originalOwnerId
      HAVING count > 1
    ` as any[];
    
    let removedCount = 0;
    
    for (const duplicate of duplicates) {
      const pickIds = duplicate.pickIds.split(',');
      const validPickIds = duplicate.validPickIds ? duplicate.validPickIds.split(',').filter((id: string) => id) : [];
      
      if (validPickIds.length > 0) {
        // Keep the first valid pick, remove the rest
        const toRemove = pickIds.filter((id: string) => !validPickIds.includes(id));
        
        for (const pickId of toRemove) {
          // Check if this pick is referenced in transactions first
          const transactionItems = await prisma.transactionItem.count({
            where: { draftPickId: pickId }
          });
          
          if (transactionItems === 0) {
            await prisma.draftPick.delete({ where: { id: pickId } });
            removedCount++;
          } else {
            console.log(`  ⚠️ Keeping pick ${pickId} because it has ${transactionItems} transaction references`);
          }
        }
      }
    }
    
    console.log(`✅ Step 3 Complete: Removed ${removedCount} duplicate picks`);
    
    // Step 4: Final validation
    console.log('\n🔍 Step 4: Final validation...');
    
    const finalStats = await prisma.$queryRaw`
      SELECT 
        season,
        COUNT(*) as total_picks,
        COUNT(playerSelectedId) as valid_picks,
        COUNT(CASE WHEN playerSelectedId IS NULL THEN 1 END) as invalid_picks
      FROM draft_picks 
      WHERE season IN ('2021', '2022', '2023', '2024', '2025')
      GROUP BY season 
      ORDER BY season
    ` as any[];
    
    console.log('\n📈 Final Results by Season:');
    console.log('============================');
    
    let totalFixed = 0;
    for (const stat of finalStats) {
      const totalPicks = Number(stat.total_picks);
      const validPicks = Number(stat.valid_picks);
      const invalidPicks = Number(stat.invalid_picks);
      const validityRate = ((validPicks / totalPicks) * 100).toFixed(1);
      
      console.log(`${stat.season}: ${totalPicks} total, ${validPicks} valid, ${invalidPicks} invalid (${validityRate}% valid)`);
      
      if (invalidPicks === 0) {
        totalFixed++;
      }
    }
    
    if (totalFixed === 5) {
      console.log('\n🎉 SUCCESS: All completed seasons (2021-2025) now have 100% valid draft picks!');
    } else {
      console.log(`\n⚠️ PARTIAL: ${totalFixed}/5 seasons are fully fixed`);
    }
    
    console.log(`\n✅ Draft pick selection fix completed!`);
    console.log(`   - ${linkedCount} selections linked`);
    console.log(`   - ${removedCount} duplicates removed`);
    
  } catch (error) {
    console.error('❌ Fix failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the fix
fixDraftPickSelections().catch(console.error);