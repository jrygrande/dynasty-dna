#!/usr/bin/env node

import { PrismaClient } from '@prisma/client';
import { dataSyncService } from '../services/dataSyncService';
import { historicalLeagueService } from '../services/historicalLeagueService';
import { config } from '../config';

const prisma = new PrismaClient();

interface SeedOptions {
  fullSync?: boolean;
  currentOnly?: boolean;
  clearCache?: boolean;
  verbose?: boolean;
}

async function seedDevData(options: SeedOptions = {}) {
  const testLeagueId = config.testLeagueId || '1191596293294166016';
  const testUsername = config.testUsername || 'jrygrande';
  
  console.log('🌱 Dynasty DNA - Development Data Seeder');
  console.log('==========================================');
  console.log(`📊 Test League: ${testLeagueId}`);
  console.log(`👤 Test Username: ${testUsername}`);
  console.log('');

  try {
    const startTime = Date.now();

    // Clear cache if requested
    if (options.clearCache) {
      console.log('🧹 Clearing API cache...');
      const { sleeperClient } = await import('../services/sleeperClient');
      sleeperClient.clearCache();
    }

    // Sync current season or full dynasty history
    if (options.currentOnly) {
      console.log('📈 Syncing current season only...');
      const result = await dataSyncService.syncLeague(testLeagueId);
      
      if (result.success) {
        console.log('✅ Current season sync completed successfully');
      } else {
        console.log('⚠️  Current season sync completed with warnings');
        if (options.verbose && result.errors.length > 0) {
          console.log('Errors:', result.errors);
        }
      }
    } else {
      console.log('🏛️  Syncing complete dynasty history...');
      const result = await historicalLeagueService.syncFullDynastyHistory(testLeagueId);
      
      console.log(`📊 Dynasty sync completed:`);
      console.log(`   • Total leagues: ${result.totalLeagues}`);
      console.log(`   • Synced: ${result.syncedLeagues.length}`);
      console.log(`   • Failed: ${result.failedLeagues.length}`);
      
      if (result.failedLeagues.length > 0 && options.verbose) {
        console.log('Failed leagues:', result.failedLeagues);
      }
    }

    // Ensure draft picks are created and linked
    console.log('\n🔧 Fixing draft picks with correct snake order and linking selections...');
    // TEMPORARILY DISABLED: fixDraftPicksWithSnakeOrder is destructive and has incorrect logic
    // const { fixDraftPicksWithSnakeOrder } = await import('./fixDraftPicksWithSnakeOrder');
    // await fixDraftPicksWithSnakeOrder();
    
    const { linkAllSelectionsToPicks } = await import('./linkAllSelectionsToPicks');
    await linkAllSelectionsToPicks();
    
    // Sync traded picks to ensure correct ownership
    console.log('\n🔄 Syncing traded draft picks to update ownership...');
    const { syncTradedPicks } = await import('./syncTradedPicks');
    await syncTradedPicks(testLeagueId);

    // Get final statistics
    const [
      leagueCount,
      transactionCount,
      playerCount,
      managerCount,
      draftCount
    ] = await Promise.all([
      prisma.league.count(),
      prisma.transaction.count(),
      prisma.player.count(),
      prisma.manager.count(),
      prisma.draft.count()
    ]);

    // Get transactions by season (for reference)
    // const _transactionsByLeague = await prisma.transaction.groupBy({
    //   by: ['leagueId'],
    //   _count: {
    //     id: true
    //   }
    // });

    const leagueStats = await prisma.league.findMany({
      select: {
        name: true,
        season: true,
        _count: {
          select: {
            transactions: true
          }
        }
      },
      orderBy: {
        season: 'desc'
      }
    });

    const endTime = Date.now();
    const duration = Math.round((endTime - startTime) / 1000);

    console.log('');
    console.log('📈 Final Database Statistics:');
    console.log('============================');
    console.log(`⚖️  Leagues: ${leagueCount}`);
    console.log(`🔄 Transactions: ${transactionCount.toLocaleString()}`);
    console.log(`🏈 Players: ${playerCount.toLocaleString()}`);
    console.log(`👥 Managers: ${managerCount}`);
    console.log(`📋 Drafts: ${draftCount}`);
    console.log('');
    console.log('📅 Transactions by Season:');
    leagueStats.forEach(league => {
      console.log(`   • ${league.season} ${league.name}: ${league._count.transactions.toLocaleString()} transactions`);
    });
    console.log('');
    console.log(`⏱️  Completed in ${duration} seconds`);
    console.log('✨ Development data seeding complete!');

  } catch (error) {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// CLI handling
if (require.main === module) {
  const args = process.argv.slice(2);
  const options: SeedOptions = {
    fullSync: !args.includes('--current-only'),
    currentOnly: args.includes('--current-only'),
    clearCache: args.includes('--clear-cache'),
    verbose: args.includes('--verbose') || args.includes('-v')
  };

  if (args.includes('--help') || args.includes('-h')) {
    console.log('Dynasty DNA Development Data Seeder');
    console.log('');
    console.log('Usage: npm run seed:dev [options]');
    console.log('');
    console.log('Options:');
    console.log('  --current-only    Sync only the current season');
    console.log('  --clear-cache     Clear API cache before syncing');
    console.log('  --verbose, -v     Show detailed output');
    console.log('  --help, -h        Show this help message');
    console.log('');
    console.log('Examples:');
    console.log('  npm run seed:dev                    # Sync full dynasty history');
    console.log('  npm run seed:dev -- --current-only  # Sync current season only');
    console.log('  npm run seed:dev -- --verbose       # Show detailed output');
    process.exit(0);
  }

  seedDevData(options).catch((error) => {
    console.error('Seeding failed:', error);
    process.exit(1);
  });
}

export { seedDevData };