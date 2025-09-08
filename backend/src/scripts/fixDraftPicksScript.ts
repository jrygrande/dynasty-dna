import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function fixDraftPicksScript(): Promise<void> {
  console.log('🔧 Fixing draft picks to match selections and future needs...');
  
  try {
    // First, clear all existing draft picks
    console.log('🧹 Clearing existing draft picks...');
    const deleted = await prisma.draftPick.deleteMany({});
    console.log(`  Deleted ${deleted.count} existing picks`);
    
    // Get ALL leagues that have drafts (historical and current)
    const leagues = await prisma.league.findMany({
      include: {
        rosters: {
          include: { manager: true },
          orderBy: { sleeperRosterId: 'asc' }
        },
        drafts: true
      },
      orderBy: { season: 'asc' }
    });
    
    if (leagues.length === 0) {
      throw new Error('No leagues found');
    }
    
    console.log(`📋 Found ${leagues.length} leagues to process`);
    
    // Process each league
    for (const league of leagues) {
      console.log(`\n🏈 Processing ${league.name} (${league.season})...`);
      const rosters = league.rosters;
      
      if (rosters.length === 0) {
        console.warn(`  ⚠️  No rosters found for ${league.name}, skipping...`);
        continue;
      }
      
      // Determine rounds based on league season
      const season = league.season;
      const rounds = season === '2021' ? 27 : 4; // 2021 was startup draft with 27 rounds
      
      console.log(`  📅 Creating ${rounds} rounds of picks for ${rosters.length} teams...`);
      
      let leaguePicksCreated = 0;
      
      for (let round = 1; round <= rounds; round++) {
        for (let teamIndex = 0; teamIndex < rosters.length; teamIndex++) {
          const roster = rosters[teamIndex];
          
          await prisma.draftPick.create({
            data: {
              leagueId: league.id,
              season: season,
              round: round,
              pickInRound: teamIndex + 1, // Position within round (1-12)
              
              // Sleeper roster IDs for API compatibility
              originalRosterId: roster.sleeperRosterId,
              currentRosterId: roster.sleeperRosterId,
              
              // Manager information for clarity
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
    }
    
    // Create future draft picks (2026-2028) using the most recent league as template
    const currentLeague = leagues.find(l => l.season === '2025');
    if (currentLeague && currentLeague.rosters.length > 0) {
      console.log(`\n🔮 Creating future draft picks (2026-2028)...`);
      
      const futureSeasons = ['2026', '2027', '2028'];
      for (const futureYear of futureSeasons) {
        console.log(`  📅 Creating ${futureYear} picks...`);
        
        let futurePicksCreated = 0;
        for (let round = 1; round <= 4; round++) { // 4 rounds for regular drafts
          for (let teamIndex = 0; teamIndex < currentLeague.rosters.length; teamIndex++) {
            const roster = currentLeague.rosters[teamIndex];
            
            await prisma.draftPick.create({
              data: {
                leagueId: currentLeague.id,
                season: futureYear,
                round: round,
                pickInRound: teamIndex + 1,
                
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
    
    const totalPicks = await prisma.draftPick.count();
    console.log(`\n✅ Total picks created: ${totalPicks}`);
    
  } catch (error) {
    console.error('❌ Error fixing draft picks:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
if (require.main === module) {
  fixDraftPicksScript()
    .then(() => {
      console.log('\n✨ Draft picks fix completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Draft picks fix failed:', error);
      process.exit(1);
    });
}

export { fixDraftPicksScript };