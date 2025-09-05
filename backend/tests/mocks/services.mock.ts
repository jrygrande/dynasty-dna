/**
 * Shared service mock utilities for unit tests
 */

/**
 * Mock historical league service
 */
export const mockHistoricalLeagueService = {
  getLeagueHistory: jest.fn(),
  syncFullDynastyHistory: jest.fn(),
  findPlayerAcrossSeasons: jest.fn(),
  getTransactionChainAcrossSeasons: jest.fn(),
  findLeaguesByUsername: jest.fn(),
  disconnect: jest.fn().mockResolvedValue(undefined)
};

/**
 * Mock asset trade tree service
 */
export const mockAssetTradeTreeService = {
  buildAssetTradeTree: jest.fn(),
  buildRecursiveAssetTree: jest.fn(),
  disconnect: jest.fn().mockResolvedValue(undefined)
};

/**
 * Reset all service mocks
 */
export const resetServiceMocks = () => {
  Object.values(mockHistoricalLeagueService).forEach(method => {
    if (typeof method === 'function' && 'mockReset' in method) {
      method.mockReset();
    }
  });
  
  Object.values(mockAssetTradeTreeService).forEach(method => {
    if (typeof method === 'function' && 'mockReset' in method) {
      method.mockReset();
    }
  });
};

/**
 * Common mock data for service responses
 */
export const mockServiceResponses = {
  dynastyChain: {
    totalSeasons: 3,
    leagues: [
      { inDatabase: true, sleeperLeagueId: '123', season: '2022' },
      { inDatabase: true, sleeperLeagueId: '124', season: '2023' },
      { inDatabase: true, sleeperLeagueId: '125', season: '2024' }
    ],
    currentLeague: { inDatabase: true, sleeperLeagueId: '125', season: '2024' },
    oldestLeague: { inDatabase: true, sleeperLeagueId: '123', season: '2022' },
    missingSeasons: [],
    brokenChains: []
  },

  assetTradeTree: {
    rootAsset: {
      id: 'player-1',
      type: 'player' as const,
      sleeperId: 'p1',
      name: 'Test Player',
      position: 'RB',
      team: 'BUF'
    },
    totalTransactions: 2,
    seasonsSpanned: 1,
    currentOwner: {
      id: 'mgr-1',
      username: 'testuser',
      displayName: 'Test User'
    },
    originalOwner: {
      id: 'mgr-2',
      username: 'user2',
      displayName: 'User Two'
    },
    transactionPath: [],
    derivedAssets: []
  }
};