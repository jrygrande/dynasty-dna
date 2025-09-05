#!/usr/bin/env npx ts-node

/**
 * Migration script to fix existing draft picks with null pickNumber
 * 
 * This script matches draft_selections to draft_picks and updates the draft_picks
 * with the correct pickNumber and playerSelectedId values.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function migrateDraftPicks() {
  console.log('🔄 Starting draft picks migration...');
  
  try {
    // Get all draft picks that need updating (pickNumber is null)
    const draftPicksToUpdate = await prisma.draftPick.findMany({
      where: {
        pickNumber: null
      },
      include: {
        league: true
      }
    });
    
    console.log(`📊 Found ${draftPicksToUpdate.length} draft picks to update`);
    
    let updatedCount = 0;
    let skippedCount = 0;
    
    for (const draftPick of draftPicksToUpdate) {
      // Get roster ID for the current owner
      const rosterIdForManager = await getRosterIdForManager(draftPick.currentOwnerId, draftPick.leagueId);
      
      // Find the corresponding draft selection
      const draftSelection = await prisma.draftSelection.findFirst({
        where: {
          draft: {
            leagueId: draftPick.leagueId,
            season: draftPick.season
          },
          round: draftPick.round,
          // Match by roster - find who actually made the pick
          OR: [
            { pickedBy: draftPick.currentOwnerId },
            ...(rosterIdForManager ? [{ rosterId: rosterIdForManager }] : [])
          ]
        },
        include: {
          player: true,
          draft: true
        }
      });
      
      if (draftSelection) {
        // Update the draft pick with selection information
        await prisma.draftPick.update({
          where: { id: draftPick.id },
          data: {
            pickNumber: draftSelection.pickNumber,
            playerSelectedId: draftSelection.playerId
          }
        });
        
        updatedCount++;
        console.log(`✅ Updated ${draftPick.season} R${draftPick.round} pick with ${draftSelection.player.fullName} (P${draftSelection.pickNumber})`);
      } else {
        skippedCount++;
        console.log(`⚠️  Could not find matching selection for ${draftPick.season} R${draftPick.round} pick`);
      }
    }
    
    console.log(`\n📈 Migration complete:`);
    console.log(`   ✅ Updated: ${updatedCount} draft picks`);
    console.log(`   ⚠️  Skipped: ${skippedCount} draft picks (no matching selection found)`);
    
    // Verify the migration
    const remainingNullPicks = await prisma.draftPick.count({
      where: { pickNumber: null }
    });
    
    console.log(`\n🔍 Verification: ${remainingNullPicks} draft picks still have null pickNumber`);
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Helper function to get roster ID for a manager in a specific league
 */
async function getRosterIdForManager(managerId: string, leagueId: string): Promise<number | null> {
  const roster = await prisma.roster.findFirst({
    where: {
      managerId,
      leagueId
    }
  });
  
  return roster?.sleeperRosterId || null;
}

// Run the migration if this script is executed directly
if (require.main === module) {
  migrateDraftPicks()
    .then(() => {
      console.log('🎉 Migration script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Migration script failed:', error);
      process.exit(1);
    });
}

export { migrateDraftPicks };