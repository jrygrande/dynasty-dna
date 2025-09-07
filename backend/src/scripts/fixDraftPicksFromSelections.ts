#!/usr/bin/env npx ts-node

/**
 * Comprehensive Draft Pick Mapping Using DraftSelection Data
 * 
 * This script leverages the complete DraftSelection table data to fix ALL draft pick mappings.
 * 
 * Strategy:
 * 1. DraftSelection table has 100% complete data for all picks
 * 2. Use pickedBy field to identify who actually made each selection
 * 3. Match by season/round/pickNumber for exact mapping
 * 4. Handle traded picks by finding which manager had access to make that selection
 * 
 * Expected outcome: 100% completion for all seasons (2021-2025)
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface DraftSelectionData {
  selectionId: string;
  pickNumber: number;
  round: number;
  playerId: string;
  playerName: string;
  season: string;
  pickedBy: string; // Sleeper User ID of who made the selection
  pickerManagerId: string | null; // Our internal manager ID
  pickerUsername: string | null;
}

async function fixDraftPicksFromSelections() {
  console.log('🎯 Comprehensive Draft Pick Mapping Using DraftSelection Data\n');
  
  try {
    // Step 1: Get all draft selections with complete data
    console.log('📊 Step 1: Loading all draft selections...');
    
    const allSelections = await prisma.$queryRaw`
      SELECT 
        ds.id as selectionId,
        ds.pickNumber,
        ds.round,
        ds.playerId,
        p.fullName as playerName,
        d.season,
        ds.pickedBy,
        m.id as pickerManagerId,
        m.username as pickerUsername
      FROM draft_selections ds
      JOIN drafts d ON ds.draftId = d.id
      JOIN players p ON ds.playerId = p.id
      LEFT JOIN managers m ON m.sleeperUserId = ds.pickedBy
      WHERE d.season IN ('2021', '2022', '2023', '2024', '2025')
      ORDER BY d.season, ds.pickNumber
    ` as DraftSelectionData[];
    
    console.log(`Found ${allSelections.length} draft selections to process`);
    
    // Step 2: Process each season
    const seasons = ['2021', '2022', '2023', '2024', '2025'];
    let totalMapped = 0;
    let totalUpdated = 0;
    
    for (const season of seasons) {
      console.log(`\n📅 Processing ${season} season...`);
      
      const seasonSelections = allSelections.filter(s => s.season === season);
      console.log(`  Found ${seasonSelections.length} selections for ${season}`);
      
      // Get all draft picks for this season
      const seasonPicks = await prisma.draftPick.findMany({
        where: { season },
        include: {
          currentOwner: { select: { id: true, username: true, sleeperUserId: true } },
          originalOwner: { select: { id: true, username: true, sleeperUserId: true } }
        }
      });
      
      console.log(`  Found ${seasonPicks.length} draft picks for ${season}`);
      
      let mappedThisSeason = 0;
      let updatedThisSeason = 0;
      
      // Process each selection
      for (const selection of seasonSelections) {
        if (!selection.pickerManagerId) {
          console.log(`  ⚠️ No manager found for picker ${selection.pickerUsername} (P${selection.pickNumber})`);
          continue;
        }
        
        // Find the draft pick that corresponds to this selection
        // Strategy: Find a pick in the same season/round owned by the manager who made the selection
        const matchingPick = seasonPicks.find(pick => 
          pick.round === selection.round &&
          (pick.currentOwnerId === selection.pickerManagerId || 
           pick.originalOwnerId === selection.pickerManagerId)
        );
        
        if (matchingPick) {
          // Check if this pick already has the correct mapping
          if (matchingPick.playerSelectedId === selection.playerId && 
              matchingPick.pickNumber === selection.pickNumber) {
            // Already correctly mapped
            mappedThisSeason++;
          } else {
            // Update the draft pick
            await prisma.draftPick.update({
              where: { id: matchingPick.id },
              data: {
                playerSelectedId: selection.playerId,
                pickNumber: selection.pickNumber
              }
            });
            
            updatedThisSeason++;
            console.log(`  ✅ Updated: ${selection.playerName} (P${selection.pickNumber}) R${selection.round} → ${matchingPick.currentOwner.username}`);
          }
        } else {
          console.log(`  ❌ No matching pick found: ${selection.playerName} (P${selection.pickNumber}) R${selection.round} for ${selection.pickerUsername}`);
        }
      }
      
      console.log(`  📈 ${season}: ${mappedThisSeason} already mapped, ${updatedThisSeason} newly updated`);
      totalMapped += mappedThisSeason;
      totalUpdated += updatedThisSeason;
    }
    
    // Step 3: Handle remaining unmapped picks with advanced matching
    console.log('\n🔍 Step 3: Advanced matching for remaining unmapped picks...');
    
    const remainingUnmapped = await prisma.draftPick.findMany({
      where: {
        season: { in: seasons },
        playerSelectedId: null
      },
      include: {
        currentOwner: { select: { username: true } }
      }
    });
    
    console.log(`Found ${remainingUnmapped.length} still unmapped picks`);
    
    let advancedMatched = 0;
    
    // For each unmapped pick, try to find ANY selection that fits
    for (const unmappedPick of remainingUnmapped) {
      // Find selections in the same season/round that haven't been used yet
      const availableSelections = allSelections.filter(selection => 
        selection.season === unmappedPick.season && 
        selection.round === unmappedPick.round &&
        !allSelections.some(s => s.playerId === selection.playerId && s.season === selection.season)
      );
      
      if (availableSelections.length === 1) {
        // Only one available selection for this round - use it
        const selection = availableSelections[0];
        
        await prisma.draftPick.update({
          where: { id: unmappedPick.id },
          data: {
            playerSelectedId: selection.playerId,
            pickNumber: selection.pickNumber
          }
        });
        
        advancedMatched++;
        console.log(`  🎲 Advanced match: ${selection.playerName} (P${selection.pickNumber}) → ${unmappedPick.currentOwner.username}`);
      }
    }
    
    console.log(`Advanced matching: ${advancedMatched} additional picks mapped`);
    
    // Step 4: Final verification
    console.log('\n📊 Final Results:');
    
    const finalStats = await prisma.$queryRaw`
      SELECT 
        season,
        COUNT(*) as total_picks,
        COUNT(playerSelectedId) as valid_picks,
        ROUND(COUNT(playerSelectedId) * 100.0 / COUNT(*), 1) as completion_rate
      FROM draft_picks 
      WHERE season IN ('2021', '2022', '2023', '2024', '2025')
      GROUP BY season 
      ORDER BY season
    ` as any[];
    
    let perfectSeasons = 0;
    
    for (const stat of finalStats) {
      const completion = parseFloat(stat.completion_rate);
      console.log(`  ${stat.season}: ${stat.valid_picks}/${stat.total_picks} (${stat.completion_rate}%)`);
      
      if (completion === 100) {
        perfectSeasons++;
      }
    }
    
    console.log(`\n🎉 Summary:`);
    console.log(`   - ${totalMapped} picks were already correctly mapped`);
    console.log(`   - ${totalUpdated} picks newly updated`);
    console.log(`   - ${advancedMatched} picks matched via advanced logic`);
    console.log(`   - ${perfectSeasons}/5 seasons now have 100% completion`);
    
    if (perfectSeasons === 5) {
      console.log('\n🏆 SUCCESS: All seasons now have 100% draft pick completion!');
    } else {
      console.log('\n⚠️ Some picks still need manual review');
    }
    
  } catch (error) {
    console.error('❌ Mapping failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
fixDraftPicksFromSelections().catch(console.error);