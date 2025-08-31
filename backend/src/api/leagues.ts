import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from './middleware/errorHandlers';

export const leaguesRouter = Router();

const syncLeagueSchema = z.object({
  leagueId: z.string(),
});

leaguesRouter.post('/:leagueId/sync', asyncHandler(async (req, res) => {
  const { leagueId } = syncLeagueSchema.parse(req.params);
  
  res.status(200).json({
    message: 'League sync initiated',
    leagueId,
    status: 'pending',
  });
}));

leaguesRouter.get('/:leagueId/transactions', asyncHandler(async (req, res) => {
  const { leagueId } = z.object({ leagueId: z.string() }).parse(req.params);
  
  res.status(200).json({
    leagueId,
    transactions: [],
    message: 'Transaction data will be implemented with Sleeper API integration',
  });
}));