import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function linkSelectionsToPicksScript(): Promise<void> {
  console.log('🔗 Starting to link draft selections to draft picks...');

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

    let linked = 0;
    let notFound = 0;
    let errors = 0;

    for (const selection of selections) {
      try {
        const draft = selection.draft;
        const league = draft.league;
        const season = draft.season;
        const round = selection.round;
        const draftSlot = selection.draftSlot;

        console.log(`Processing ${season} R${round}P${selection.pickNumber}: ${selection.player.fullName}`);

        // Find the original owner based on draft slot
        // In dynasty leagues, draft slot typically corresponds to reverse standings
        // We need to map draftSlot to the original roster that owned that pick
        
        // Get all rosters for this league ordered by sleeperRosterId
        const rosters = await prisma.roster.findMany({
          where: { leagueId: league.id },
          include: { manager: true },
          orderBy: { sleeperRosterId: 'asc' }
        });

        if (rosters.length === 0) {
          console.warn(`    ⚠️  No rosters found for league ${league.name} (${season})`);
          notFound++;
          continue;
        }

        // Try to find the draft pick by matching with the original owner
        // The draftSlot represents the position in the round (1-12)
        // We need to find which roster originally owned that slot
        let draftPick = null;

        // Method 1: Try to find by draft slot matching roster order
        const originalRosterIndex = draftSlot - 1; // Convert 1-based to 0-based
        if (originalRosterIndex >= 0 && originalRosterIndex < rosters.length) {
          const originalRoster = rosters[originalRosterIndex];
          
          draftPick = await prisma.draftPick.findFirst({
            where: {
              leagueId: league.id,
              season: season,
              round: round,
              originalOwnerId: originalRoster.manager.id
            }
          });
        }

        // Method 2: If not found, try to find any unassigned pick for this round/season
        if (!draftPick) {
          draftPick = await prisma.draftPick.findFirst({
            where: {
              leagueId: league.id,
              season: season,
              round: round,
              selectedPlayerId: null // Not yet assigned
            }
          });
        }

        if (draftPick) {
          // Update the draft pick with selection information
          await prisma.draftPick.update({
            where: { id: draftPick.id },
            data: {
              selectedPlayerId: selection.player.id,
              draftId: draft.id,
              // Update current owner to whoever actually made the selection
              // This accounts for traded picks
              selectingOwnerId: draftPick.currentOwnerId, // Use current owner as selector
              selectingOwnerName: draftPick.currentOwnerName
            }
          });

          linked++;
          console.log(`    ✅ Linked to ${draftPick.originalOwnerName} → ${draftPick.currentOwnerName}`);
        } else {
          console.warn(`    ❌ Could not find matching draft pick for ${season} R${round} slot ${draftSlot}`);
          notFound++;
        }

      } catch (selectionError) {
        const errorMsg = selectionError instanceof Error ? selectionError.message : String(selectionError);
        console.error(`    💥 Error processing selection:`, errorMsg);
        errors++;
      }
    }

    // Summary
    console.log('\n🎯 LINKING RESULTS');
    console.log('==================');
    console.log(`✅ Successfully linked: ${linked}`);
    console.log(`❌ Not found: ${notFound}`);
    console.log(`💥 Errors: ${errors}`);

    // Verify the results
    const withSelections = await prisma.draftPick.count({
      where: { selectedPlayerId: { not: null } }
    });
    const withoutSelections = await prisma.draftPick.count({
      where: { selectedPlayerId: null }
    });

    console.log('\n🔍 FINAL STATE');
    console.log(`Draft picks with selections: ${withSelections}`);
    console.log(`Draft picks without selections: ${withoutSelections}`);

    // Check by year
    console.log('\n📅 BY YEAR BREAKDOWN:');
    const years = ['2021', '2022', '2023', '2024', '2025'];
    for (const year of years) {
      const yearWithSelections = await prisma.draftPick.count({
        where: {
          season: year,
          selectedPlayerId: { not: null }
        }
      });
      const yearTotal = await prisma.draftPick.count({
        where: { season: year }
      });
      console.log(`  ${year}: ${yearWithSelections}/${yearTotal} picks with selections`);
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
  linkSelectionsToPicksScript()
    .then(() => {
      console.log('\n✨ Draft selection linking completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Draft selection linking failed:', error);
      process.exit(1);
    });
}

export { linkSelectionsToPicksScript };