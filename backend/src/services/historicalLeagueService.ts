import { PrismaClient } from '@prisma/client';
import { sleeperClient } from './sleeperClient';
import { dataSyncService } from './dataSyncService';

const prisma = new PrismaClient();

export interface LeagueHistoryNode {
  leagueId: string;
  sleeperLeagueId: string;
  name: string;
  season: string;
  seasonType: string;
  status?: string;
  totalRosters: number;
  previousLeagueId?: string;
  sleeperPreviousLeagueId?: string;
  inDatabase: boolean;
  lastSynced?: Date;
  dataCount?: {
    transactions: number;
    rosters: number;
    playerScores: number;
    matchups: number;
  };
}

export interface DynastyChain {
  totalSeasons: number;
  leagues: LeagueHistoryNode[];
  currentLeague: LeagueHistoryNode;
  oldestLeague: LeagueHistoryNode;
  missingSeasons: string[];
  brokenChains: { beforeSeason: string; afterSeason: string }[];
}

export class HistoricalLeagueService {
  /**
   * Get complete dynasty history for a league (traverses previous_league_id chain)
   */
  async getLeagueHistory(currentLeagueId: string): Promise<DynastyChain> {
    const leagues: LeagueHistoryNode[] = [];
    const visitedIds = new Set<string>();
    const missingSeasons: string[] = [];
    const brokenChains: { beforeSeason: string; afterSeason: string }[] = [];

    // Start with current league and traverse backwards
    let currentId = currentLeagueId;
    
    while (currentId && !visitedIds.has(currentId)) {
      visitedIds.add(currentId);
      
      try {
        const leagueNode = await this.getLeagueNode(currentId);
        leagues.unshift(leagueNode); // Add to beginning (oldest first)
        
        // Get previous league ID
        currentId = leagueNode.sleeperPreviousLeagueId || '';
      } catch (error) {
        console.warn(`Failed to get league data for ${currentId}:`, error);
        break;
      }
    }

    // Check for missing seasons and broken chains
    for (let i = 0; i < leagues.length - 1; i++) {
      const currentLeague = leagues[i];
      const nextLeague = leagues[i + 1];
      
      const currentYear = parseInt(currentLeague.season);
      const nextYear = parseInt(nextLeague.season);
      
      // Check for missing years
      if (nextYear - currentYear > 1) {
        for (let year = currentYear + 1; year < nextYear; year++) {
          missingSeasons.push(year.toString());
        }
        brokenChains.push({
          beforeSeason: currentLeague.season,
          afterSeason: nextLeague.season
        });
      }
    }

    const currentLeague = leagues[leagues.length - 1];
    const oldestLeague = leagues[0];

    return {
      totalSeasons: leagues.length,
      leagues,
      currentLeague,
      oldestLeague,
      missingSeasons,
      brokenChains
    };
  }

  /**
   * Sync entire dynasty history starting from current league
   */
  async syncFullDynastyHistory(currentLeagueId: string): Promise<{
    success: boolean;
    syncedLeagues: string[];
    failedLeagues: { leagueId: string; error: string }[];
    totalLeagues: number;
  }> {
    console.log(`🔄 Starting full dynasty history sync from: ${currentLeagueId}`);
    
    const syncedLeagues: string[] = [];
    const failedLeagues: { leagueId: string; error: string }[] = [];

    try {
      // Get the complete dynasty chain
      const dynastyChain = await this.getLeagueHistory(currentLeagueId);
      console.log(`📊 Found ${dynastyChain.totalSeasons} seasons in dynasty chain`);

      // Sync each league in the chain (oldest to newest for proper data dependencies)
      for (const league of dynastyChain.leagues) {
        if (!league.inDatabase) {
          try {
            console.log(`🔄 Syncing ${league.name} (${league.season})`);
            const syncResult = await dataSyncService.syncLeague(league.sleeperLeagueId);
            
            if (syncResult.success) {
              syncedLeagues.push(league.sleeperLeagueId);
              console.log(`✅ Successfully synced ${league.name} (${league.season})`);
            } else {
              throw new Error(`Partial sync with errors: ${syncResult.errors.join(', ')}`);
            }
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            console.error(`❌ Failed to sync ${league.name} (${league.season}):`, errorMessage);
            failedLeagues.push({
              leagueId: league.sleeperLeagueId,
              error: errorMessage
            });
          }
        } else {
          console.log(`⏭️ Skipping ${league.name} (${league.season}) - already in database`);
          syncedLeagues.push(league.sleeperLeagueId);
        }
      }

      return {
        success: failedLeagues.length === 0,
        syncedLeagues,
        failedLeagues,
        totalLeagues: dynastyChain.totalSeasons
      };
    } catch (error) {
      console.error(`❌ Failed to sync dynasty history:`, error);
      throw error;
    }
  }

