import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function fixDraftPicksWithSnakeOrder(): Promise<void> {
  console.log('🐍 Fixing draft picks to follow actual snake draft order...');
  
  try {
    // First, clear all existing draft picks
    console.log('🧹 Clearing existing draft picks...');
    const deleted = await prisma.draftPick.deleteMany({});
    console.log(`  Deleted ${deleted.count} existing picks`);
    
    // Get all draft selections to understand the actual draft order
    const selections = await prisma.draftSelection.findMany({
      include: {
        draft: {
          include: { league: true }
        }
      },
      orderBy: [
        { draft: { season: 'asc' } },
        { pickNumber: 'asc' }
      ]
    });
    
    console.log(`📊 Analyzing ${selections.length} draft selections to understand draft order...`);
    
    // Build draft order mapping for each league/season
    const draftOrders = new Map<string, Map<number, { rosterId: number; draftSlot: number }[]>>();
    
    for (const selection of selections) {
      const key = `${selection.draft.leagueId}-${selection.draft.season}`;
      
      if (!draftOrders.has(key)) {
        draftOrders.set(key, new Map());
      }
      
      const leagueMap = draftOrders.get(key)!;
      if (!leagueMap.has(selection.round)) {
        leagueMap.set(selection.round, []);
      }
      
      leagueMap.get(selection.round)!.push({
        rosterId: selection.rosterId,
        draftSlot: selection.draftSlot
      });
    }
    
    // Now create draft picks following the actual draft order
    let totalCreated = 0;
    
    for (const [leagueSeasonKey, roundsMap] of draftOrders) {
      const [leagueId, season] = leagueSeasonKey.split('-');
      
      // Get the league info
      const league = await prisma.league.findUnique({
        where: { id: leagueId },
        include: {
          rosters: {
            include: { manager: true }
          }
        }
      });
      
      if (!league) {
        console.warn(`⚠️  League ${leagueId} not found, skipping...`);
        continue;
      }
      
      console.log(`\n🏈 Creating picks for ${league.name} (${season})...`);
      
      // Create a roster lookup map
      const rosterMap = new Map();
      league.rosters.forEach(roster => {
        rosterMap.set(roster.sleeperRosterId, roster);
      });
      
      let leaguePicksCreated = 0;
      
      for (const [round, roundOrder] of roundsMap) {
        console.log(`  📅 Round ${round}: ${roundOrder.length} picks`);
        
        // Sort by draftSlot to ensure correct order
        roundOrder.sort((a, b) => a.draftSlot - b.draftSlot);
        
        for (const { rosterId, draftSlot } of roundOrder) {
          const roster = rosterMap.get(rosterId);
          
          if (!roster) {
            console.warn(`    ⚠️  Roster ${rosterId} not found in league, skipping...`);
            continue;
          }
          
          await prisma.draftPick.create({
            data: {
              leagueId: league.id,
              season: season,
              round: round,
              pickInRound: draftSlot, // This is the position within the round
              
              // Actual roster that made the pick
              originalRosterId: rosterId,
              currentRosterId: rosterId,
              
              // Manager information
              originalOwnerId: roster.manager.id,
              originalOwnerName: roster.manager.displayName || roster.manager.username,
              currentOwnerId: roster.manager.id,
              currentOwnerName: roster.manager.displayName || roster.manager.username,
              
              traded: false
            }
          });
          
          leaguePicksCreated++;
        }
      }
      
      console.log(`  ✅ Created ${leaguePicksCreated} picks for ${league.name} (${season})`);
      totalCreated += leaguePicksCreated;
    }
    
    // Create future draft picks (2026-2028) using the most recent league pattern
    const currentLeague = await prisma.league.findFirst({
      where: { season: '2025' },
      include: {
        rosters: {
          include: { manager: true },
          orderBy: { sleeperRosterId: 'asc' }
        }
      }
    });
    
    if (currentLeague && currentLeague.rosters.length > 0) {
      console.log(`\n🔮 Creating future draft picks (2026-2028)...`);
      
      const futureSeasons = ['2026', '2027', '2028'];
      for (const futureYear of futureSeasons) {
        console.log(`  📅 Creating ${futureYear} picks...`);
        
        let futurePicksCreated = 0;
        for (let round = 1; round <= 4; round++) { // 4 rounds for regular drafts
          for (let pickInRound = 1; pickInRound <= currentLeague.rosters.length; pickInRound++) {
            // For future picks, use standard draft order (can be updated when traded)
            const rosterIndex = (pickInRound - 1) % currentLeague.rosters.length;
            const roster = currentLeague.rosters[rosterIndex];
            
            await prisma.draftPick.create({
              data: {
                leagueId: currentLeague.id,
                season: futureYear,
                round: round,
                pickInRound: pickInRound,
                
                originalRosterId: roster.sleeperRosterId,
                currentRosterId: roster.sleeperRosterId,
                
                originalOwnerId: roster.manager.id,
                originalOwnerName: roster.manager.displayName || roster.manager.username,
                currentOwnerId: roster.manager.id,
                currentOwnerName: roster.manager.displayName || roster.manager.username,
                
                traded: false
              }
            });
            
            futurePicksCreated++;
          }
        }
        console.log(`    ✅ Created ${futurePicksCreated} picks for ${futureYear}`);
        totalCreated += futurePicksCreated;
      }
    }
    
    // Verify the results
    const picksBySeason = await prisma.draftPick.groupBy({
      by: ['season'],
      _count: { season: true },
      orderBy: { season: 'asc' }
    });
    
    console.log('\n🎯 SUMMARY:');
    console.log('📊 DRAFT PICKS BY SEASON:');
    picksBySeason.forEach(group => {
      console.log(`  ${group.season}: ${group._count.season} picks`);
    });
    
    console.log(`\n✅ Total picks created: ${totalCreated}`);
    
  } catch (error) {
    console.error('❌ Error fixing draft picks:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
if (require.main === module) {
  fixDraftPicksWithSnakeOrder()
    .then(() => {
      console.log('\n✨ Draft picks fix with snake order completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Draft picks fix failed:', error);
      process.exit(1);
    });
}

export { fixDraftPicksWithSnakeOrder };