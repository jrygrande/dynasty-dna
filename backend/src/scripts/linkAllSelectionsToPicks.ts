import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface LinkingStats {
  season: string;
  totalSelections: number;
  successfulLinks: number;
  failedLinks: number;
  errors: string[];
}

async function linkAllSelectionsToPicks(): Promise<void> {
  console.log('🔗 Starting comprehensive draft selections to picks linking...');
  
  const stats: LinkingStats[] = [];
  
  try {
    // Get all draft selections with their related data
    const selections = await prisma.draftSelection.findMany({
      include: {
        draft: {
          include: { league: true }
        },
        player: true
      },
      orderBy: [
        { draft: { season: 'asc' } },
        { pickNumber: 'asc' }
      ]
    });

    console.log(`📊 Found ${selections.length} draft selections to process`);
    
    // Group selections by season for reporting
    const selectionsBySeason = new Map<string, typeof selections>();
    selections.forEach(selection => {
      const season = selection.draft.season;
      if (!selectionsBySeason.has(season)) {
        selectionsBySeason.set(season, []);
      }
      selectionsBySeason.get(season)!.push(selection);
    });
    
    // Process each season
    for (const [season, seasonSelections] of selectionsBySeason) {
      console.log(`\n📅 Processing ${season} (${seasonSelections.length} selections)...`);
      
      const seasonStats: LinkingStats = {
        season,
        totalSelections: seasonSelections.length,
        successfulLinks: 0,
        failedLinks: 0,
        errors: []
      };
      
      for (const selection of seasonSelections) {
        try {
          const draft = selection.draft;
          const league = draft.league;
          
          // Find the corresponding draft pick using precise matching
          const draftPick = await prisma.draftPick.findFirst({
            where: {
              leagueId: league.id,
              season: draft.season,
              round: selection.round,
              pickInRound: selection.draftSlot // This is the key mapping
            }
          });
          
          if (draftPick) {
            // Find the manager who made this pick using roster ID
            const manager = await prisma.manager.findFirst({
              where: {
                rosters: {
                  some: {
                    sleeperRosterId: selection.rosterId
                  }
                }
              }
            });
            
            // Update the draft pick with selection information
            await prisma.draftPick.update({
              where: { id: draftPick.id },
              data: {
                selectedPlayerId: selection.player.id,
                draftId: draft.id,
                selectingOwnerId: manager?.id || null,
                selectingOwnerName: manager?.displayName || manager?.username || selection.pickedBy
              }
            });
            
            seasonStats.successfulLinks++;
            console.log(`    ✅ R${selection.round}P${selection.pickNumber} → ${selection.player.fullName} (slot ${selection.draftSlot})`);
          } else {
            seasonStats.failedLinks++;
            const error = `No draft pick found for R${selection.round} slot ${selection.draftSlot} (pick ${selection.pickNumber})`;
            seasonStats.errors.push(error);
            console.warn(`    ❌ ${error}`);
          }
          
        } catch (selectionError) {
          seasonStats.failedLinks++;
          const errorMsg = `Pick ${selection.pickNumber}: ${selectionError instanceof Error ? selectionError.message : String(selectionError)}`;
          seasonStats.errors.push(errorMsg);
          console.error(`    💥 ${errorMsg}`);
        }
      }
      
      stats.push(seasonStats);
      console.log(`    📋 ${season} Summary: ${seasonStats.successfulLinks}/${seasonStats.totalSelections} linked, ${seasonStats.failedLinks} failed`);
    }
    
    // Overall summary
    console.log('\n🎯 LINKING RESULTS');
    console.log('==================');
    
    const totalSelections = stats.reduce((sum, s) => sum + s.totalSelections, 0);
    const totalSuccessful = stats.reduce((sum, s) => sum + s.successfulLinks, 0);
    const totalFailed = stats.reduce((sum, s) => sum + s.failedLinks, 0);
    
    console.log(`📊 Total Selections: ${totalSelections}`);
    console.log(`✅ Successfully Linked: ${totalSuccessful}`);
    console.log(`❌ Failed Links: ${totalFailed}`);
    console.log(`📈 Success Rate: ${((totalSuccessful / totalSelections) * 100).toFixed(1)}%`);
    
    // Season breakdown
    stats.forEach(s => {
      const rate = ((s.successfulLinks / s.totalSelections) * 100).toFixed(1);
      console.log(`  ${s.season}: ${s.successfulLinks}/${s.totalSelections} (${rate}%)`);
    });
    
    // Show errors if any
    if (totalFailed > 0) {
      console.log('\n❌ ERRORS ENCOUNTERED:');
      stats.forEach(s => {
        if (s.errors.length > 0) {
          console.log(`  ${s.season}:`);
          s.errors.forEach(e => console.log(`    - ${e}`));
        }
      });
    }
    
    // Verification
    console.log('\n🔍 VERIFICATION');
    const picksWithSelections = await prisma.draftPick.count({
      where: { selectedPlayerId: { not: null } }
    });
    const picksWithoutSelections = await prisma.draftPick.count({
      where: { selectedPlayerId: null }
    });
    
    console.log(`Draft picks with selections: ${picksWithSelections}`);
    console.log(`Draft picks without selections: ${picksWithoutSelections}`);
    
    // Verification by season
    console.log('\n📅 VERIFICATION BY SEASON:');
    const seasons = ['2021', '2022', '2023', '2024', '2025', '2026', '2027', '2028'];
    for (const year of seasons) {
      const yearWithSelections = await prisma.draftPick.count({
        where: {
          season: year,
          selectedPlayerId: { not: null }
        }
      });
      const yearTotal = await prisma.draftPick.count({
        where: { season: year }
      });
      const status = parseInt(year) <= 2025 ? (yearWithSelections === yearTotal ? '✅' : '⚠️ ') : '🔮';
      console.log(`  ${status} ${year}: ${yearWithSelections}/${yearTotal} picks with selections`);
    }
    
  } catch (error) {
    console.error('❌ Fatal error during linking:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
if (require.main === module) {
  linkAllSelectionsToPicks()
    .then(() => {
      console.log('\n✨ Draft selections linking completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Draft selections linking failed:', error);
      process.exit(1);
    });
}

export { linkAllSelectionsToPicks };