  /**
   * Find player across all seasons in dynasty
   */
  async findPlayerAcrossSeasons(playerId: string, startLeagueId: string): Promise<{
    player: any;
    seasonsFound: Array<{
      season: string;
      leagueName: string;
      rosterId: number;
      managerName: string;
      totalPoints: number;
      gamesStarted: number;
      gamesBenched: number;
    }>;
  }> {
    const dynastyChain = await this.getLeagueHistory(startLeagueId);
    const seasonsFound: any[] = [];

    // Get player info
    const player = await prisma.player.findFirst({
      where: { sleeperId: playerId }
    });

    if (!player) {
      throw new Error(`Player not found: ${playerId}`);
    }

    // Search each season
    for (const league of dynastyChain.leagues) {
      if (!league.inDatabase) continue;

      const internalLeague = await prisma.league.findUnique({
        where: { sleeperLeagueId: league.sleeperLeagueId }
      });

      if (!internalLeague) continue;

      // Get player weekly scores for this season
      const weeklyScores = await prisma.playerWeeklyScore.findMany({
        where: {
          leagueId: internalLeague.id,
          playerId: player.id,
          season: league.season
        }
      });

      if (weeklyScores.length > 0) {
        // Find which roster/manager owned this player
        const sampleScore = weeklyScores[0];
        const roster = await prisma.roster.findFirst({
          where: {
            leagueId: internalLeague.id,
            sleeperRosterId: sampleScore.rosterId
          },
          include: { manager: true }
        });

        const totalPoints = weeklyScores.reduce((sum, score) => sum + score.points, 0);
        const gamesStarted = weeklyScores.filter(score => score.isStarter).length;
        const gamesBenched = weeklyScores.filter(score => !score.isStarter).length;

        seasonsFound.push({
          season: league.season,
          leagueName: league.name,
          rosterId: sampleScore.rosterId,
          managerName: roster?.manager.displayName || roster?.manager.username || 'Unknown',
          totalPoints,
          gamesStarted,
          gamesBenched
        });
      }
    }

    return {
      player: {
        id: player.id,
        sleeperId: player.sleeperId,
        fullName: player.fullName,
        position: player.position,
        team: player.team
      },
      seasonsFound
    };
  }

  /**
   * Get transaction chains that span multiple seasons
   */
  async getTransactionChainAcrossSeasons(
    assetId: string,
    assetType: 'player' | 'draft_pick',
    _startLeagueId: string
  ): Promise<any[]> {
    // This will be implemented with the transaction chain service
    // For now, return empty array
    console.log(`🔗 Transaction chain across seasons not yet implemented for ${assetType}: ${assetId}`);
    return [];
  }

  /**
   * Find leagues by username across all seasons
   */
  async findLeaguesByUsername(username: string): Promise<{
    username: string;
    totalLeagues: number;
    dynastyChains: Array<{
      currentLeague: LeagueHistoryNode;
      totalSeasons: number;
      seasonsWithUser: number;
    }>;
  }> {
    try {
      // First, get user info from Sleeper
      const user = await sleeperClient.getUser(username);
      
      if (!user) {
        throw new Error(`User not found: ${username}`);
      }
      
      // Get current NFL state to determine current season
      const nflState = await sleeperClient.getNFLState();
      
      // Get all leagues for this user in the current season
      const currentSeasonLeagues = await sleeperClient.getUserLeagues(user.user_id, nflState.season);
      
      const dynastyChains = [];
      
      for (const league of currentSeasonLeagues) {
        try {
          const dynastyChain = await this.getLeagueHistory(league.league_id);
          
          // Count how many seasons this user appears in
          let seasonsWithUser = 0;
          for (const historicalLeague of dynastyChain.leagues) {
            if (historicalLeague.inDatabase) {
              // Check if user was in this league
              const internalLeague = await prisma.league.findUnique({
                where: { sleeperLeagueId: historicalLeague.sleeperLeagueId }
              });
              
              if (internalLeague) {
                const userInLeague = await prisma.manager.findFirst({
                  where: { sleeperUserId: user.user_id }
                });
                
                if (userInLeague) {
                  seasonsWithUser++;
                }
              }
            }
          }

          dynastyChains.push({
            currentLeague: dynastyChain.currentLeague,
            totalSeasons: dynastyChain.totalSeasons,
            seasonsWithUser
          });
        } catch (error) {
          console.warn(`Failed to get dynasty chain for league ${league.league_id}:`, error);
        }
      }

      return {
        username: user.display_name || user.username || '',
        totalLeagues: dynastyChains.length,
        dynastyChains
      };
    } catch (error) {
      console.error(`❌ Failed to find leagues for username: ${username}`, error);
      throw error;
    }
  }

  /**
   * Helper: Get league node (from DB or Sleeper API)
   */
  private async getLeagueNode(leagueId: string): Promise<LeagueHistoryNode> {
    // Try database first
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
      return {
        leagueId: dbLeague.id,
        sleeperLeagueId: dbLeague.sleeperLeagueId,
        name: dbLeague.name,
        season: dbLeague.season,
        seasonType: dbLeague.seasonType,
        status: dbLeague.status || undefined,
        totalRosters: dbLeague.totalRosters,
        previousLeagueId: dbLeague.previousLeagueId || undefined,
        sleeperPreviousLeagueId: dbLeague.sleeperPreviousLeagueId || undefined,
        inDatabase: true,
        lastSynced: dbLeague.updatedAt,
        dataCount: {
          transactions: dbLeague._count.transactions,
          rosters: dbLeague._count.rosters,
          playerScores: dbLeague._count.playerWeeklyScores,
          matchups: dbLeague._count.matchupResults
        }
      };
    } else {
      // Fallback to Sleeper API
      const sleeperLeague = await sleeperClient.getLeague(leagueId);
      
      if (!sleeperLeague) {
        throw new Error(`League not found: ${leagueId}`);
      }
      
      return {
        leagueId: '', // No internal ID yet
        sleeperLeagueId: leagueId,
        name: sleeperLeague.name,
        season: sleeperLeague.season,
        seasonType: sleeperLeague.season_type || 'regular',
        status: sleeperLeague.status,
        totalRosters: sleeperLeague.total_rosters,
        previousLeagueId: sleeperLeague.previous_league_id,
        sleeperPreviousLeagueId: sleeperLeague.previous_league_id,
        inDatabase: false
      };
    }
  }

  /**
   * Clean up resources
   */
  async disconnect(): Promise<void> {
    await prisma.$disconnect();
  }
}

// Export singleton instance
export const historicalLeagueService = new HistoricalLeagueService();