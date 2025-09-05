/**
 * Shared Prisma mock utilities for unit tests
 */

export const mockPrisma = {
  league: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    upsert: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    count: jest.fn()
  },
  transaction: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    upsert: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
    groupBy: jest.fn()
  },
  player: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    upsert: jest.fn(),
    count: jest.fn()
  },
  draftPick: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    upsert: jest.fn(),
    count: jest.fn()
  },
  manager: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    upsert: jest.fn(),
    count: jest.fn()
  },
  roster: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    upsert: jest.fn(),
    count: jest.fn()
  },
  transactionItem: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    upsert: jest.fn(),
    count: jest.fn()
  },
  playerWeeklyScore: {
    findMany: jest.fn(),
    create: jest.fn(),
    upsert: jest.fn(),
    count: jest.fn()
  },
  matchupResult: {
    findMany: jest.fn(),
    create: jest.fn(),
    upsert: jest.fn(),
    count: jest.fn()
  },
  draft: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    upsert: jest.fn(),
    count: jest.fn()
  },
  $disconnect: jest.fn().mockResolvedValue(undefined),
  $connect: jest.fn().mockResolvedValue(undefined),
  $transaction: jest.fn()
} as any;

/**
 * Reset all mock functions to clear call history and return values
 */
export const resetPrismaMocks = () => {
  Object.values(mockPrisma).forEach(model => {
    if (typeof model === 'object' && model !== null) {
      Object.values(model).forEach(method => {
        if (typeof method === 'function' && 'mockReset' in method) {
          (method as jest.MockedFunction<any>).mockReset();
        }
      });
    } else if (typeof model === 'function' && 'mockReset' in model) {
      (model as jest.MockedFunction<any>).mockReset();
    }
  });
};

/**
 * Mock data factories for common test scenarios
 */
export const mockDataFactories = {
  league: (overrides: Partial<any> = {}) => ({
    id: 'league-1',
    name: 'Test League',
    season: '2024',
    sleeperLeagueId: '123',
    sleeperPreviousLeagueId: null,
    previousLeagueId: null,
    totalRosters: 12,
    status: 'in_season',
    seasonType: 'regular',
    sport: 'nfl',
    rosterPositions: '[]',
    scoringSettings: '{}',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  }),

  player: (overrides: Partial<any> = {}) => ({
    id: 'player-1',
    sleeperId: 'p1',
    fullName: 'Test Player',
    firstName: 'Test',
    lastName: 'Player',
    position: 'RB',
    team: 'BUF',
    age: 25,
    yearsExperience: 3,
    status: 'active',
    injuryStatus: null,
    number: 21,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  }),

  manager: (overrides: Partial<any> = {}) => ({
    id: 'mgr-1',
    sleeperUserId: 'user1',
    username: 'testuser',
    displayName: 'Test User',
    avatar: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  }),

  transaction: (overrides: Partial<any> = {}) => ({
    id: 'tx-1',
    sleeperTransactionId: 'sleeper-tx-1',
    type: 'trade',
    status: 'complete',
    leg: 1,
    timestamp: BigInt(Date.now()),
    week: 1,
    season: '2024',
    creator: 'user1',
    leagueId: 'league-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  }),

  draftPick: (overrides: Partial<any> = {}) => ({
    id: 'pick-1',
    season: '2024',
    round: 1,
    pickNumber: 5,
    originalOwnerId: 'mgr-1',
    currentOwnerId: 'mgr-1',
    playerSelectedId: null,
    traded: false,
    leagueId: 'league-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  })
};