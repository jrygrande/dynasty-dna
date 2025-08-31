import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from './middleware/errorHandlers';
import { dataSyncService } from '../services/dataSyncService';
import { historicalLeagueService } from '../services/historicalLeagueService';
import { sleeperClient } from '../services/sleeperClient';
import { PrismaClient } from '@prisma/client';
import { config } from '../config';

const prisma = new PrismaClient();
export const testRouter = Router();

// POST /api/test/sync-test-league - Sync the Dynasty Domination test league
testRouter.post('/sync-test-league', asyncHandler(async (req, res) => {
  const testLeagueId = config.testLeagueId || '1191596293294166016';
  
  try {
    console.log(`🧪 Starting test league sync: ${testLeagueId}`);
    
    const startTime = Date.now();
    const syncResult = await dataSyncService.syncLeague(testLeagueId);
    const endTime = Date.now();
    const duration = endTime - startTime;

    // Get some stats about what was synced
    const league = await prisma.league.findUnique({
      where: { sleeperLeagueId: testLeagueId },
      include: {
        _count: {
          select: {
            transactions: true,
            rosters: true,
            playerWeeklyScores: true,
            matchupResults: true
          }
        }
      }
    });

    res.status(syncResult.success ? 200 : 206).json({
      message: 'Test league sync completed',
      testLeagueId,
      leagueName: league?.name || 'Unknown',
      status: syncResult.success ? 'success' : 'partial',
      duration: `${duration}ms`,
      synced: syncResult.synced,
      errors: syncResult.errors,
      dataCount: league?._count || null,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error(`❌ Test league sync failed:`, error);
    res.status(500).json({
      message: 'Test league sync failed',
      testLeagueId,
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
}));

// POST /api/test/sync-dynasty-history - Sync complete dynasty history for test league
testRouter.post('/sync-dynasty-history', asyncHandler(async (req, res) => {
  const testLeagueId = config.testLeagueId || '1191596293294166016';
  
  try {
    console.log(`🧪 Starting dynasty history sync for test league: ${testLeagueId}`);
    
    const startTime = Date.now();
    const syncResult = await historicalLeagueService.syncFullDynastyHistory(testLeagueId);
    const endTime = Date.now();
    const duration = endTime - startTime;

    res.status(syncResult.success ? 200 : 206).json({
      message: 'Dynasty history sync completed',
      testLeagueId,
      status: syncResult.success ? 'success' : 'partial',
      duration: `${duration}ms`,
      syncedLeagues: syncResult.syncedLeagues,
      failedLeagues: syncResult.failedLeagues,
      totalLeagues: syncResult.totalLeagues,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error(`❌ Dynasty history sync failed:`, error);
    res.status(500).json({
      message: 'Dynasty history sync failed',
      testLeagueId,
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
}));

// GET /api/test/dynasty-chain - Get dynasty chain for test league
testRouter.get('/dynasty-chain', asyncHandler(async (req, res) => {
  const testLeagueId = config.testLeagueId || '1191596293294166016';
  
  try {
    console.log(`🧪 Getting dynasty chain for test league: ${testLeagueId}`);
    
    const dynastyChain = await historicalLeagueService.getLeagueHistory(testLeagueId);
    
    res.status(200).json({
      testLeagueId,
      dynastyChain,
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error(`❌ Failed to get dynasty chain:`, error);
    res.status(500).json({
      message: 'Failed to get dynasty chain',
      testLeagueId,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}));

// GET /api/test/search-user - Search for test username
testRouter.get('/search-user', asyncHandler(async (req, res) => {
  const testUsername = config.testUsername || 'jrygrande';
  
  try {
    console.log(`🧪 Searching for test username: ${testUsername}`);
    
    const searchResult = await historicalLeagueService.findLeaguesByUsername(testUsername);
    
    res.status(200).json({
      testUsername,
      searchResult,
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error(`❌ Failed to search for test user:`, error);
    res.status(500).json({
      message: 'Failed to search for test user',
      testUsername,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}));

// GET /api/test/api-status - Check Sleeper API connectivity and rate limiting
testRouter.get('/api-status', asyncHandler(async (req, res) => {
  try {
    console.log(`🧪 Testing Sleeper API connectivity`);
    
    const startTime = Date.now();
    
    // Test basic API call
    const nflState = await sleeperClient.getNFLState();
    const apiCallTime = Date.now() - startTime;
    
    // Test cache stats
    const cacheStats = sleeperClient.getCacheStats();
    
    // Test rate limiting by making a few calls
    const rateLimitTestStart = Date.now();
    await Promise.all([
      sleeperClient.getUser(config.testUsername || 'jrygrande'),
      sleeperClient.getLeague(config.testLeagueId || '1191596293294166016')
    ]);
    const rateLimitTestTime = Date.now() - rateLimitTestStart;

    res.status(200).json({
      status: 'healthy',
      apiConnection: 'success',
      apiCallTime: `${apiCallTime}ms`,
      rateLimitTestTime: `${rateLimitTestTime}ms`,
      cacheStats,
      nflState: {
        season: nflState.season,
        week: nflState.week,
        seasonType: nflState.season_type
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error(`❌ API status check failed:`, error);
    res.status(500).json({
      status: 'unhealthy',
      apiConnection: 'failed',
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
}));

// GET /api/test/database-stats - Get database statistics
testRouter.get('/database-stats', asyncHandler(async (req, res) => {
  try {
    console.log(`🧪 Getting database statistics`);
    
    const [
      leagueCount,
      playerCount,
      managerCount,
      transactionCount,
      playerScoreCount,
      matchupCount,
      draftPickCount
    ] = await Promise.all([
      prisma.league.count(),
      prisma.player.count(),
      prisma.manager.count(),
      prisma.transaction.count(),
      prisma.playerWeeklyScore.count(),
      prisma.matchupResult.count(),
      prisma.draftPick.count()
    ]);

    // Get most recent sync
    const mostRecentLeague = await prisma.league.findFirst({
      orderBy: { updatedAt: 'desc' },
      select: {
        name: true,
        season: true,
        updatedAt: true
      }
    });

    res.status(200).json({
      status: 'healthy',
      counts: {
        leagues: leagueCount,
        players: playerCount,
        managers: managerCount,
        transactions: transactionCount,
        playerScores: playerScoreCount,
        matchups: matchupCount,
        draftPicks: draftPickCount
      },
      mostRecentSync: mostRecentLeague ? {
        leagueName: mostRecentLeague.name,
        season: mostRecentLeague.season,
        lastSynced: mostRecentLeague.updatedAt
      } : null,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error(`❌ Database stats failed:`, error);
    res.status(500).json({
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
}));

// POST /api/test/clear-cache - Clear Sleeper API cache
testRouter.post('/clear-cache', asyncHandler(async (req, res) => {
  try {
    console.log(`🧪 Clearing Sleeper API cache`);
    
    const statsBefore = sleeperClient.getCacheStats();
    sleeperClient.clearCache();
    const statsAfter = sleeperClient.getCacheStats();

    res.status(200).json({
      message: 'Cache cleared successfully',
      statsBefore,
      statsAfter,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error(`❌ Cache clear failed:`, error);
    res.status(500).json({
      message: 'Failed to clear cache',
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
}));