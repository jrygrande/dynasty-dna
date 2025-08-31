import { z } from 'zod';

const configSchema = z.object({
  port: z.number().default(3001),
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
  databaseUrl: z.string().default('file:./dev.db'),
  sleeperApiBaseUrl: z.string().url().default('https://api.sleeper.app/v1'),
  apiRateLimitDelayMs: z.number().default(100),
  testLeagueId: z.string().default('1191596293294166016'),
  testUsername: z.string().default('jrygrande'),
});

function loadConfig(): z.infer<typeof configSchema> {
  const env = {
    port: process.env.PORT ? parseInt(process.env.PORT, 10) : undefined,
    nodeEnv: process.env.NODE_ENV as 'development' | 'production' | 'test',
    databaseUrl: process.env.DATABASE_URL,
    sleeperApiBaseUrl: process.env.SLEEPER_API_BASE_URL,
    apiRateLimitDelayMs: process.env.API_RATE_LIMIT_DELAY_MS ? parseInt(process.env.API_RATE_LIMIT_DELAY_MS, 10) : undefined,
    testLeagueId: process.env.TEST_LEAGUE_ID,
    testUsername: process.env.TEST_USERNAME,
  };

  return configSchema.parse(env);
}

export const config = loadConfig();