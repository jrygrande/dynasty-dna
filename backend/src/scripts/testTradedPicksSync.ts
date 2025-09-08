import { PrismaClient } from '@prisma/client';
import { dataSyncService } from '../services/dataSyncService';
import { config } from '../config';

const prisma = new PrismaClient();

async function testTradedPicksSync(): Promise<void> {
  const testLeagueId = config.testLeagueId || '1191596293294166016';
  
  console.log('🧪 Testing traded picks sync with new constraint...');
  console.log(`📊 Testing with league: ${testLeagueId}`);
  
  try {
    // First, let's check current draft picks for future years
    console.log('\\n📋 Current future draft picks ownership:');
    const futurePicks = await prisma.draftPick.findMany({
      where: {
        season: { in: ['2026', '2027', '2028'] }
      },
      include: {
        currentOwner: true,
        originalOwner: true
      },
      orderBy: [
        { season: 'asc' },
        { round: 'asc' },
        { originalOwnerId: 'asc' }
      ]
    });
    
    const picksBySeasonAndRound = futurePicks.reduce((acc, pick) => {
      const key = `${pick.season}-R${pick.round}`;
      if (!acc[key]) acc[key] = [];
      acc[key].push({
        original: pick.originalOwner?.displayName || pick.originalOwnerName || 'Unknown',
        current: pick.currentOwner?.displayName || pick.currentOwnerName || 'Unknown',
        traded: pick.traded
      });
      return acc;
    }, {} as Record<string, Array<{original: string; current: string; traded: boolean}>>);
    
    Object.entries(picksBySeasonAndRound).forEach(([key, picks]) => {
      const tradedCount = picks.filter(p => p.traded).length;
      console.log(`  ${key}: ${picks.length} picks, ${tradedCount} traded`);
      if (tradedCount > 0) {
        picks.filter(p => p.traded).forEach(pick => {
          console.log(`    🔄 ${pick.original} → ${pick.current}`);
        });
      }
    });
    
    // Test the sync service
    console.log('\\n🔄 Testing dataSyncService.syncTradedPicks...');
    
    try {
      // Try to call the traded picks sync method
      const result = await dataSyncService.syncLeague(testLeagueId);
      
      console.log('✅ DataSyncService executed successfully');
      console.log(`   Result: ${result.success ? 'Success' : 'Failed'}`);
      if (!result.success && result.errors.length > 0) {
        console.log('   Errors:', result.errors.slice(0, 3)); // Show first 3 errors
      }
      
    } catch (error: any) {
      if (error.message?.includes('leagueId_season_round_originalOwnerId')) {
        console.log('❌ Constraint name error detected in dataSyncService');
        console.log('   The service is using the wrong constraint name');
        console.log(`   Error: ${error.message}`);
      } else {
        console.log('❌ Other error in dataSyncService:', error.message);
      }
    }
    
    // Check if any picks were updated
    console.log('\\n📊 Post-sync future picks status:');
    const postSyncPicks = await prisma.draftPick.findMany({
      where: {
        season: { in: ['2027'] }, // Focus on 2027 where we know there should be trades
        round: { in: [1, 3] }     // Focus on rounds mentioned in the original problem
      },
      include: {
        currentOwner: true,
        originalOwner: true
      },
      orderBy: [
        { round: 'asc' },
        { originalOwnerId: 'asc' }
      ]
    });
    
    console.log('2027 picks (R1 and R3):');
    postSyncPicks.forEach(pick => {
      const originalName = pick.originalOwner?.username || pick.originalOwnerName || 'Unknown';
      const currentName = pick.currentOwner?.username || pick.currentOwnerName || 'Unknown';
      const status = pick.traded ? '🔄 TRADED' : '📍 ORIGINAL';
      console.log(`  R${pick.round}: ${originalName} → ${currentName} ${status}`);
    });
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the test
if (require.main === module) {
  testTradedPicksSync()
    .then(() => {
      console.log('\\n✨ Traded picks sync test completed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\\n💥 Test failed:', error);
      process.exit(1);
    });
}

export { testTradedPicksSync };