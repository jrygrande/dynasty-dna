import { Router } from 'express';
import { asyncHandler } from './middleware/errorHandlers';
import { config } from '../config';

export const healthRouter = Router();

healthRouter.get('/', asyncHandler(async (_, res) => {
  const healthCheck = {
    uptime: process.uptime(),
    message: 'Dynasty DNA API is healthy',
    timestamp: new Date().toISOString(),
    environment: config.nodeEnv,
    version: '1.0.0',
  };

  res.status(200).json(healthCheck);
}));