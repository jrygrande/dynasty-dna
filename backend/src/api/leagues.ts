import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from './middleware/errorHandlers';
import { dataSyncService } from '../services/dataSyncService';
import { sleeperClient } from '../services/sleeperClient';
import { historicalLeagueService } from '../services/historicalLeagueService';
import { transactionChainService } from '../services/transactionChainService';
import { assetTradeTreeService } from '../services/assetTradeTreeService';
import { treeFormatterService } from '../services/treeFormatterService';
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
    
    if (!leagueData) {
      return res.status(404).json({
        message: 'League not found in Sleeper',
        leagueId,
        timestamp: new Date().toISOString()
      });
    }
    
    // Perform the sync
    const syncResult = await dataSyncService.syncLeague(leagueId);
    
    if (syncResult.success) {
      console.log(`✅ Successfully synced league: ${leagueId}`);
      return res.status(200).json({
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
      return res.status(206).json({
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
    return res.status(500).json({
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
      
      if (!sleeperLeague) {
        return res.status(404).json({
          message: 'League not found',
          leagueId,
          error: 'League does not exist in Sleeper'
        });
      }
      
      return res.status(200).json({
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
    return res.status(404).json({
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
    return res.status(500).json({
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
    return res.status(500).json({
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
    return res.status(404).json({
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
    return res.status(500).json({
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
    return res.status(500).json({
      message: 'Dynasty history sync failed',
      leagueId,
      status: 'failed',
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
}));

// GET /api/leagues/:leagueId/transactions/:transactionId/complete-lineage - Get complete asset lineage for transaction
leaguesRouter.get('/:leagueId/transactions/:transactionId/complete-lineage', asyncHandler(async (req, res) => {
  const { leagueId, transactionId } = z.object({
    leagueId: z.string(),
    transactionId: z.string()
  }).parse(req.params);
  
  const { managerId } = z.object({
    managerId: z.string()
  }).parse(req.query);
  
  try {
    console.log(`🔗 Building complete transaction lineage for transaction: ${transactionId}, manager: ${managerId}`);
    
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

    // Find the transaction
    const transaction = await prisma.transaction.findUnique({
      where: { sleeperTransactionId: transactionId }
    });

    if (!transaction) {
      return res.status(404).json({
        message: 'Transaction not found in database',
        transactionId,
        leagueId
      });
    }

    // Find the manager
    const manager = await prisma.manager.findUnique({
      where: { sleeperUserId: managerId }
    });

    if (!manager) {
      return res.status(404).json({
        message: 'Manager not found in database',
        managerId,
        leagueId
      });
    }

    // Build the complete transaction lineage
    const completeLineage = await transactionChainService.buildCompleteTransactionLineage(
      transaction.id,
      manager.id,
      league.id
    );

    res.status(200).json({
      leagueId,
      transactionId,
      managerId,
      managerName: manager.displayName || manager.username,
      completeLineage,
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error(`❌ Failed to build complete transaction lineage:`, error);
    return res.status(500).json({
      message: 'Failed to build complete transaction lineage',
      transactionId,
      managerId,
      leagueId,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}));

// GET /api/leagues/:leagueId/assets/:assetId/trade-tree - Test new asset trade tree service
leaguesRouter.get('/:leagueId/assets/:assetId/trade-tree', asyncHandler(async (req, res) => {
  const { leagueId, assetId } = z.object({
    leagueId: z.string(),
    assetId: z.string()
  }).parse(req.params);
  
  const { transactionId } = z.object({
    transactionId: z.string()
  }).parse(req.query);
  
  try {
    console.log(`🌳 Building trade tree for asset: ${assetId} in league: ${leagueId} from transaction: ${transactionId}`);
    
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

    // Build the asset trade tree
    const tradeTree = await assetTradeTreeService.buildAssetTradeTree(
      assetId,
      transactionId,
      league.id
    );

    res.status(200).json({
      leagueId,
      assetId,
      transactionId,
      tradeTree,
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error(`❌ Failed to build trade tree:`, error);
    return res.status(500).json({
      message: 'Failed to build asset trade tree',
      assetId,
      transactionId,
      leagueId,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}));

// GET /api/leagues/:leagueId/assets/:assetId/complete-tree - Get complete recursive trade tree
leaguesRouter.get('/:leagueId/assets/:assetId/complete-tree', asyncHandler(async (req, res) => {
  const { leagueId, assetId } = z.object({
    leagueId: z.string(),
    assetId: z.string()
  }).parse(req.params);
  
  const { transactionId, format = 'json' } = z.object({
    transactionId: z.string().optional(),
    format: z.enum(['json', 'ascii']).optional()
  }).parse(req.query);
  
  try {
    console.log(`🌲 Building complete recursive tree for asset: ${assetId} in league: ${leagueId} from transaction: ${transactionId}`);
    
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

    // Build the complete recursive trade tree
    const completeTree = await assetTradeTreeService.buildAssetTradeTree(
      assetId,
      transactionId,
      league.id
    );

    // Format response based on requested format
    if (format === 'ascii') {
      const asciiTree = treeFormatterService.formatAssetTree(completeTree, true);
      const summary = treeFormatterService.formatTreeSummary(completeTree);
      
      res.status(200).json({
        leagueId,
        assetId,
        transactionId,
        format: 'ascii',
        tree: asciiTree,
        summary: summary,
        generatedAt: new Date().toISOString()
      });
    } else {
      // JSON format - return full structured data
      res.status(200).json({
        leagueId,
        assetId,
        transactionId,
        format: 'json',
        completeTree,
        generatedAt: new Date().toISOString()
      });
    }
  } catch (error) {
    console.error(`❌ Failed to build complete trade tree:`, error);
    return res.status(500).json({
      message: 'Failed to build complete asset trade tree',
      assetId,
      transactionId,
      leagueId,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}));

// GET /api/leagues/:leagueId/transaction-graph - Get complete transaction graph for league
leaguesRouter.get('/:leagueId/transaction-graph', asyncHandler(async (req, res) => {
  const { leagueId } = leagueParamsSchema.parse(req.params);
  
  const { 
    format = 'json',
    season,
    transactionType,
    managerId
  } = z.object({
    format: z.enum(['json', 'stats']).optional(),
    season: z.string().optional(),
    transactionType: z.string().optional(),
    managerId: z.string().optional()
  }).parse(req.query);
  
  try {
    console.log(`📊 Building complete transaction graph for league: ${leagueId}`);
    
    // Find the internal league
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

    // Get dynasty history to work across all seasons
    const dynastyChain = await historicalLeagueService.getLeagueHistory(leagueId);
    
    // Filter leagues based on query parameters
    let filteredLeagues = dynastyChain.leagues;
    if (season) {
      filteredLeagues = filteredLeagues.filter(l => l.season === season);
    }

    // Build the complete transaction graph
    const startTime = Date.now();
    const transactionGraph = await transactionChainService.buildTransactionGraph(filteredLeagues);
    const buildTime = Date.now() - startTime;

    // Apply filtering if specified
    let filteredNodes = transactionGraph.nodes;
    let filteredEdges = transactionGraph.edges;
    let filteredChains = transactionGraph.chains;

    if (transactionType || managerId) {
      // Filter chains by transaction type or manager
      const filteredChainMap = new Map();
      const filteredAssetIds = new Set<string>();

      for (const [chainId, chain] of transactionGraph.chains) {
        let shouldInclude = true;

        // Filter by transaction type
        if (transactionType && chain.type !== transactionType) {
          shouldInclude = false;
        }

        // Filter by manager involvement
        if (managerId && shouldInclude) {
          const managerInvolved = chain.managerFrom?.id === managerId || 
                                 chain.managerTo?.id === managerId;
          if (!managerInvolved) {
            shouldInclude = false;
          }
        }

        if (shouldInclude) {
          filteredChainMap.set(chainId, chain);
          // Track assets involved in filtered transactions
          [...chain.assetsReceived, ...chain.assetsGiven].forEach(asset => {
            filteredAssetIds.add(asset.id);
          });
        }
      }

      // Update filtered collections
      filteredChains = filteredChainMap;
      filteredNodes = new Map();
      filteredEdges = new Map();

      for (const assetId of filteredAssetIds) {
        const node = transactionGraph.nodes.get(assetId);
        if (node) {
          filteredNodes.set(assetId, node);
        }

        const edges = transactionGraph.edges.get(assetId);
        if (edges) {
          // Only include edges to filtered transactions
          const validEdges = edges.filter(edgeId => filteredChainMap.has(edgeId));
          if (validEdges.length > 0) {
            filteredEdges.set(assetId, validEdges);
          }
        }
      }
    }

    // Calculate graph statistics
    const stats = {
      buildTimeMs: buildTime,
      totalNodes: filteredNodes.size,
      totalEdges: Array.from(filteredEdges.values()).reduce((sum, edges) => sum + edges.length, 0),
      totalTransactions: filteredChains.size,
      transactionTypes: {} as Record<string, number>,
      assetTypes: { player: 0, draft_pick: 0 } as Record<string, number>,
      seasonsSpanned: new Set<string>(),
      managersInvolved: new Set<string>(),
      avgTransactionsPerAsset: 0,
      maxTransactionsPerAsset: 0
    };

    // Analyze transaction types and other stats
    for (const [, transaction] of filteredChains) {
      stats.transactionTypes[transaction.type] = (stats.transactionTypes[transaction.type] || 0) + 1;
      stats.seasonsSpanned.add(transaction.season);
      
      if (transaction.managerFrom) stats.managersInvolved.add(transaction.managerFrom.id);
      if (transaction.managerTo) stats.managersInvolved.add(transaction.managerTo.id);
    }

    // Analyze asset types and transaction frequency
    let totalTransactionsAcrossAssets = 0;
    for (const [, asset] of filteredNodes) {
      stats.assetTypes[asset.type] = (stats.assetTypes[asset.type] || 0) + 1;
      
      const assetTransactionCount = filteredEdges.get(asset.id)?.length || 0;
      totalTransactionsAcrossAssets += assetTransactionCount;
      stats.maxTransactionsPerAsset = Math.max(stats.maxTransactionsPerAsset, assetTransactionCount);
    }

    stats.avgTransactionsPerAsset = filteredNodes.size > 0 ? 
      Math.round((totalTransactionsAcrossAssets / filteredNodes.size) * 100) / 100 : 0;

    // Convert Set to numbers for response
    const finalStats = {
      ...stats,
      seasonsSpanned: stats.seasonsSpanned.size,
      managersInvolved: stats.managersInvolved.size
    };

    if (format === 'stats') {
      // Return just statistics
      res.status(200).json({
        leagueId,
        format: 'stats',
        statistics: finalStats,
        filters: {
          season,
          transactionType,
          managerId
        },
        generatedAt: new Date().toISOString()
      });
    } else {
      // Convert Maps to Objects for JSON serialization
      const nodesArray = Array.from(filteredNodes.entries()).map(([, node]) => ({
        ...node
      }));

      const edgesArray = Array.from(filteredEdges.entries()).map(([assetId, transactionIds]) => ({
        assetId,
        transactionIds
      }));

      const transactionsArray = Array.from(filteredChains.entries()).map(([, transaction]) => ({
        ...transaction
      }));

      // Return full graph data
      res.status(200).json({
        leagueId,
        format: 'json',
        graph: {
          nodes: nodesArray,
          edges: edgesArray,
          transactions: transactionsArray
        },
        statistics: finalStats,
        filters: {
          season,
          transactionType,
          managerId
        },
        generatedAt: new Date().toISOString()
      });
    }
  } catch (error) {
    console.error(`❌ Failed to build transaction graph for league: ${leagueId}`, error);
    return res.status(500).json({
      message: 'Failed to build transaction graph',
      leagueId,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}));