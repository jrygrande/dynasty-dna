import { PrismaClient } from '@prisma/client';
import { sleeperClient } from '../../services/sleeperClient';

const prisma = new PrismaClient();

/**
 * Sync historical roster data for all dynasty seasons
 * 
 * This is critical for establishing roster ID → manager ID mappings
 * needed to properly process draft pick transactions.
 */
async function syncHistoricalRosters(): Promise<void> {
  console.log('🏈 Starting historical rosters sync for all dynasty seasons...\n');

  try {
    // Get all leagues ordered by season
    const leagues = await prisma.league.findMany({
      orderBy: { season: 'asc' }
    });

    console.log(`📊 Found ${leagues.length} leagues to sync rosters for\n`);

    let totalRostersSynced = 0;
    let totalManagersCreated = 0;

    for (const league of leagues) {
      console.log(`🏈 Processing league: ${league.name} (${league.season})`);
      console.log(`   Sleeper ID: ${league.sleeperLeagueId}`);

      try {
        // Check if rosters already exist for this league
        const existingRosters = await prisma.roster.count({
          where: { leagueId: league.id }
        });

        if (existingRosters > 0) {
          console.log(`   ✅ ${existingRosters} rosters already exist, skipping...`);
          continue;
        }

        // Fetch rosters from Sleeper API
        const sleeperRosters = await sleeperClient.getLeagueRosters(league.sleeperLeagueId);
        console.log(`   📥 Fetched ${sleeperRosters.length} rosters from Sleeper`);

        // Fetch users to get full user info
        const sleeperUsers = await sleeperClient.getLeagueUsers(league.sleeperLeagueId);
        console.log(`   👥 Fetched ${sleeperUsers.length} users from Sleeper`);

        let rostersCreated = 0;
        let managersCreated = 0;

        for (const sleeperRoster of sleeperRosters) {
          // Find the user for this roster
          const user = sleeperUsers.find(u => u.user_id === sleeperRoster.owner_id);
          
          if (!user) {
            console.log(`   ⚠️  Could not find user for roster ${sleeperRoster.roster_id}`);
            continue;
          }

          // Create or find manager
          const manager = await prisma.manager.upsert({
            where: { sleeperUserId: user.user_id },
            update: {
              username: user.username || user.display_name || 'Unknown',
              displayName: user.display_name,
              avatar: user.avatar,
              teamName: user.metadata?.team_name,
              updatedAt: new Date()
            },
            create: {
              sleeperUserId: user.user_id,
              username: user.username || user.display_name || 'Unknown',
              displayName: user.display_name,
              avatar: user.avatar,
              teamName: user.metadata?.team_name
            }
          });

          if (!managersCreated) {
            console.log(`   👤 Manager: ${manager.username} (${user.user_id})`);
            managersCreated++;
          }

          // Create roster record
          const roster = await prisma.roster.create({
            data: {
              leagueId: league.id,
              managerId: manager.id,
              sleeperRosterId: sleeperRoster.roster_id,
              wins: sleeperRoster.settings?.wins || 0,
              losses: sleeperRoster.settings?.losses || 0,
              ties: sleeperRoster.settings?.ties || 0,
              fpts: sleeperRoster.settings?.fpts || 0,
              fptsAgainst: sleeperRoster.settings?.fpts_against || 0,
              fptsDecimal: sleeperRoster.settings?.fpts_decimal || 0,
              fptsAgainstDecimal: sleeperRoster.settings?.fpts_against_decimal || 0,
              waiveBudgetUsed: sleeperRoster.settings?.waiver_budget_used || 0,
              waiverPosition: sleeperRoster.settings?.waiver_position,
              totalMoves: sleeperRoster.settings?.total_moves || 0
            }
          });

          rostersCreated++;
          totalRostersSynced++;

          console.log(`   📊 Created roster ${sleeperRoster.roster_id} for ${manager.username}`);
        }

        console.log(`   ✅ Created ${rostersCreated} rosters for ${league.season}\n`);

        // Add delay to be respectful to API
        await new Promise(resolve => setTimeout(resolve, 500));

      } catch (error) {
        console.error(`   ❌ Error syncing rosters for ${league.season}:`, error);
      }
    }

    console.log('='.repeat(80));
    console.log('📋 HISTORICAL ROSTERS SYNC SUMMARY');
    console.log('='.repeat(80));
    console.log(`📊 Total rosters synced: ${totalRostersSynced}`);
    console.log(`👥 Total managers processed: ${totalManagersCreated}`);
    console.log(`🏈 Leagues processed: ${leagues.length}`);

    // Verify roster counts per league
    console.log('\n📈 Roster counts by league:');
    for (const league of leagues) {
      const rosterCount = await prisma.roster.count({
        where: { leagueId: league.id }
      });
      console.log(`   ${league.season}: ${rosterCount} rosters`);
    }

    if (totalRostersSynced > 0) {
      console.log('\n🎉 Historical rosters sync completed successfully!');
      console.log('💡 Now run fixMissingDraftPickItems.ts to restore draft pick data.');
    } else {
      console.log('\n✅ All rosters were already synced.');
    }

  } catch (error) {
    console.error('❌ Failed to sync historical rosters:', error);
    throw error;
  }
}

/**
 * Main execution
 */
async function main() {
  try {
    await syncHistoricalRosters();
    process.exit(0);
  } catch (error) {
    console.error('Historical rosters sync failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

export { syncHistoricalRosters };