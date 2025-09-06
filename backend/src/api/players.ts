import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from './middleware/errorHandlers';
import { transactionChainService } from '../services/transactionChainService';
import { historicalLeagueService } from '../services/historicalLeagueService';
import { playerNetworkService } from '../services/playerNetworkService';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
export const playersRouter = Router();

const playerIdSchema = z.object({
  playerId: z.string(),
});

const playerChainQuerySchema = z.object({
  leagueId: z.string().optional(),
  sleeperId: z.string().optional(),
});

// GET /api/players/:playerId/transaction-chain - Get complete transaction chain for player
playersRouter.get('/:playerId/transaction-chain', asyncHandler(async (req, res) => {
  const { playerId } = playerIdSchema.parse(req.params);
  const { leagueId, sleeperId } = playerChainQuerySchema.parse(req.query);
  
  try {
    let targetPlayerId = playerId;
    let startLeagueId = leagueId;

    // If sleeperId provided, find the player in database
    if (sleeperId && !leagueId) {
      const player = await prisma.player.findFirst({
        where: { sleeperId }
      });

      if (!player) {
        return res.status(404).json({
          message: 'Player not found by Sleeper ID',
          sleeperId,
          suggestion: 'Try searching by internal player ID or provide a league ID'
        });
      }

      targetPlayerId = player.id;
    }

    // If no league ID provided, we need one to start the chain
    if (!startLeagueId) {
      return res.status(400).json({
        message: 'League ID is required to build transaction chain',
        playerId: targetPlayerId,
        example: `/api/players/${targetPlayerId}/transaction-chain?leagueId=1191596293294166016`
      });
    }

    console.log(`🔗 Building transaction chain for player: ${targetPlayerId} in league: ${startLeagueId}`);

    // Build the transaction chain
    const transactionChain = await transactionChainService.buildTransactionChain(
      targetPlayerId,
      'player',
      startLeagueId
    );

    res.status(200).json({
      playerId: targetPlayerId,
      leagueId: startLeagueId,
      transactionChain,
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error(`❌ Failed to build transaction chain for player: ${playerId}`, error);
    return res.status(500).json({
      message: 'Failed to build transaction chain',
      playerId,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}));

// GET /api/players/:playerId/seasons - Get player performance across all dynasty seasons
playersRouter.get('/:playerId/seasons', asyncHandler(async (req, res) => {
  const { playerId } = playerIdSchema.parse(req.params);
  const { leagueId } = z.object({ leagueId: z.string() }).parse(req.query);
  
  try {
    console.log(`📊 Getting player seasons for: ${playerId} in dynasty: ${leagueId}`);

    // Use historical league service to find player across seasons
    const playerSeasons = await historicalLeagueService.findPlayerAcrossSeasons(
      playerId,
      leagueId
    );

    res.status(200).json({
      playerId,
      leagueId,
      player: playerSeasons.player,
      seasonsFound: playerSeasons.seasonsFound,
      totalSeasons: playerSeasons.seasonsFound.length,
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error(`❌ Failed to get player seasons: ${playerId}`, error);
    return res.status(500).json({
      message: 'Failed to get player season data',
      playerId,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}));

// GET /api/players/search/:sleeperId - Search for player by Sleeper ID
playersRouter.get('/search/:sleeperId', asyncHandler(async (req, res) => {
  const { sleeperId } = z.object({ sleeperId: z.string() }).parse(req.params);
  
  try {
    const player = await prisma.player.findFirst({
      where: { sleeperId },
      include: {
        _count: {
          select: {
            transactionItems: true,
            weeklyScores: true
          }
        }
      }
    });

    if (!player) {
      return res.status(404).json({
        message: 'Player not found',
        sleeperId
      });
    }

    res.status(200).json({
      player: {
        id: player.id,
        sleeperId: player.sleeperId,
        firstName: player.firstName,
        lastName: player.lastName,
        fullName: player.fullName,
        position: player.position,
        team: player.team,
        age: player.age,
        yearsExp: player.yearsExp,
        status: player.status,
        injuryStatus: player.injuryStatus,
        number: player.number,
        dataCount: {
          transactionItems: player._count.transactionItems,
          weeklyScores: player._count.weeklyScores
        }
      }
    });
  } catch (error) {
    console.error(`❌ Failed to search for player: ${sleeperId}`, error);
    return res.status(500).json({
      message: 'Failed to search for player',
      sleeperId,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}));

// GET /api/players/:playerId/asset-history - Get transaction history for any asset (player or draft pick)
playersRouter.get('/:assetId/asset-history', asyncHandler(async (req, res) => {
  const { assetId } = z.object({ assetId: z.string() }).parse(req.params);
  const { leagueId } = z.object({ leagueId: z.string() }).parse(req.query);
  
  try {
    console.log(`🔍 Getting asset history for: ${assetId} in league: ${leagueId}`);

    // Use the player network service to get asset transactions
    const assetTransactions = await playerNetworkService.getAssetTransactions(
      assetId,
      leagueId,
      {} // No additional filters
    );

    // Sort transactions chronologically
    const sortedTransactions = assetTransactions.sort((a, b) => 
      parseInt(a.timestamp) - parseInt(b.timestamp)
    );

    res.status(200).json({
      assetId,
      leagueId,
      transactions: sortedTransactions,
      totalTransactions: sortedTransactions.length,
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error(`❌ Failed to get asset history: ${assetId}`, error);
    return res.status(500).json({
      message: 'Failed to get asset transaction history',
      assetId,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}));

// GET /api/players/:playerId/performance - Get player performance data (using Sleeper scoring)
playersRouter.get('/:playerId/performance', asyncHandler(async (req, res) => {
  const { playerId } = playerIdSchema.parse(req.params);
  const { leagueId, season, limit = '18' } = z.object({
    leagueId: z.string().optional(),
    season: z.string().optional(),
    limit: z.string().optional()
  }).parse(req.query);
  
  try {
    const player = await prisma.player.findUnique({
      where: { id: playerId }
    });

    if (!player) {
      return res.status(404).json({
        message: 'Player not found',
        playerId
      });
    }

    // Build query conditions
    const where: any = { playerId };
    if (leagueId) {
      const league = await prisma.league.findUnique({
        where: { sleeperLeagueId: leagueId }
      });
      if (league) {
        where.leagueId = league.id;
      }
    }
    if (season) {
      where.season = season;
    }

    // Get weekly performance data
    const weeklyScores = await prisma.playerWeeklyScore.findMany({
      where,
      include: {
        league: {
          select: {
            name: true,
            season: true,
            sleeperLeagueId: true
          }
        }
      },
      orderBy: [
        { season: 'desc' },
        { week: 'desc' }
      ],
      take: parseInt(limit)
    });

    // Calculate performance metrics
    const totalGames = weeklyScores.length;
    const gamesStarted = weeklyScores.filter(score => score.isStarter).length;
    const gamesBenched = totalGames - gamesStarted;
    const totalPoints = weeklyScores.reduce((sum, score) => sum + score.points, 0);
    const averagePoints = totalGames > 0 ? totalPoints / totalGames : 0;
    const starterPoints = weeklyScores
      .filter(score => score.isStarter)
      .reduce((sum, score) => sum + score.points, 0);
    const benchPoints = totalPoints - starterPoints;

    // Group by season
    const seasonStats = weeklyScores.reduce((acc, score) => {
      if (!acc[score.season]) {
        acc[score.season] = {
          season: score.season,
          leagueName: score.league.name,
          games: 0,
          gamesStarted: 0,
          points: 0,
          starterPoints: 0,
          benchPoints: 0
        };
      }

      acc[score.season].games++;
      acc[score.season].points += score.points;

      if (score.isStarter) {
        acc[score.season].gamesStarted++;
        acc[score.season].starterPoints += score.points;
      } else {
        acc[score.season].benchPoints += score.points;
      }

      return acc;
    }, {} as Record<string, any>);

    res.status(200).json({
      player: {
        id: player.id,
        sleeperId: player.sleeperId,
        fullName: player.fullName,
        position: player.position,
        team: player.team
      },
      summary: {
        totalGames,
        gamesStarted,
        gamesBenched,
        totalPoints,
        averagePoints,
        starterPoints,
        benchPoints
      },
      seasonStats: Object.values(seasonStats),
      weeklyScores: weeklyScores.map(score => ({
        week: score.week,
        season: score.season,
        points: score.points,
        isStarter: score.isStarter,
        leagueName: score.league.name,
        matchupId: score.matchupId
      }))
    });
  } catch (error) {
    console.error(`❌ Failed to get player performance: ${playerId}`, error);
    return res.status(500).json({
      message: 'Failed to get player performance data',
      playerId,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}));