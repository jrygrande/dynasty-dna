#!/usr/bin/env node

import { PrismaClient } from '@prisma/client';
import { config } from '../config';

const prisma = new PrismaClient();

interface LeagueStats {
  id: string;
  name: string;
  season: string;
  sleeperLeagueId: string;
  transactions: number;
  rosters: number;
  matchups: number;
  playerScores: number;
  draftPicks: number;
  lastUpdated: Date;
}

async function getLeagueStats(): Promise<LeagueStats[]> {
  const leagues = await prisma.league.findMany({
    include: {
      _count: {
        select: {
          transactions: true,
          rosters: true,
          matchupResults: true,
          playerWeeklyScores: true,
          draftPicks: true
        }
      }
    },
    orderBy: {
      season: 'desc'
    }
  });

  return leagues.map(league => ({
    id: league.id,
    name: league.name,
    season: league.season,
    sleeperLeagueId: league.sleeperLeagueId,
    transactions: league._count.transactions,
    rosters: league._count.rosters,
    matchups: league._count.matchupResults,
    playerScores: league._count.playerWeeklyScores,
    draftPicks: league._count.draftPicks,
    lastUpdated: league.updatedAt
  }));
}

async function getTransactionWeekCoverage() {
  const coverage = await prisma.transaction.groupBy({
    by: ['leagueId', 'week'],
    _count: {
      id: true
    },
    orderBy: [
      { leagueId: 'asc' },
      { week: 'asc' }
    ]
  });

  const leagueIds = await prisma.league.findMany({
    select: { id: true, season: true, name: true }
  });

  const leagueMap = leagueIds.reduce((acc, league) => {
    acc[league.id] = { season: league.season, name: league.name };
    return acc;
  }, {} as Record<string, { season: string; name: string }>);

  const coverageByLeague: Record<string, { season: string; name: string; weeks: Array<{ week: number; count: number }> }> = {};

  coverage.forEach(item => {
    if (!coverageByLeague[item.leagueId]) {
      coverageByLeague[item.leagueId] = {
        season: leagueMap[item.leagueId]?.season || 'Unknown',
        name: leagueMap[item.leagueId]?.name || 'Unknown',
        weeks: []
      };
    }
    if (item.week) {
      coverageByLeague[item.leagueId].weeks.push({
        week: item.week,
        count: item._count.id
      });
    }
  });

  return coverageByLeague;
}

