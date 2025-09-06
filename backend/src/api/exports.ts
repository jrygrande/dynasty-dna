import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from './middleware/errorHandlers';
import { csvExportService } from '../services/csvExportService';

export const exportsRouter = Router();

// Schema for query parameters
const exportFiltersSchema = z.object({
  leagueId: z.string().optional(),
  season: z.string().optional(),
  weekStart: z.coerce.number().int().min(1).max(18).optional(),
  weekEnd: z.coerce.number().int().min(1).max(18).optional(),
}).refine((data) => {
  // If both weekStart and weekEnd are provided, weekStart should be <= weekEnd
  if (data.weekStart !== undefined && data.weekEnd !== undefined) {
    return data.weekStart <= data.weekEnd;
  }
  return true;
}, {
  message: "weekStart must be less than or equal to weekEnd",
  path: ["weekStart", "weekEnd"],
});

// GET /api/exports/player-weekly-scores - Export player weekly scores as CSV
exportsRouter.get('/player-weekly-scores', asyncHandler(async (req, res) => {
  // Parse and validate query parameters
  const filters = exportFiltersSchema.parse(req.query);
  
  console.log(`📊 Exporting player weekly scores with filters:`, filters);
  
  try {
    // Get export statistics first to provide metadata
    const stats = await csvExportService.getExportStats(filters);
    
    console.log(`📈 Export stats:`, stats);
    
    // Generate CSV data
    const csvContent = await csvExportService.exportPlayerWeeklyScores(filters);
    
    // Generate filename with current timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    let filename = `player-weekly-scores-${timestamp}.csv`;
    
    // Add filter info to filename if applicable
    if (filters.season) {
      filename = `player-weekly-scores-${filters.season}-${timestamp}.csv`;
    }
    if (filters.leagueId) {
      filename = `player-weekly-scores-league-${filters.leagueId}-${timestamp}.csv`;
    }
    
    // Set response headers for file download
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Export-Stats', JSON.stringify(stats));
    
    // Send CSV content
    res.status(200).send(csvContent);
    
    console.log(`✅ Successfully exported ${stats.totalRecords} player weekly score records`);
    
  } catch (error) {
    console.error('❌ Error exporting player weekly scores:', error);
    throw error;
  }
}));

// GET /api/exports/player-weekly-scores/stats - Get export statistics without generating CSV
exportsRouter.get('/player-weekly-scores/stats', asyncHandler(async (req, res) => {
  // Parse and validate query parameters
  const filters = exportFiltersSchema.parse(req.query);
  
  console.log(`📊 Getting player weekly scores export stats with filters:`, filters);
  
  try {
    const stats = await csvExportService.getExportStats(filters);
    
    res.status(200).json({
      message: 'Export statistics retrieved successfully',
      filters: filters,
      stats: stats,
      timestamp: new Date().toISOString()
    });
    
    console.log(`✅ Successfully retrieved export stats: ${stats.totalRecords} records`);
    
  } catch (error) {
    console.error('❌ Error getting export stats:', error);
    throw error;
  }
}));

// GET /api/exports/available-data - Get information about available data for exports
exportsRouter.get('/available-data', asyncHandler(async (_req, res) => {
  try {
    // Get overview of all available data
    const stats = await csvExportService.getExportStats(); // No filters = all data
    
    res.status(200).json({
      message: 'Available export data retrieved successfully',
      availableData: {
        totalPlayerWeeklyScores: stats.totalRecords,
        seasonsAvailable: stats.seasonsIncluded,
        weeksRange: stats.weeksRange,
        uniquePlayers: stats.playersCount,
        uniqueManagers: stats.managersCount,
      },
      endpoints: {
        playerWeeklyScores: {
          url: '/api/exports/player-weekly-scores',
          description: 'Export all player weekly scores as CSV',
          supportedFilters: ['leagueId', 'season', 'weekStart', 'weekEnd'],
        },
        exportStats: {
          url: '/api/exports/player-weekly-scores/stats',
          description: 'Get statistics about player weekly scores export without downloading',
          supportedFilters: ['leagueId', 'season', 'weekStart', 'weekEnd'],
        }
      },
      timestamp: new Date().toISOString()
    });
    
    console.log(`✅ Successfully retrieved available data overview`);
    
  } catch (error) {
    console.error('❌ Error getting available data:', error);
    throw error;
  }
}));