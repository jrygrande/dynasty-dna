import { PrismaClient } from '@prisma/client';
import { sleeperClient } from '../services/sleeperClient';
import { config } from '../config';

const prisma = new PrismaClient();

interface TradedPicksResult {
  processed: number;
  updated: number;
  errors: string[];
}

async function syncTradedPicks(leagueId?: string): Promise<TradedPicksResult> {
  const targetLeagueId = leagueId || config.testLeagueId || '1191596293294166016';
  
  console.log('🔄 Syncing traded draft picks...');
  console.log(`📊 League: ${targetLeagueId}`);
  
  const result: TradedPicksResult = {
    processed: 0,
    updated: 0,
    errors: []
  };
  
  try {
    // Get internal league ID
    const league = await prisma.league.findUnique({
      where: { sleeperLeagueId: targetLeagueId }
    });
    
    if (!league) {
      throw new Error(`League ${targetLeagueId} not found in database`);
    }
    
    const internalLeagueId = league.id;
    
    // Get all traded picks from Sleeper API
    console.log('📋 Fetching traded picks from Sleeper API...');
    const tradedPicks = await sleeperClient.getLeagueTradedPicks(targetLeagueId);
    
    if (!tradedPicks || tradedPicks.length === 0) {
      console.log('✅ No traded picks found');
      return result;
    }
    
    console.log(`📊 Found ${tradedPicks.length} traded picks`);
    
    // Create manager lookup maps
    const sleeperUserIdToManager = new Map();
    const rosterIdToManager = new Map();
    
    const managers = await prisma.manager.findMany();
    const rosters = await prisma.roster.findMany({
      where: { leagueId: internalLeagueId },
      include: { manager: true }
    });
    
    // Build lookup maps
    managers.forEach(manager => {
      sleeperUserIdToManager.set(manager.sleeperUserId, manager);
    });
    
    rosters.forEach(roster => {
      rosterIdToManager.set(roster.sleeperRosterId, roster.manager);
    });
    
    // Process each traded pick
    for (const pick of tradedPicks) {
      result.processed++;
      
      try {
        // Find the original and current owners
        const originalOwnerManager = rosterIdToManager.get(pick.roster_id);
        const currentOwnerManager = rosterIdToManager.get(pick.owner_id);
        const previousOwnerManager = pick.previous_owner_id 
          ? rosterIdToManager.get(pick.previous_owner_id) 
          : null;
        
        if (!originalOwnerManager || !currentOwnerManager) {
          result.errors.push(
            `Could not find managers for pick ${pick.season} R${pick.round} - ` +
            `Original: ${pick.roster_id}, Current: ${pick.owner_id}`
          );
          continue;
        }
        
        // Find or create the draft pick using new unique constraint
        const draftPick = await prisma.draftPick.upsert({
          where: {
            leagueId_season_round_originalOwnerId: {
              leagueId: internalLeagueId,
              season: pick.season,
              round: pick.round,
              originalOwnerId: originalOwnerManager.id
            }
          },
          update: {
            currentOwnerId: currentOwnerManager.id,
            currentOwnerName: currentOwnerManager.displayName || currentOwnerManager.username,
            currentRosterId: pick.owner_id,
            previousOwnerId: previousOwnerManager?.id,
            previousOwnerName: previousOwnerManager?.displayName || previousOwnerManager?.username,
            previousRosterId: pick.previous_owner_id,
            traded: pick.roster_id !== pick.owner_id,
            updatedAt: new Date()
          },
          create: {
            leagueId: internalLeagueId,
            season: pick.season,
            round: pick.round,
            pickInRound: 1, // Placeholder for future picks
            originalOwnerId: originalOwnerManager.id,
            originalOwnerName: originalOwnerManager.displayName || originalOwnerManager.username,
            originalRosterId: pick.roster_id,
            currentOwnerId: currentOwnerManager.id,
            currentOwnerName: currentOwnerManager.displayName || currentOwnerManager.username,
            currentRosterId: pick.owner_id,
            previousOwnerId: previousOwnerManager?.id,
            previousOwnerName: previousOwnerManager?.displayName || previousOwnerManager?.username,
            previousRosterId: pick.previous_owner_id,
            traded: pick.roster_id !== pick.owner_id
          }
        });
        
        result.updated++;
        
        const originalName = originalOwnerManager.displayName || originalOwnerManager.username;
        const currentName = currentOwnerManager.displayName || currentOwnerManager.username;
        const status = pick.roster_id !== pick.owner_id ? '🔄 TRADED' : '📍 ORIGINAL';
        
        console.log(`  ${pick.season} R${pick.round}: ${originalName} → ${currentName} ${status}`);
        
      } catch (error: any) {
        result.errors.push(`Error processing ${pick.season} R${pick.round}: ${error.message}`);
        console.error(`❌ Error processing pick:`, error);
      }
    }
    
    // Show summary
    console.log('\\n🎯 SYNC SUMMARY:');
    console.log(`📊 Processed: ${result.processed} picks`);
    console.log(`✅ Updated: ${result.updated} picks`);
    console.log(`❌ Errors: ${result.errors.length} picks`);
    
    if (result.errors.length > 0) {
      console.log('\\n⚠️  ERRORS:');
      result.errors.slice(0, 5).forEach(error => console.log(`  • ${error}`));
      if (result.errors.length > 5) {
        console.log(`  ... and ${result.errors.length - 5} more errors`);
      }
    }
    
    return result;
    
  } catch (error: any) {
    console.error('❌ Failed to sync traded picks:', error);
    result.errors.push(error.message);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
if (require.main === module) {
  const leagueId = process.argv[2]; // Optional league ID argument
  
  syncTradedPicks(leagueId)
    .then((result) => {
      if (result.errors.length === 0) {
        console.log('\\n✨ Traded picks sync completed successfully!');
        process.exit(0);
      } else {
        console.log('\\n⚠️  Traded picks sync completed with errors');
        process.exit(1);
      }
    })
    .catch((error) => {
      console.error('\\n💥 Traded picks sync failed:', error);
      process.exit(1);
    });
}

export { syncTradedPicks };