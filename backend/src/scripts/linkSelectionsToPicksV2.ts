import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function linkSelectionsToPicksV2(): Promise<void> {
  console.log('🔗 Starting improved draft selections to picks linking...');

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

    // Get all rosters mapped by roster ID for quick lookup
    const allRosters = await prisma.roster.findMany({
      include: { manager: true }
    });
    
    // Create a map: rosterId -> manager for quick lookups
    const rosterToManagerMap = new Map();
    allRosters.forEach(roster => {
      rosterToManagerMap.set(roster.sleeperRosterId, roster.manager);
    });

    let linked = 0;
    let notFound = 0;
    let errors = 0;

    for (const selection of selections) {
      try {
        const draft = selection.draft;
        const league = draft.league;
        const season = draft.season;
        const round = selection.round;
        const rosterId = selection.rosterId; // This is the Sleeper roster ID

        console.log(`Processing ${season} R${round}P${selection.pickNumber}: ${selection.player.fullName} (roster ${rosterId})`);

        // Find the manager who made this pick
        const manager = rosterToManagerMap.get(rosterId);
        if (!manager) {
          console.warn(`    ⚠️  No manager found for roster ID ${rosterId}`);
          notFound++;
          continue;
        }

        // Find the draft pick that matches:
        // 1. Same league, season, round
        // 2. Same original owner (manager who made the pick)
        const draftPick = await prisma.draftPick.findFirst({
          where: {
            leagueId: league.id,
            season: season,
            round: round,
            originalOwnerId: manager.id
          }
        });

        if (draftPick) {
          // Update the draft pick with selection information
          await prisma.draftPick.update({
            where: { id: draftPick.id },
            data: {
              selectedPlayerId: selection.player.id,
              draftId: draft.id,
              selectingOwnerId: manager.id,
              selectingOwnerName: manager.displayName || manager.username
            }
          });

          linked++;
          console.log(`    ✅ Linked to ${draftPick.originalOwnerName} (${manager.username})`);
        } else {
          console.warn(`    ❌ Could not find matching draft pick for ${season} R${round} owned by ${manager.username} (${manager.id})`);
          notFound++;
        }

      } catch (selectionError) {
        const errorMsg = selectionError instanceof Error ? selectionError.message : String(selectionError);
        console.error(`    💥 Error processing selection:`, errorMsg);
        errors++;
      }
    }

    // Summary
    console.log('\\n🎯 LINKING RESULTS');
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

    console.log('\\n🔍 FINAL STATE');
    console.log(`Draft picks with selections: ${withSelections}`);
    console.log(`Draft picks without selections: ${withoutSelections}`);

    // Check by year
    console.log('\\n📅 BY YEAR BREAKDOWN:');
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
  linkSelectionsToPicksV2()
    .then(() => {
      console.log('\\n✨ Draft selection linking completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\\n💥 Draft selection linking failed:', error);
      process.exit(1);
    });
}

export { linkSelectionsToPicksV2 };