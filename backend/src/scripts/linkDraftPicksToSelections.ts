#!/usr/bin/env npx ts-node

/**
 * Link Draft Picks to Their Selections
 * 
 * This script fixes the core issue by:
 * 1. Finding draft selections for 2022-2025 (regular 4-round drafts, 48 picks each)
 * 2. Linking them to existing draft picks by matching season/round/roster owner
 * 3. Cleaning up orphaned draft pick records
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function linkDraftPicksToSelections() {
  console.log('🔗 Linking Draft Picks to Their Player Selections\n');
  
  try {
    // Step 1: Focus on regular draft seasons (not 2021 startup)
    const seasons = ['2022', '2023', '2024', '2025'];
    
    let totalLinked = 0;
    
    for (const season of seasons) {
      console.log(`\n📅 Processing ${season} season...`);
      
      // Get all draft selections for this season
      const selections = await prisma.$queryRaw`
        SELECT 
          ds.id as selectionId,
          ds.pickNumber,
          ds.round,
          ds.draftSlot,
          ds.playerId,
          p.fullName as playerName,
          ds.rosterId,
          d.season,
          m.id as managerId
        FROM draft_selections ds
        JOIN drafts d ON ds.draftId = d.id
        JOIN players p ON ds.playerId = p.id
        LEFT JOIN rosters r ON r.sleeperRosterId = ds.rosterId AND r.leagueId = d.leagueId
        LEFT JOIN managers m ON m.id = r.managerId
        WHERE d.season = ${season}
        ORDER BY ds.pickNumber
      ` as any[];
      
      console.log(`  Found ${selections.length} selections to link`);
      
      let linkedThisSeason = 0;
      
      for (const selection of selections) {
        if (!selection.managerId) {
          console.log(`  ⚠️ No manager found for roster ${selection.rosterId} in ${season}`);
          continue;
        }
        
        // Find the corresponding draft pick
        // Match by season, round, and current owner (who drafted the player)
        const draftPick = await prisma.draftPick.findFirst({
          where: {
            season: season,
            round: Number(selection.round),
            currentOwnerId: selection.managerId,
            playerSelectedId: null // Only update picks without selections
          }
        });
        
        if (draftPick) {
          // Update the draft pick with the selection
          await prisma.draftPick.update({
            where: { id: draftPick.id },
            data: {
              playerSelectedId: selection.playerId,
              pickNumber: Number(selection.pickNumber)
            }
          });
          
          linkedThisSeason++;
          
          if (linkedThisSeason % 10 === 0) {
            console.log(`    Linked ${linkedThisSeason} picks...`);
          }
        } else {
          // Check if there's already a pick with this player
          const existingPick = await prisma.draftPick.findFirst({
            where: {
              season: season,
              round: Number(selection.round),
              playerSelectedId: selection.playerId
            }
          });
          
          if (!existingPick) {
            console.log(`    ⚠️ No matching pick found: ${season} R${selection.round} - ${selection.playerName} to manager ${selection.managerId}`);
          }
        }
      }
      
      console.log(`  ✅ Linked ${linkedThisSeason} picks for ${season}`);
      totalLinked += linkedThisSeason;
    }
    
    console.log(`\n🎯 Total linked: ${totalLinked} draft picks`);
    
    // Step 2: Clean up orphaned picks (ones without selections for completed seasons)
    console.log('\n🧹 Cleaning up orphaned draft picks...');
    
    const orphanedPicks = await prisma.draftPick.findMany({
      where: {
        season: { in: seasons },
        playerSelectedId: null
      },
      include: {
        transactionItems: true
      }
    });
    
    let removedCount = 0;
    let keptCount = 0;
    
    for (const pick of orphanedPicks) {
      if (pick.transactionItems.length === 0) {
        // Safe to remove - no transaction references
        await prisma.draftPick.delete({ where: { id: pick.id } });
        removedCount++;
      } else {
        keptCount++;
      }
    }
    
    console.log(`  Removed ${removedCount} orphaned picks`);
    console.log(`  Kept ${keptCount} orphaned picks (have transaction references)`);
    
    // Step 3: Final verification
    console.log('\n📊 Final Verification:');
    
    const finalStats = await prisma.$queryRaw`
      SELECT 
        season,
        COUNT(*) as total_picks,
        COUNT(playerSelectedId) as valid_picks
      FROM draft_picks 
      WHERE season IN ('2022', '2023', '2024', '2025')
      GROUP BY season 
      ORDER BY season
    ` as any[];
    
    for (const stat of finalStats) {
      const total = Number(stat.total_picks);
      const valid = Number(stat.valid_picks);
      const percentage = total > 0 ? ((valid / total) * 100).toFixed(1) : '0.0';
      console.log(`  ${stat.season}: ${valid}/${total} valid (${percentage}%)`);
    }
    
    console.log(`\n✅ Draft pick linking complete!`);
    
  } catch (error) {
    console.error('❌ Linking failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the fix
linkDraftPicksToSelections().catch(console.error);