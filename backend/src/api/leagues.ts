import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from './middleware/errorHandlers';
import { dataSyncService } from '../services/dataSyncService';
import { sleeperClient } from '../services/sleeperClient';
import { historicalLeagueService } from '../services/historicalLeagueService';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
export const leaguesRouter = Router();

const syncLeagueSchema = z.object({
  leagueId: z.string(),
});

const leagueParamsSchema = z.object({
  leagueId: z.string(),
});

// POST /api/leagues/:leagueId/sync - Sync league data from Sleeper
leaguesRouter.post('/:leagueId/sync', asyncHandler(async (req, res) => {
  const { leagueId } = syncLeagueSchema.parse(req.params);
  
  console.log(`🔄 Starting sync for league: ${leagueId}`);
  
  try {
    // Validate league exists in Sleeper
    const leagueData = await sleeperClient.getLeague(leagueId);
    
    // Perform the sync
    const syncResult = await dataSyncService.syncLeague(leagueId);
    
    if (syncResult.success) {
      console.log(`✅ Successfully synced league: ${leagueId}`);
      res.status(200).json({
        message: 'League sync completed successfully',
        leagueId,
        leagueName: leagueData.name,
        season: leagueData.season,
        status: 'completed',
        synced: syncResult.synced,
        timestamp: new Date().toISOString()
      });
    } else {
      console.warn(`⚠️ Partial sync for league: ${leagueId}`, syncResult.errors);
      res.status(206).json({
        message: 'League sync completed with some errors',
        leagueId,
        leagueName: leagueData.name,
        season: leagueData.season,
        status: 'partial',
        synced: syncResult.synced,
        errors: syncResult.errors,
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    console.error(`❌ Failed to sync league: ${leagueId}`, error);
    res.status(500).json({
      message: 'League sync failed',
      leagueId,
      status: 'failed',
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
}));

// GET /api/leagues/:leagueId - Get league details
leaguesRouter.get('/:leagueId', asyncHandler(async (req, res) => {
  const { leagueId } = leagueParamsSchema.parse(req.params);
  
  try {
    // Try to get from database first
    const dbLeague = await prisma.league.findUnique({
      where: { sleeperLeagueId: leagueId },
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

    if (dbLeague) {
      res.status(200).json({
        source: 'database',
        league: {
          id: dbLeague.id,
          sleeperLeagueId: dbLeague.sleeperLeagueId,
          name: dbLeague.name,
          season: dbLeague.season,
          seasonType: dbLeague.seasonType,
          status: dbLeague.status,
          sport: dbLeague.sport,
          totalRosters: dbLeague.totalRosters,
          rosterPositions: JSON.parse(dbLeague.rosterPositions),
          scoringSettings: JSON.parse(dbLeague.scoringSettings),
          previousLeagueId: dbLeague.previousLeagueId,
          sleeperPreviousLeagueId: dbLeague.sleeperPreviousLeagueId,
          lastSynced: dbLeague.updatedAt,
          dataCount: {
            transactions: dbLeague._count.transactions,
            rosters: dbLeague._count.rosters,
            playerScores: dbLeague._count.playerWeeklyScores,
            matchups: dbLeague._count.matchupResults
          }
        }
      });
    } else {
      // Fallback to Sleeper API
      const sleeperLeague = await sleeperClient.getLeague(leagueId);
      
      res.status(200).json({
        source: 'sleeper_api',
        league: {
          sleeperLeagueId: leagueId,
          name: sleeperLeague.name,
          season: sleeperLeague.season,
          seasonType: sleeperLeague.season_type,
          status: sleeperLeague.status,
          sport: sleeperLeague.sport,
          totalRosters: sleeperLeague.total_rosters,
          rosterPositions: sleeperLeague.roster_positions,
          scoringSettings: sleeperLeague.scoring_settings,
          previousLeagueId: sleeperLeague.previous_league_id,
          needsSync: true
        }
      });
    }
  } catch (error) {
    console.error(`❌ Failed to get league: ${leagueId}`, error);
    res.status(404).json({
      message: 'League not found',
      leagueId,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}));

// GET /api/leagues/:leagueId/transactions - Get league transactions from database
leaguesRouter.get('/:leagueId/transactions', asyncHandler(async (req, res) => {
  const { leagueId } = leagueParamsSchema.parse(req.params);
  
  const { limit = '50', offset = '0', type, week } = z.object({
    limit: z.string().optional(),
    offset: z.string().optional(),
    type: z.string().optional(),
    week: z.string().optional(),
  }).parse(req.query);

  try {
    // Find the internal league ID
    const league = await prisma.league.findUnique({
      where: { sleeperLeagueId: leagueId }
    });

    if (!league) {
      return res.status(404).json({
        message: 'League not found in database. Please sync the league first.',
        leagueId,
        syncEndpoint: `/api/leagues/${leagueId}/sync`
      });
    }

    // Build query conditions
    const where: any = { leagueId: league.id };
    if (type) where.type = type;
    if (week) where.week = parseInt(week);

    const transactions = await prisma.transaction.findMany({
      where,
      include: {
        items: {
          include: {
            player: {
              select: {
                id: true,
                sleeperId: true,
                fullName: true,
                position: true,
                team: true
              }
            },
            manager: {
              select: {
                id: true,
                username: true,
                displayName: true
              }
            }
          }
        }
      },
      orderBy: { timestamp: 'desc' },
      take: parseInt(limit),
      skip: parseInt(offset)
    });

    const totalCount = await prisma.transaction.count({ where });

    res.status(200).json({
      leagueId,
      leagueName: league.name,
      transactions: transactions.map(t => ({
        id: t.id,
        sleeperTransactionId: t.sleeperTransactionId,
        type: t.type,
        status: t.status,
        week: t.week,
        leg: t.leg,
        timestamp: t.timestamp.toString(),
        creator: t.creator,
        consenterIds: t.consenterIds ? JSON.parse(t.consenterIds) : null,
        rosterIds: t.rosterIds ? JSON.parse(t.rosterIds) : null,
        metadata: t.metadata ? JSON.parse(t.metadata) : null,
        items: t.items,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt
      })),
      pagination: {
        total: totalCount,
        limit: parseInt(limit),
        offset: parseInt(offset),
        hasMore: parseInt(offset) + transactions.length < totalCount
      }
    });
  } catch (error) {
    console.error(`❌ Failed to get transactions for league: ${leagueId}`, error);
    res.status(500).json({
      message: 'Failed to fetch transactions',
      leagueId,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}));

// POST /api/leagues/:leagueId/transactions/sync - Force refresh transactions from Sleeper
leaguesRouter.post('/:leagueId/transactions/sync', asyncHandler(async (req, res) => {
  const { leagueId } = syncLeagueSchema.parse(req.params);
  
  try {
    console.log(`🔄 Force syncing transactions for league: ${leagueId}`);
    
    // Get the league from database
    const league = await prisma.league.findUnique({
      where: { sleeperLeagueId: leagueId }
    });

    if (!league) {
      return res.status(404).json({
        message: 'League not found. Please sync the league first.',
        leagueId,
        syncEndpoint: `/api/leagues/${leagueId}/sync`
      });
    }

    // Re-sync just transactions
    await dataSyncService.syncLeagueTransactions(leagueId);
    
    const transactionCount = await prisma.transaction.count({
      where: { leagueId: league.id }
    });

    res.status(200).json({
      message: 'Transactions synced successfully',
      leagueId,
      transactionCount,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error(`❌ Failed to sync transactions for league: ${leagueId}`, error);
    res.status(500).json({
      message: 'Failed to sync transactions',
      leagueId,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}));

// GET /api/leagues/search/:username - Find all leagues for a username
leaguesRouter.get('/search/:username', asyncHandler(async (req, res) => {
  const { username } = z.object({ username: z.string() }).parse(req.params);
  
  try {
    console.log(`🔍 Searching leagues for username: ${username}`);
    
    const searchResult = await historicalLeagueService.findLeaguesByUsername(username);
    
    res.status(200).json({
      username: searchResult.username,
      totalLeagues: searchResult.totalLeagues,
      dynastyChains: searchResult.dynastyChains,
      searchedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error(`❌ Failed to search leagues for username: ${username}`, error);
    res.status(404).json({
      message: 'Failed to find leagues for username',
      username,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}));

// GET /api/leagues/:leagueId/history - Get full dynasty history chain
leaguesRouter.get('/:leagueId/history', asyncHandler(async (req, res) => {
  const { leagueId } = leagueParamsSchema.parse(req.params);
  
  try {
    console.log(`🔗 Getting dynasty history for league: ${leagueId}`);
    
    const dynastyChain = await historicalLeagueService.getLeagueHistory(leagueId);
    
    res.status(200).json({
      leagueId,
      dynastyChain,
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error(`❌ Failed to get dynasty history for league: ${leagueId}`, error);
    res.status(500).json({
      message: 'Failed to get dynasty history',
      leagueId,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}));

// POST /api/leagues/:leagueId/sync-dynasty - Sync entire dynasty history
leaguesRouter.post('/:leagueId/sync-dynasty', asyncHandler(async (req, res) => {
  const { leagueId } = syncLeagueSchema.parse(req.params);
  
  try {
    console.log(`🔄 Starting full dynasty sync for league: ${leagueId}`);
    
    const syncResult = await historicalLeagueService.syncFullDynastyHistory(leagueId);
    
    if (syncResult.success) {
      res.status(200).json({
        message: 'Dynasty history sync completed successfully',
        leagueId,
        status: 'completed',
        syncedLeagues: syncResult.syncedLeagues,
        totalLeagues: syncResult.totalLeagues,
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(206).json({
        message: 'Dynasty history sync completed with some failures',
        leagueId,
        status: 'partial',
        syncedLeagues: syncResult.syncedLeagues,
        failedLeagues: syncResult.failedLeagues,
        totalLeagues: syncResult.totalLeagues,
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    console.error(`❌ Failed to sync dynasty history for league: ${leagueId}`, error);
    res.status(500).json({
      message: 'Dynasty history sync failed',
      leagueId,
      status: 'failed',
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
}));