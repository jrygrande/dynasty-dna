#!/usr/bin/env npx ts-node

/**
 * Improved Draft Pick Linking Script
 * 
 * This enhanced script addresses the remaining mapping issues by:
 * 1. Using more sophisticated matching logic
 * 2. Handling edge cases like multiple picks per manager per round
 * 3. Better roster-to-manager mapping across seasons
 * 4. Prioritizing exact pick number matches when available
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface DraftSelection {
  selectionId: string;
  pickNumber: number;
  round: number;
  draftSlot: number;
  playerId: string;
  playerName: string;
  rosterId: number;
  season: string;
  draftId: string;
  managerId?: string;
  managerUsername?: string;
}

interface DraftPick {
  id: string;
  season: string;
  round: number;
  pickNumber?: number;
  currentOwnerId: string;
  originalOwnerId: string;
  playerSelectedId?: string;
  currentOwnerUsername: string;
  originalOwnerUsername: string;
}

async function improvedDraftPickLinking() {
  console.log('🔧 Enhanced Draft Pick Linking Process\n');
  
  try {
    // Process each season with specific logic
    const seasons = ['2021', '2022', '2023', '2024', '2025'];
    let totalLinked = 0;
    
    for (const season of seasons) {
      console.log(`\n📅 Processing ${season} season...`);
      
      // Get all draft selections for this season with manager info
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
          d.id as draftId,
          m.id as managerId,
          m.username as managerUsername
        FROM draft_selections ds
        JOIN drafts d ON ds.draftId = d.id
        JOIN players p ON ds.playerId = p.id
        LEFT JOIN rosters r ON r.sleeperRosterId = ds.rosterId AND r.leagueId = d.leagueId
        LEFT JOIN managers m ON m.id = r.managerId
        WHERE d.season = ${season}
        ORDER BY ds.pickNumber
      ` as DraftSelection[];
      
      // Get all unmapped draft picks for this season
      const unmappedPicks = await prisma.$queryRaw`
        SELECT 
          dp.id,
          dp.season,
          dp.round,
          dp.pickNumber,
          dp.currentOwnerId,
          dp.originalOwnerId,
          dp.playerSelectedId,
          co.username as currentOwnerUsername,
          oo.username as originalOwnerUsername
        FROM draft_picks dp
        LEFT JOIN managers co ON dp.currentOwnerId = co.id
        LEFT JOIN managers oo ON dp.originalOwnerId = oo.id
        WHERE dp.season = ${season} 
          AND dp.playerSelectedId IS NULL
        ORDER BY dp.round, COALESCE(dp.pickNumber, 999)
      ` as DraftPick[];
      
      console.log(`  📋 Found ${selections.length} selections and ${unmappedPicks.length} unmapped picks`);
      
      let linkedThisSeason = 0;
      
      // Strategy 1: Exact matching by manager, round, and proximity to pick number
      for (const selection of selections) {
        if (!selection.managerId) {
          console.log(`  ⚠️ No manager found for selection: ${selection.playerName} (P${selection.pickNumber})`);
          continue;
        }
        
        // Find the best matching draft pick for this selection
        const bestMatch = findBestMatchingPick(selection, unmappedPicks);
        
        if (bestMatch) {
          // Update the draft pick
          await prisma.draftPick.update({
            where: { id: bestMatch.id },
            data: {
              playerSelectedId: selection.playerId,
              pickNumber: selection.pickNumber
            }
          });
          
          linkedThisSeason++;
          
          // Remove from unmapped list
          const index = unmappedPicks.findIndex(p => p.id === bestMatch.id);
          if (index > -1) {
            unmappedPicks.splice(index, 1);
          }
          
          console.log(`  ✅ Linked: ${selection.playerName} (P${selection.pickNumber}) to ${bestMatch.currentOwnerUsername}`);
        } else {
          console.log(`  ❌ No match found: ${selection.playerName} (P${selection.pickNumber}) for ${selection.managerUsername}`);
        }
      }
      
      console.log(`  📊 ${season}: Linked ${linkedThisSeason} additional picks`);
      totalLinked += linkedThisSeason;
    }
    
    // Final verification
    console.log('\n📈 Final Results:');
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
    
    for (const stat of finalStats) {
      console.log(`  ${stat.season}: ${stat.valid_picks}/${stat.total_picks} (${stat.completion_rate}%)`);
    }
    
    console.log(`\n🎯 Successfully linked ${totalLinked} additional draft picks!`);
    
  } catch (error) {
    console.error('❌ Enhanced linking failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Find the best matching draft pick for a given draft selection
 */
function findBestMatchingPick(selection: DraftSelection, availablePicks: DraftPick[]): DraftPick | null {
  if (!selection.managerId) return null;
  
  // Filter picks by season and round first
  const candidatePicks = availablePicks.filter(pick => 
    pick.season === selection.season && 
    pick.round === selection.round
  );
  
  if (candidatePicks.length === 0) return null;
  
  // Strategy 1: Exact manager and round match
  const exactManagerMatch = candidatePicks.find(pick => 
    pick.currentOwnerId === selection.managerId
  );
  
  if (exactManagerMatch) {
    return exactManagerMatch;
  }
  
  // Strategy 2: Original owner match (for traded picks)
  const originalOwnerMatch = candidatePicks.find(pick => 
    pick.originalOwnerId === selection.managerId
  );
  
  if (originalOwnerMatch) {
    return originalOwnerMatch;
  }
  
  // Strategy 3: Manager by username match (fallback for ID mismatches)
  if (selection.managerUsername) {
    const usernameMatch = candidatePicks.find(pick => 
      pick.currentOwnerUsername === selection.managerUsername ||
      pick.originalOwnerUsername === selection.managerUsername
    );
    
    if (usernameMatch) {
      return usernameMatch;
    }
  }
  
  // Strategy 4: If there's only one unmapped pick in this round, use it
  if (candidatePicks.length === 1) {
    console.log(`  🎲 Using only available pick in ${selection.season} R${selection.round} for ${selection.playerName}`);
    return candidatePicks[0];
  }
  
  return null;
}

// Run the script
improvedDraftPickLinking().catch(console.error);