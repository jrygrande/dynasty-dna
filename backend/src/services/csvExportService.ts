import { PrismaClient } from '@prisma/client';
import { createObjectCsvStringifier } from 'csv-writer';

const prisma = new PrismaClient();

export interface PlayerWeeklyScoreExportRow {
  week: number;
  season: string;
  points: number;
  is_starter: boolean;
  player_name: string;
  position: string;
  manager_name: string;
}

export interface ExportFilters {
  leagueId?: string;
  season?: string;
  weekStart?: number;
  weekEnd?: number;
}

export class CSVExportService {
  async exportPlayerWeeklyScores(filters: ExportFilters = {}): Promise<string> {
    // Build the query with filters
    const whereClause: any = {};
    
    if (filters.leagueId) {
      whereClause.leagueId = filters.leagueId;
    }
    
    if (filters.season) {
      whereClause.season = filters.season;
    }
    
    if (filters.weekStart !== undefined || filters.weekEnd !== undefined) {
      whereClause.week = {};
      if (filters.weekStart !== undefined) {
        whereClause.week.gte = filters.weekStart;
      }
      if (filters.weekEnd !== undefined) {
        whereClause.week.lte = filters.weekEnd;
      }
    }

    // Query the data with all necessary joins
    const playerWeeklyScores = await prisma.playerWeeklyScore.findMany({
      where: whereClause,
      select: {
        week: true,
        season: true,
        points: true,
        isStarter: true,
        rosterId: true,
        player: {
          select: {
            fullName: true,
            firstName: true,
            lastName: true,
            position: true,
          },
        },
      },
      orderBy: [
        { season: 'desc' },
        { week: 'asc' },
        { points: 'desc' },
      ],
    });

    // Get roster-to-manager mapping
    // We need to get the managers for each rosterId across all seasons
    const rosterIdsSet = new Set(playerWeeklyScores.map(score => score.rosterId));
    const rosterIds = Array.from(rosterIdsSet);
    
    const rostersWithManagers = await prisma.roster.findMany({
      where: {
        sleeperRosterId: {
          in: rosterIds,
        },
      },
      select: {
        sleeperRosterId: true,
        manager: {
          select: {
            username: true,
            displayName: true,
            teamName: true,
          },
        },
      },
      distinct: ['sleeperRosterId'], // Get one record per roster ID
    });

    // Create a lookup map for roster ID to manager
    const rosterToManagerMap = new Map<number, string>();
    rostersWithManagers.forEach(roster => {
      const managerName = roster.manager.displayName || 
                         roster.manager.teamName || 
                         roster.manager.username;
      rosterToManagerMap.set(roster.sleeperRosterId, managerName);
    });

    // Transform the data into CSV format
    const csvData: PlayerWeeklyScoreExportRow[] = playerWeeklyScores.map(score => {
      const playerName = score.player.fullName || 
                        `${score.player.firstName || ''} ${score.player.lastName || ''}`.trim() ||
                        'Unknown Player';
      
      const managerName = rosterToManagerMap.get(score.rosterId) || 'Unknown Manager';
      
      return {
        week: score.week,
        season: score.season,
        points: score.points,
        is_starter: score.isStarter,
        player_name: playerName,
        position: score.player.position || 'Unknown',
        manager_name: managerName,
      };
    });

    // Create CSV string
    const csvStringifier = createObjectCsvStringifier({
      header: [
        { id: 'week', title: 'week' },
        { id: 'season', title: 'season' },
        { id: 'points', title: 'points' },
        { id: 'is_starter', title: 'is_starter' },
        { id: 'player_name', title: 'player_name' },
        { id: 'position', title: 'position' },
        { id: 'manager_name', title: 'manager_name' },
      ],
    });

    const headerString = csvStringifier.getHeaderString();
    const recordsString = csvStringifier.stringifyRecords(csvData);
    
    return headerString + recordsString;
  }

  async getExportStats(filters: ExportFilters = {}): Promise<{
    totalRecords: number;
    seasonsIncluded: string[];
    weeksRange: { min: number; max: number } | null;
    playersCount: number;
    managersCount: number;
  }> {
    const whereClause: any = {};
    
    if (filters.leagueId) {
      whereClause.leagueId = filters.leagueId;
    }
    
    if (filters.season) {
      whereClause.season = filters.season;
    }
    
    if (filters.weekStart !== undefined || filters.weekEnd !== undefined) {
      whereClause.week = {};
      if (filters.weekStart !== undefined) {
        whereClause.week.gte = filters.weekStart;
      }
      if (filters.weekEnd !== undefined) {
        whereClause.week.lte = filters.weekEnd;
      }
    }

    // Get basic stats
    const [totalRecords, seasons, weeks, players, rosters] = await Promise.all([
      // Total record count
      prisma.playerWeeklyScore.count({ where: whereClause }),
      
      // Distinct seasons
      prisma.playerWeeklyScore.findMany({
        where: whereClause,
        select: { season: true },
        distinct: ['season'],
        orderBy: { season: 'asc' },
      }),
      
      // Week range
      prisma.playerWeeklyScore.aggregate({
        where: whereClause,
        _min: { week: true },
        _max: { week: true },
      }),
      
      // Distinct players
      prisma.playerWeeklyScore.findMany({
        where: whereClause,
        select: { playerId: true },
        distinct: ['playerId'],
      }),
      
      // Distinct roster IDs
      prisma.playerWeeklyScore.findMany({
        where: whereClause,
        select: { rosterId: true },
        distinct: ['rosterId'],
      }),
    ]);

    return {
      totalRecords,
      seasonsIncluded: seasons.map(s => s.season),
      weeksRange: weeks._min.week && weeks._max.week ? {
        min: weeks._min.week,
        max: weeks._max.week,
      } : null,
      playersCount: players.length,
      managersCount: rosters.length,
    };
  }
}

export const csvExportService = new CSVExportService();