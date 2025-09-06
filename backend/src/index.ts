import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { config } from './config';
import { healthRouter } from './api/health';
import { leaguesRouter } from './api/leagues';
import { playersRouter } from './api/players';
import { testRouter } from './api/test';
import { exportsRouter } from './api/exports';
import { errorHandler, notFoundHandler } from './api/middleware/errorHandlers';

const app = express();

app.use(helmet());
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://dynasty-dna.vercel.app'] 
    : ['http://localhost:5173'],
  credentials: true,
}));
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.use('/api/health', healthRouter);
app.use('/api/leagues', leaguesRouter);
app.use('/api/players', playersRouter);
app.use('/api/test', testRouter);
app.use('/api/exports', exportsRouter);

app.use(notFoundHandler);
app.use(errorHandler);

const server = app.listen(config.port, () => {
  console.log(`🚀 Dynasty DNA API server running on port ${config.port}`);
  console.log(`📊 Environment: ${config.nodeEnv}`);
  console.log(`💾 Database: ${config.databaseUrl}`);
});

process.on('SIGTERM', () => {
  console.log('📴 SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('✅ Process terminated');
  });
});

export default app;