async function checkDbStats() {
  console.log('📊 Dynasty DNA - Database Statistics');
  console.log('===================================');
  console.log('');

  try {
    // Overall database stats
    const [
      totalLeagues,
      totalTransactions,
      totalPlayers,
      totalManagers,
      totalRosters,
      totalMatchups,
      totalPlayerScores,
      totalDrafts
    ] = await Promise.all([
      prisma.league.count(),
      prisma.transaction.count(),
      prisma.player.count(),
      prisma.manager.count(),
      prisma.roster.count(),
      prisma.matchupResult.count(),
      prisma.playerWeeklyScore.count(),
      prisma.draft.count()
    ]);

    console.log('🗄️  Overall Database Counts:');
    console.log(`   Leagues: ${totalLeagues}`);
    console.log(`   Transactions: ${totalTransactions.toLocaleString()}`);
    console.log(`   Players: ${totalPlayers.toLocaleString()}`);
    console.log(`   Managers: ${totalManagers}`);
    console.log(`   Rosters: ${totalRosters}`);
    console.log(`   Matchups: ${totalMatchups.toLocaleString()}`);
    console.log(`   Player Scores: ${totalPlayerScores.toLocaleString()}`);
    console.log(`   Drafts: ${totalDrafts}`);
    console.log('');

    // Per-league stats
    const leagueStats = await getLeagueStats();
    console.log('📅 Per-League Statistics:');
    console.log('=========================');
    
    leagueStats.forEach(league => {
      const timeSinceUpdate = Math.round((Date.now() - league.lastUpdated.getTime()) / (1000 * 60 * 60));
      console.log(`\n🏆 ${league.season} - ${league.name}`);
      console.log(`   ID: ${league.sleeperLeagueId}`);
      console.log(`   Transactions: ${league.transactions.toLocaleString()}`);
      console.log(`   Rosters: ${league.rosters}`);
      console.log(`   Matchups: ${league.matchups.toLocaleString()}`);
      console.log(`   Player Scores: ${league.playerScores.toLocaleString()}`);
      console.log(`   Draft Picks: ${league.draftPicks}`);
      console.log(`   Last Updated: ${timeSinceUpdate}h ago`);
    });

    // Transaction week coverage
    console.log('\n📊 Transaction Week Coverage:');
    console.log('=============================');
    
    const weekCoverage = await getTransactionWeekCoverage();
    Object.entries(weekCoverage).forEach(([, data]) => {
      console.log(`\n📈 ${data.season} - ${data.name}:`);
      if (data.weeks.length === 0) {
        console.log('   No transactions with week data');
      } else {
        const weekRanges: string[] = [];
        let currentRange: { start: number; end: number; count: number } | null = null;

        data.weeks.forEach(week => {
          if (!currentRange || week.week !== currentRange.end + 1) {
            if (currentRange) {
              if (currentRange.start === currentRange.end) {
                weekRanges.push(`Week ${currentRange.start} (${currentRange.count})`);
              } else {
                weekRanges.push(`Weeks ${currentRange.start}-${currentRange.end} (${currentRange.count} total)`);
              }
            }
            currentRange = { start: week.week, end: week.week, count: week.count };
          } else {
            currentRange.end = week.week;
            currentRange.count += week.count;
          }
        });

        if (currentRange !== null) {
          if (currentRange.start === currentRange.end) {
            weekRanges.push(`Week ${currentRange.start} (${currentRange.count})`);
          } else {
            weekRanges.push(`Weeks ${currentRange.start}-${currentRange.end} (${currentRange.count} total)`);
          }
        }

        console.log(`   ${weekRanges.join(', ')}`);
      }
    });

    // Test league verification
    const testLeagueId = config.testLeagueId || '1191596293294166016';
    console.log('\n🧪 Test League Verification:');
    console.log('============================');
    console.log(`Test League ID: ${testLeagueId}`);
    
    const testLeague = await prisma.league.findUnique({
      where: { sleeperLeagueId: testLeagueId },
      include: {
        _count: {
          select: {
            transactions: true,
            rosters: true
          }
        }
      }
    });

    if (testLeague) {
      console.log(`✅ Test league found: ${testLeague.season} ${testLeague.name}`);
      console.log(`   Transactions: ${testLeague._count.transactions}`);
      console.log(`   Rosters: ${testLeague._count.rosters}`);
    } else {
      console.log('❌ Test league not found in database');
    }

    // Dynasty chain verification
    console.log('\n🏛️  Dynasty Chain Verification:');
    console.log('==============================');
    
    const dynastyChain = await prisma.league.findMany({
      where: {
        OR: [
          { sleeperLeagueId: testLeagueId },
          { sleeperPreviousLeagueId: { not: null } }
        ]
      },
      select: {
        season: true,
        name: true,
        sleeperLeagueId: true,
        sleeperPreviousLeagueId: true
      },
      orderBy: { season: 'asc' }
    });

    if (dynastyChain.length > 0) {
      console.log('Dynasty chain found:');
      dynastyChain.forEach(league => {
        const linkIndicator = league.sleeperPreviousLeagueId ? '↳' : '•';
        console.log(`   ${linkIndicator} ${league.season}: ${league.sleeperLeagueId}`);
      });
    } else {
      console.log('No dynasty chain found');
    }

    console.log('\n✨ Database statistics complete!');

  } catch (error) {
    console.error('❌ Failed to get database statistics:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// CLI handling
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Dynasty DNA Database Statistics Tool');
    console.log('');
    console.log('Usage: npm run db:stats');
    console.log('');
    console.log('Shows comprehensive database statistics including:');
    console.log('  • Overall counts for all data types');
    console.log('  • Per-league breakdowns');
    console.log('  • Transaction week coverage');
    console.log('  • Test league verification');
    console.log('  • Dynasty chain verification');
    process.exit(0);
  }

  checkDbStats().catch((error) => {
    console.error('Statistics check failed:', error);
    process.exit(1);
  });
}

export { checkDbStats };