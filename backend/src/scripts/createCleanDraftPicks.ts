import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function createCleanDraftPicks(): Promise<void> {
  console.log('🎯 Creating clean draft picks without duplicates...');
  
  try {
    // Clear all existing draft picks
    console.log('🧹 Clearing all existing draft picks...');
    const deleted = await prisma.draftPick.deleteMany({});
    console.log(`  Deleted ${deleted.count} existing picks`);
    
    // Step 1: Create historical picks (2021-2025) based on actual draft selections
    console.log('\n📋 Creating historical draft picks (2021-2025)...');
    
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
    
    // Group by league/season/round to create proper draft picks
    const draftStructure = new Map<string, Map<number, { rosterId: number; draftSlot: number }[]>>();
    
    for (const selection of selections) {
      const key = `${selection.draft.leagueId}-${selection.draft.season}`;
      
      if (!draftStructure.has(key)) {
        draftStructure.set(key, new Map());
      }
      
      const leagueMap = draftStructure.get(key)!;
      if (!leagueMap.has(selection.round)) {
        leagueMap.set(selection.round, []);
      }
      
      leagueMap.get(selection.round)!.push({
        rosterId: selection.rosterId,
        draftSlot: selection.draftSlot
      });
    }
    
    let historicalPicksCreated = 0;
    
    // Create one pick for each historical draft selection
    const leagueCache = new Map();
    const rosterCache = new Map();
    
    for (const selection of selections) {
      const leagueId = selection.draft.leagueId;
      const season = selection.draft.season;
      
      // Get or cache league info
      if (!leagueCache.has(leagueId)) {
        const league = await prisma.league.findUnique({
          where: { id: leagueId },
          include: {
            rosters: {
              include: { manager: true }
            }
          }
        });
        leagueCache.set(leagueId, league);
        
        // Cache roster mapping
        const rosterMap = new Map();
        league?.rosters.forEach(roster => {
          rosterMap.set(roster.sleeperRosterId, roster);
        });
        rosterCache.set(leagueId, rosterMap);
      }
      
      const league = leagueCache.get(leagueId);
      const rosterMap = rosterCache.get(leagueId);
      
      if (!league) continue;
      
      const roster = rosterMap.get(selection.rosterId);
      
      if (roster) {
        await prisma.draftPick.create({
          data: {
            leagueId: league.id,
            season: season,
            round: selection.round,
            pickInRound: selection.draftSlot,
            
            // Current owner info (who made the selection)
            originalRosterId: selection.rosterId,
            currentRosterId: selection.rosterId,
            originalOwnerId: roster.manager.id,
            originalOwnerName: roster.manager.displayName || roster.manager.username,
            currentOwnerId: roster.manager.id,
            currentOwnerName: roster.manager.displayName || roster.manager.username,
            
            traded: false
          }
        });
        
        historicalPicksCreated++;
        
        // Log progress occasionally
        if (historicalPicksCreated % 100 === 0) {
          console.log(`    📊 Created ${historicalPicksCreated} picks so far...`);
        }
      }
    }
    
    console.log(`  📋 Processed ${selections.length} draft selections`);
    console.log(`    ✅ Created ${historicalPicksCreated} historical picks`);
    
    // Step 2: Create future picks (2026-2028) - one per owner per round
    console.log('\n🔮 Creating future draft picks (2026-2028)...');
    
    // Use the most recent league (2025) as template for future picks
    const currentLeague = await prisma.league.findFirst({
      where: { season: '2025' },
      include: {
        rosters: {
          include: { manager: true },
          orderBy: { sleeperRosterId: 'asc' }
        }
      }
    });
    
    if (!currentLeague) {
      throw new Error('No 2025 league found for creating future picks');
    }
    
    let futurePicksCreated = 0;
    const futureSeasons = ['2026', '2027', '2028'];
    
    for (const futureYear of futureSeasons) {
      console.log(`  📅 Creating ${futureYear} picks...`);
      
      // Create 4 rounds of picks (regular draft)
      for (let round = 1; round <= 4; round++) {
        // Each roster gets exactly one pick per round
        for (const roster of currentLeague.rosters) {
          await prisma.draftPick.create({
            data: {
              leagueId: currentLeague.id,
              season: futureYear,
              round: round,
              pickInRound: roster.sleeperRosterId, // Use roster ID as placeholder for future picks
              
              // Original owner info (who currently owns this future pick)
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
    }
    
    console.log(`    ✅ Created ${futurePicksCreated} future picks`);
    
    // Verify final counts
    const finalCounts = await prisma.draftPick.groupBy({
      by: ['season'],
      _count: { season: true },
      orderBy: { season: 'asc' }
    });
    
    console.log('\n🎯 FINAL SUMMARY:');
    finalCounts.forEach(group => {
      console.log(`  ${group.season}: ${group._count.season} picks`);
    });
    
    const totalPicks = await prisma.draftPick.count();
    console.log(`\n✅ Total picks created: ${totalPicks}`);
    
  } catch (error) {
    console.error('❌ Error creating clean draft picks:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
if (require.main === module) {
  createCleanDraftPicks()
    .then(() => {
      console.log('\n✨ Clean draft picks creation completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Clean draft picks creation failed:', error);
      process.exit(1);
    });
}

export { createCleanDraftPicks };