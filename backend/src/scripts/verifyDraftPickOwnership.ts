import { PrismaClient } from '@prisma/client';
import { config } from '../config';

const prisma = new PrismaClient();

async function verifyDraftPickOwnership(leagueId?: string): Promise<void> {
  const targetLeagueId = leagueId || config.testLeagueId || '1191596293294166016';
  
  console.log('🔍 Verifying draft pick ownership...');
  console.log(`📊 League: ${targetLeagueId}`);
  
  try {
    // Get league info
    const league = await prisma.league.findUnique({
      where: { sleeperLeagueId: targetLeagueId }
    });
    
    if (!league) {
      throw new Error(`League ${targetLeagueId} not found`);
    }
    
    console.log(`🏈 League: ${league.name} (${league.season})`);
    
    // Get draft picks for analysis
    const allPicks = await prisma.draftPick.findMany({
      where: { leagueId: league.id },
      include: {
        originalOwner: true,
        currentOwner: true,
        previousOwner: true
      },
      orderBy: [
        { season: 'asc' },
        { round: 'asc' },
        { originalOwnerId: 'asc' }
      ]
    });
    
    console.log(`\\n📊 DRAFT PICK SUMMARY:`);
    
    // Group by season
    const picksBySeason = allPicks.reduce((acc, pick) => {
      if (!acc[pick.season]) acc[pick.season] = [];
      acc[pick.season].push(pick);
      return acc;
    }, {} as Record<string, typeof allPicks>);
    
    let totalTraded = 0;
    
    for (const [season, seasonPicks] of Object.entries(picksBySeason)) {
      const tradedCount = seasonPicks.filter(p => p.traded).length;
      totalTraded += tradedCount;
      
      console.log(`  ${season}: ${seasonPicks.length} picks, ${tradedCount} traded (${Math.round(tradedCount/seasonPicks.length*100)}%)`);
    }
    
    console.log(`\\n🔄 TOTAL TRADED PICKS: ${totalTraded} of ${allPicks.length} (${Math.round(totalTraded/allPicks.length*100)}%)`);
    
    // Show specific examples of the user's mentioned trade
    console.log(`\\n🎯 SPECIFIC TRADE EXAMPLES:`);
    
    // Look for the mentioned jrygrande <-> andrewduke23 trade in 2027
    const jrygrande2027Picks = allPicks.filter(pick => 
      pick.season === '2027' && 
      (pick.originalOwner?.username === 'jrygrande' || pick.currentOwner?.username === 'jrygrande')
    );
    
    const andrewduke2027Picks = allPicks.filter(pick => 
      pick.season === '2027' && 
      (pick.originalOwner?.username === 'andrewduke23' || pick.currentOwner?.username === 'andrewduke23')
    );
    
    console.log('  2027 jrygrande-related picks:');
    jrygrande2027Picks.forEach(pick => {
      const original = pick.originalOwner?.username || 'Unknown';
      const current = pick.currentOwner?.username || 'Unknown';
      const status = pick.traded ? '🔄 TRADED' : '📍 ORIGINAL';
      console.log(`    R${pick.round}: ${original} → ${current} ${status}`);
    });
    
    console.log('  2027 andrewduke23-related picks:');
    andrewduke2027Picks.forEach(pick => {
      const original = pick.originalOwner?.username || 'Unknown';
      const current = pick.currentOwner?.username || 'Unknown';
      const status = pick.traded ? '🔄 TRADED' : '📍 ORIGINAL';
      console.log(`    R${pick.round}: ${original} → ${current} ${status}`);
    });
    
    // Show future picks (2026-2028) trade status
    console.log(`\\n🔮 FUTURE PICKS TRADE STATUS:`);
    const futurePicks = allPicks.filter(pick => 
      ['2026', '2027', '2028'].includes(pick.season)
    );
    
    const futureStats = futurePicks.reduce((acc, pick) => {
      const key = pick.season;
      if (!acc[key]) acc[key] = { total: 0, traded: 0 };
      acc[key].total++;
      if (pick.traded) acc[key].traded++;
      return acc;
    }, {} as Record<string, {total: number; traded: number}>);
    
    Object.entries(futureStats).forEach(([year, stats]) => {
      const pct = Math.round(stats.traded / stats.total * 100);
      console.log(`  ${year}: ${stats.traded}/${stats.total} traded (${pct}%)`);
    });
    
    // Check for any issues
    console.log(`\\n🔍 DATA INTEGRITY CHECKS:`);
    
    // Check for picks with NULL owners
    const picksWithNullOwners = allPicks.filter(pick => 
      !pick.originalOwnerId || !pick.currentOwnerId
    );
    
    if (picksWithNullOwners.length > 0) {
      console.log(`  ⚠️  ${picksWithNullOwners.length} picks have NULL owners`);
    } else {
      console.log(`  ✅ All picks have valid owners`);
    }
    
    // Check for traded picks without previous owners
    const tradedWithoutPrevious = allPicks.filter(pick => 
      pick.traded && !pick.previousOwnerId
    );
    
    if (tradedWithoutPrevious.length > 0) {
      console.log(`  ⚠️  ${tradedWithoutPrevious.length} traded picks missing previous owner info`);
    } else {
      console.log(`  ✅ All traded picks have previous owner info`);
    }
    
    // Check for unique constraint violations
    const duplicateCheck = new Map<string, number>();
    allPicks.forEach(pick => {
      const key = `${pick.leagueId}-${pick.season}-${pick.round}-${pick.originalOwnerId}`;
      duplicateCheck.set(key, (duplicateCheck.get(key) || 0) + 1);
    });
    
    const duplicates = Array.from(duplicateCheck.entries()).filter(([_key, count]) => count > 1);
    
    if (duplicates.length > 0) {
      console.log(`  ⚠️  ${duplicates.length} duplicate combinations found`);
      duplicates.slice(0, 5).forEach(([key, count]) => {
        console.log(`    ${key}: ${count} picks`);
      });
    } else {
      console.log(`  ✅ No duplicate combinations found`);
    }
    
    console.log(`\\n✅ Draft pick ownership verification complete!`);
    
  } catch (error) {
    console.error('❌ Verification failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
if (require.main === module) {
  const leagueId = process.argv[2]; // Optional league ID argument
  
  verifyDraftPickOwnership(leagueId)
    .then(() => {
      console.log('\\n✨ Verification completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\\n💥 Verification failed:', error);
      process.exit(1);
    });
}

export { verifyDraftPickOwnership };