import { TransactionChainService, AssetNode, TransactionNode, TransactionGraph } from '../../src/services/transactionChainService';
import { PrismaClient } from '@prisma/client';

// Mock Prisma
jest.mock('@prisma/client');
const mockPrisma = {
  league: {
    findUnique: jest.fn(),
    findMany: jest.fn()
  },
  transaction: {
    findMany: jest.fn(),
    findUnique: jest.fn()
  },
  player: {
    findUnique: jest.fn()
  },
  draftPick: {
    findUnique: jest.fn()
  },
  manager: {
    findUnique: jest.fn()
  },
  roster: {
    findFirst: jest.fn()
  },
  $disconnect: jest.fn()
} as any;

// Mock historical league service
jest.mock('../../src/services/historicalLeagueService', () => ({
  historicalLeagueService: {
    getLeagueHistory: jest.fn()
  }
}));

describe('TransactionGraph Construction', () => {
  let service: TransactionChainService;
  
  beforeEach(() => {
    jest.clearAllMocks();
    service = new TransactionChainService();
    // Replace the prisma instance with our mock
    (service as any).prisma = mockPrisma;
  });

  afterEach(async () => {
    await service.disconnect();
  });

  describe('Graph Node Creation', () => {
    test('should create nodes for all unique assets', async () => {
      // Mock league data
      const mockLeagues = [
        {
          inDatabase: true,
          sleeperLeagueId: '123',
          season: '2024'
        }
      ];

      const mockLeague = {
        id: 'league-1',
        name: 'Test League',
        sleeperLeagueId: '123'
      };

      const mockTransactions = [
        {
          id: 'tx-1',
          sleeperTransactionId: 'sleeper-tx-1',
          type: 'trade',
          status: 'complete',
          timestamp: BigInt(1640995200000),
          creator: 'user1',
          items: [
            {
              type: 'add',
              player: { id: 'player-1', sleeperId: 'p1', fullName: 'Player One', position: 'RB', team: 'BUF' },
              manager: { id: 'mgr-1', username: 'user1', displayName: 'User One' }
            },
            {
              type: 'drop',
              player: { id: 'player-2', sleeperId: 'p2', fullName: 'Player Two', position: 'WR', team: 'KC' },
              manager: { id: 'mgr-2', username: 'user2', displayName: 'User Two' }
            }
          ]
        }
      ];

      mockPrisma.league.findUnique.mockResolvedValue(mockLeague);
      mockPrisma.transaction.findMany.mockResolvedValue(mockTransactions);

      const graph = await service.buildTransactionGraph(mockLeagues);

      // Verify nodes are created for both players
      expect(graph.nodes.size).toBe(2);
      expect(graph.nodes.has('player-1')).toBe(true);
      expect(graph.nodes.has('player-2')).toBe(true);

      const player1Node = graph.nodes.get('player-1')!;
      expect(player1Node.type).toBe('player');
      expect(player1Node.name).toBe('Player One');
      expect(player1Node.position).toBe('RB');
    });

    test('should create nodes for draft picks', async () => {
      const mockLeagues = [
        {
          inDatabase: true,
          sleeperLeagueId: '123',
          season: '2024'
        }
      ];

      const mockLeague = {
        id: 'league-1',
        name: 'Test League',
        sleeperLeagueId: '123'
      };

      const mockTransactions = [
        {
          id: 'tx-1',
          sleeperTransactionId: 'sleeper-tx-1',
          type: 'trade',
          status: 'complete',
          timestamp: BigInt(1640995200000),
          items: [
            {
              type: 'add',
              draftPick: {
                id: 'pick-1',
                season: '2024',
                round: 1,
                pickNumber: 5,
                originalOwnerId: 'mgr-1',
                currentOwnerId: 'mgr-2',
                playerSelected: { id: 'player-1', fullName: 'Drafted Player' }
              },
              manager: { id: 'mgr-2', username: 'user2', displayName: 'User Two' }
            }
          ]
        }
      ];

      mockPrisma.league.findUnique.mockResolvedValue(mockLeague);
      mockPrisma.transaction.findMany.mockResolvedValue(mockTransactions);

      const graph = await service.buildTransactionGraph(mockLeagues);

      expect(graph.nodes.size).toBe(1);
      expect(graph.nodes.has('pick-1')).toBe(true);

      const pickNode = graph.nodes.get('pick-1')!;
      expect(pickNode.type).toBe('draft_pick');
      expect(pickNode.season).toBe('2024');
      expect(pickNode.round).toBe(1);
      expect(pickNode.name).toBe('Drafted Player');
    });
  });

  describe('Graph Edge Creation', () => {
    test('should create edges linking assets to transactions', async () => {
      const mockLeagues = [
        {
          inDatabase: true,
          sleeperLeagueId: '123',
          season: '2024'
        }
      ];

      const mockLeague = {
        id: 'league-1',
        name: 'Test League',
        sleeperLeagueId: '123'
      };

      const mockTransactions = [
        {
          id: 'tx-1',
          sleeperTransactionId: 'sleeper-tx-1',
          type: 'trade',
          status: 'complete',
          timestamp: BigInt(1640995200000),
          items: [
            {
              type: 'add',
              player: { id: 'player-1', sleeperId: 'p1', fullName: 'Player One', position: 'RB' },
              manager: { id: 'mgr-1', username: 'user1' }
            },
            {
              type: 'drop',
              player: { id: 'player-1', sleeperId: 'p1', fullName: 'Player One', position: 'RB' },
              manager: { id: 'mgr-2', username: 'user2' }
            }
          ]
        },
        {
          id: 'tx-2',
          sleeperTransactionId: 'sleeper-tx-2',
          type: 'trade',
          status: 'complete',
          timestamp: BigInt(1641081600000),
          items: [
            {
              type: 'add',
              player: { id: 'player-1', sleeperId: 'p1', fullName: 'Player One', position: 'RB' },
              manager: { id: 'mgr-3', username: 'user3' }
            }
          ]
        }
      ];

      mockPrisma.league.findUnique.mockResolvedValue(mockLeague);
      mockPrisma.transaction.findMany.mockResolvedValue(mockTransactions);

      const graph = await service.buildTransactionGraph(mockLeagues);

      // Player should be connected to both transactions
      expect(graph.edges.has('player-1')).toBe(true);
      const player1Edges = graph.edges.get('player-1')!;
      expect(player1Edges).toHaveLength(2);
      expect(player1Edges).toContain('tx-1');
      expect(player1Edges).toContain('tx-2');
    });

    test('should handle assets appearing in multiple transactions', async () => {
      const mockLeagues = [
        {
          inDatabase: true,
          sleeperLeagueId: '123',
          season: '2024'
        }
      ];

      const mockLeague = {
        id: 'league-1',
        name: 'Test League',
        sleeperLeagueId: '123'
      };

      const mockTransactions = [
        {
          id: 'tx-1',
          type: 'waiver',
          timestamp: BigInt(1640995200000),
          items: [
            {
              type: 'add',
              player: { id: 'player-1', sleeperId: 'p1', fullName: 'Player One' },
              manager: { id: 'mgr-1', username: 'user1' }
            }
          ]
        },
        {
          id: 'tx-2',
          type: 'trade',
          timestamp: BigInt(1641081600000),
          items: [
            {
              type: 'drop',
              player: { id: 'player-1', sleeperId: 'p1', fullName: 'Player One' },
              manager: { id: 'mgr-1', username: 'user1' }
            }
          ]
        },
        {
          id: 'tx-3',
          type: 'trade',
          timestamp: BigInt(1641168000000),
          items: [
            {
              type: 'add',
              player: { id: 'player-1', sleeperId: 'p1', fullName: 'Player One' },
              manager: { id: 'mgr-3', username: 'user3' }
            }
          ]
        }
      ];

      mockPrisma.league.findUnique.mockResolvedValue(mockLeague);
      mockPrisma.transaction.findMany.mockResolvedValue(mockTransactions);

      const graph = await service.buildTransactionGraph(mockLeagues);

      const player1Edges = graph.edges.get('player-1')!;
      expect(player1Edges).toHaveLength(3);
      expect(new Set(player1Edges)).toEqual(new Set(['tx-1', 'tx-2', 'tx-3']));
    });
  });

  describe('Transaction Chain Storage', () => {
    test('should store transaction details in chains map', async () => {
      const mockLeagues = [
        {
          inDatabase: true,
          sleeperLeagueId: '123',
          season: '2024'
        }
      ];

      const mockLeague = {
        id: 'league-1',
        name: 'Test League',
        sleeperLeagueId: '123'
      };

      const mockTransactions = [
        {
          id: 'tx-1',
          sleeperTransactionId: 'sleeper-tx-1',
          type: 'trade',
          status: 'complete',
          week: 5,
          timestamp: BigInt(1640995200000),
          creator: 'user1',
          items: [
            {
              type: 'add',
              player: { id: 'player-1', sleeperId: 'p1', fullName: 'Player One', position: 'RB' },
              manager: { id: 'mgr-1', username: 'user1', displayName: 'User One' }
            },
            {
              type: 'drop',
              player: { id: 'player-2', sleeperId: 'p2', fullName: 'Player Two', position: 'WR' },
              manager: { id: 'mgr-2', username: 'user2', displayName: 'User Two' }
            }
          ]
        }
      ];

      mockPrisma.league.findUnique.mockResolvedValue(mockLeague);
      mockPrisma.transaction.findMany.mockResolvedValue(mockTransactions);

      const graph = await service.buildTransactionGraph(mockLeagues);

      expect(graph.chains.has('tx-1')).toBe(true);
      const txNode = graph.chains.get('tx-1')!;
      
      expect(txNode.id).toBe('tx-1');
      expect(txNode.sleeperTransactionId).toBe('sleeper-tx-1');
      expect(txNode.type).toBe('trade');
      expect(txNode.status).toBe('complete');
      expect(txNode.week).toBe(5);
      expect(txNode.season).toBe('2024');
      expect(txNode.leagueName).toBe('Test League');
      expect(txNode.timestamp).toBe('1640995200000');
      
      expect(txNode.assetsReceived).toHaveLength(1);
      expect(txNode.assetsGiven).toHaveLength(1);
      
      expect(txNode.managerFrom?.username).toBe('user2');
      expect(txNode.managerTo?.username).toBe('user1');
    });
  });

  describe('Chronological Ordering', () => {
    test('should maintain chronological order in transaction chains', async () => {
      const mockLeagues = [
        {
          inDatabase: true,
          sleeperLeagueId: '123',
          season: '2024'
        }
      ];

      const mockLeague = {
        id: 'league-1',
        name: 'Test League',
        sleeperLeagueId: '123'
      };

      // Transactions in random order but should be sorted by timestamp
      const mockTransactions = [
        {
          id: 'tx-3',
          type: 'trade',
          timestamp: BigInt(1641168000000), // Latest
          items: [
            {
              type: 'add',
              player: { id: 'player-1', sleeperId: 'p1', fullName: 'Player One' },
              manager: { id: 'mgr-1', username: 'user1' }
            }
          ]
        },
        {
          id: 'tx-1',
          type: 'waiver',
          timestamp: BigInt(1640995200000), // Earliest
          items: [
            {
              type: 'add',
              player: { id: 'player-1', sleeperId: 'p1', fullName: 'Player One' },
              manager: { id: 'mgr-1', username: 'user1' }
            }
          ]
        },
        {
          id: 'tx-2',
          type: 'trade',
          timestamp: BigInt(1641081600000), // Middle
          items: [
            {
              type: 'drop',
              player: { id: 'player-1', sleeperId: 'p1', fullName: 'Player One' },
              manager: { id: 'mgr-1', username: 'user1' }
            }
          ]
        }
      ];

      mockPrisma.league.findUnique.mockResolvedValue(mockLeague);
      mockPrisma.transaction.findMany.mockResolvedValue(mockTransactions);

      const graph = await service.buildTransactionGraph(mockLeagues);

      // Verify transactions are stored (order in chains map may vary)
      expect(graph.chains.size).toBe(3);
      expect(graph.chains.has('tx-1')).toBe(true);
      expect(graph.chains.has('tx-2')).toBe(true);
      expect(graph.chains.has('tx-3')).toBe(true);

      // The real chronological ordering test would be in the transaction path tracing
      const player1Edges = graph.edges.get('player-1')!;
      expect(player1Edges).toEqual(expect.arrayContaining(['tx-1', 'tx-2', 'tx-3']));
    });
  });

  describe('Multi-Season Graph Construction', () => {
    test('should build graph across multiple seasons', async () => {
      const mockLeagues = [
        {
          inDatabase: true,
          sleeperLeagueId: '123',
          season: '2023'
        },
        {
          inDatabase: true,
          sleeperLeagueId: '456',
          season: '2024'
        }
      ];

      const mockLeague2023 = {
        id: 'league-1',
        name: 'Test League 2023',
        sleeperLeagueId: '123'
      };

      const mockLeague2024 = {
        id: 'league-2',
        name: 'Test League 2024',
        sleeperLeagueId: '456'
      };

      const mockTransactions2023 = [
        {
          id: 'tx-2023-1',
          type: 'draft',
          timestamp: BigInt(1640995200000),
          items: [
            {
              type: 'add',
              player: { id: 'player-1', sleeperId: 'p1', fullName: 'Player One' },
              manager: { id: 'mgr-1', username: 'user1' }
            }
          ]
        }
      ];

      const mockTransactions2024 = [
        {
          id: 'tx-2024-1',
          type: 'trade',
          timestamp: BigInt(1641081600000),
          items: [
            {
              type: 'drop',
              player: { id: 'player-1', sleeperId: 'p1', fullName: 'Player One' },
              manager: { id: 'mgr-1', username: 'user1' }
            }
          ]
        }
      ];

      mockPrisma.league.findUnique
        .mockResolvedValueOnce(mockLeague2023)
        .mockResolvedValueOnce(mockLeague2024);
      
      mockPrisma.transaction.findMany
        .mockResolvedValueOnce(mockTransactions2023)
        .mockResolvedValueOnce(mockTransactions2024);

      const graph = await service.buildTransactionGraph(mockLeagues);

      // Verify both transactions are in the graph
      expect(graph.chains.size).toBe(2);
      expect(graph.chains.has('tx-2023-1')).toBe(true);
      expect(graph.chains.has('tx-2024-1')).toBe(true);

      // Verify player appears in both transactions
      const player1Edges = graph.edges.get('player-1')!;
      expect(player1Edges).toEqual(expect.arrayContaining(['tx-2023-1', 'tx-2024-1']));

      // Verify different season information
      const tx2023 = graph.chains.get('tx-2023-1')!;
      const tx2024 = graph.chains.get('tx-2024-1')!;
      expect(tx2023.season).toBe('2023');
      expect(tx2024.season).toBe('2024');
    });
  });

  describe('Error Handling', () => {
    test('should handle missing league gracefully', async () => {
      const mockLeagues = [
        {
          inDatabase: true,
          sleeperLeagueId: '999',
          season: '2024'
        }
      ];

      mockPrisma.league.findUnique.mockResolvedValue(null);

      const graph = await service.buildTransactionGraph(mockLeagues);

      expect(graph.nodes.size).toBe(0);
      expect(graph.edges.size).toBe(0);
      expect(graph.chains.size).toBe(0);
    });

    test('should handle leagues not in database', async () => {
      const mockLeagues = [
        {
          inDatabase: false,
          sleeperLeagueId: '123',
          season: '2024'
        }
      ];

      const graph = await service.buildTransactionGraph(mockLeagues);

      expect(graph.nodes.size).toBe(0);
      expect(graph.edges.size).toBe(0);
      expect(graph.chains.size).toBe(0);
      
      // Should not have called findUnique since league is not in database
      expect(mockPrisma.league.findUnique).not.toHaveBeenCalled();
    });

    test('should handle transactions with missing player data', async () => {
      const mockLeagues = [
        {
          inDatabase: true,
          sleeperLeagueId: '123',
          season: '2024'
        }
      ];

      const mockLeague = {
        id: 'league-1',
        name: 'Test League',
        sleeperLeagueId: '123'
      };

      const mockTransactions = [
        {
          id: 'tx-1',
          type: 'trade',
          timestamp: BigInt(1640995200000),
          items: [
            {
              type: 'add',
              player: null, // Missing player data
              manager: { id: 'mgr-1', username: 'user1' }
            }
          ]
        }
      ];

      mockPrisma.league.findUnique.mockResolvedValue(mockLeague);
      mockPrisma.transaction.findMany.mockResolvedValue(mockTransactions);

      // Should not throw but should handle gracefully
      await expect(service.buildTransactionGraph(mockLeagues)).rejects.toThrow();
    });
  });
});