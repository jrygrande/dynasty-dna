import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from './middleware/errorHandlers';

export const playersRouter = Router();

const playerIdSchema = z.object({
  playerId: z.string(),
});

playersRouter.get('/:playerId/transaction-chain', asyncHandler(async (req, res) => {
  const { playerId } = playerIdSchema.parse(req.params);
  
  res.status(200).json({
    playerId,
    transactionChain: [],
    message: 'Transaction chain data will be implemented with Sleeper API integration',
  });
}));

playersRouter.get('/:playerId/performance', asyncHandler(async (req, res) => {
  const { playerId } = playerIdSchema.parse(req.params);
  
  res.status(200).json({
    playerId,
    performance: {},
    message: 'Performance data will be implemented in Phase 2 with nflverse integration',
  });
}));