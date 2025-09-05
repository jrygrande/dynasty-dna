import { TransactionChainService } from '../../src/services/transactionChainService';
import { PrismaClient } from '@prisma/client';

// Mock Prisma and dependencies
jest.mock('@prisma/client');
jest.mock('../../src/services/historicalLeagueService', () => ({
  historicalLeagueService: {
    getLeagueHistory: jest.fn()
  }
}));

const mockPrisma = {
  league: { findUnique: jest.fn() },
  transaction: { findMany: jest.fn(), findUnique: jest.fn() },
  player: { findUnique: jest.fn() },
  draftPick: { findUnique: jest.fn() },
  manager: { findUnique: jest.fn() },
  roster: { findFirst: jest.fn() },
  $disconnect: jest.fn()
} as any;

const mockHistoricalService = require('../../src/services/historicalLeagueService').historicalLeagueService;

describe('Transaction Graph Edge Cases and Performance Tests', () => {
  let service: TransactionChainService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TransactionChainService();
    (service as any).prisma = mockPrisma;
  });

  afterEach(async () => {
    await service.disconnect();
  });

  describe('Circular Reference Handling', () => {
    test('should detect and prevent infinite loops in asset chains', async () => {
      const mockLeagues = [
        { inDatabase: true, sleeperLeagueId: '123', season: '2024' }
      ];

      const mockLeague = { id: 'league-1', name: 'Test League', sleeperLeagueId: '123' };

      // Create circular transactions: A -> B -> A
      const mockTransactions = [
        {
          id: 'tx-1',
          type: 'trade',
          timestamp: BigInt(1640995200000),
          items: [
            {
              type: 'add',
              player: { id: 'player-A', sleeperId: 'pA', fullName: 'Player A' },
              manager: { id: 'mgr-1', username: 'user1' }
            },
            {
              type: 'drop',
              player: { id: 'player-B', sleeperId: 'pB', fullName: 'Player B' },
              manager: { id: 'mgr-2', username: 'user2' }
            }
          ]
        },
        {
          id: 'tx-2',
          type: 'trade',
          timestamp: BigInt(1641081600000),
          items: [
            {
              type: 'add',
              player: { id: 'player-B', sleeperId: 'pB', fullName: 'Player B' },
              manager: { id: 'mgr-1', username: 'user1' }
            },
            {
              type: 'drop',
              player: { id: 'player-A', sleeperId: 'pA', fullName: 'Player A' },
              manager: { id: 'mgr-2', username: 'user2' }
            }
          ]
        }
      ];

      mockPrisma.league.findUnique.mockResolvedValue(mockLeague);
      mockPrisma.transaction.findMany.mockResolvedValue(mockTransactions);
      mockHistoricalService.getLeagueHistory.mockResolvedValue({ leagues: mockLeagues });
      mockPrisma.player.findUnique.mockResolvedValue({ 
        id: 'player-A', 
        sleeperId: 'pA', 
        fullName: 'Player A' 
      });

      // Should complete without infinite loop
      const startTime = Date.now();
      const chain = await service.buildTransactionChain('player-A', 'player', '123');
      const duration = Date.now() - startTime;

      expect(chain).toBeDefined();
      expect(chain.rootAsset.id).toBe('player-A');
      expect(duration).toBeLessThan(5000); // Should complete quickly
      expect(chain.transactionPath.length).toBeLessThanOrEqual(100); // Reasonable upper bound
    });

    test('should handle self-referencing draft picks', async () => {
      const mockLeagues = [
        { inDatabase: true, sleeperLeagueId: '123', season: '2024' }
      ];

      const mockLeague = { id: 'league-1', name: 'Test League', sleeperLeagueId: '123' };

      // Draft pick that somehow references itself (data corruption scenario)
      const mockTransactions = [
        {
          id: 'tx-1',
          type: 'trade',
          timestamp: BigInt(1640995200000),
          items: [
            {
              type: 'add',
              draftPick: {
                id: 'pick-1',
                season: '2024',
                round: 1,
                originalOwnerId: 'mgr-1',
                currentOwnerId: 'mgr-1', // Same as original - potential issue
                playerSelected: null
              },
              manager: { id: 'mgr-1', username: 'user1' }
            }
          ]
        }
      ];

      mockPrisma.league.findUnique.mockResolvedValue(mockLeague);
      mockPrisma.transaction.findMany.mockResolvedValue(mockTransactions);
      mockHistoricalService.getLeagueHistory.mockResolvedValue({ leagues: mockLeagues });
      mockPrisma.draftPick.findUnique.mockResolvedValue({
        id: 'pick-1',
        season: '2024',
        round: 1,
        originalOwnerId: 'mgr-1',
        currentOwnerId: 'mgr-1',
        playerSelected: null
      });

      const chain = await service.buildTransactionChain('pick-1', 'draft_pick', '123');

      expect(chain).toBeDefined();
      expect(chain.rootAsset.id).toBe('pick-1');
      expect(chain.rootAsset.type).toBe('draft_pick');
    });
  });

  describe('Complex Multi-Team Trades', () => {
    test('should handle 3+ team trades correctly', async () => {
      const mockLeagues = [
        { inDatabase: true, sleeperLeagueId: '123', season: '2024' }
      ];

      const mockLeague = { id: 'league-1', name: 'Test League', sleeperLeagueId: '123' };

      // 3-team trade: Team A gives Player 1, gets Player 3; Team B gives Player 2, gets Player 1; Team C gives Player 3, gets Player 2
      const mockTransactions = [
        {
          id: 'tx-1',
          type: 'trade',
          timestamp: BigInt(1640995200000),
          items: [
            // Team A: gives Player 1, gets Player 3
            {
              type: 'drop',
              player: { id: 'player-1', sleeperId: 'p1', fullName: 'Player One' },
              manager: { id: 'mgr-A', username: 'teamA' }
            },
            {
              type: 'add',
              player: { id: 'player-3', sleeperId: 'p3', fullName: 'Player Three' },
              manager: { id: 'mgr-A', username: 'teamA' }
            },
            // Team B: gives Player 2, gets Player 1
            {
              type: 'drop',
              player: { id: 'player-2', sleeperId: 'p2', fullName: 'Player Two' },
              manager: { id: 'mgr-B', username: 'teamB' }
            },
            {
              type: 'add',
              player: { id: 'player-1', sleeperId: 'p1', fullName: 'Player One' },
              manager: { id: 'mgr-B', username: 'teamB' }
            },
            // Team C: gives Player 3, gets Player 2
            {
              type: 'drop',
              player: { id: 'player-3', sleeperId: 'p3', fullName: 'Player Three' },
              manager: { id: 'mgr-C', username: 'teamC' }
            },
            {
              type: 'add',
              player: { id: 'player-2', sleeperId: 'p2', fullName: 'Player Two' },
              manager: { id: 'mgr-C', username: 'teamC' }
            }
          ]
        }
      ];

      mockPrisma.league.findUnique.mockResolvedValue(mockLeague);
      mockPrisma.transaction.findMany.mockResolvedValue(mockTransactions);
      mockHistoricalService.getLeagueHistory.mockResolvedValue({ leagues: mockLeagues });

      const graph = await service.buildTransactionGraph(mockLeagues);

      // All three players should be in the graph
      expect(graph.nodes.size).toBe(3);
      expect(graph.nodes.has('player-1')).toBe(true);
      expect(graph.nodes.has('player-2')).toBe(true);
      expect(graph.nodes.has('player-3')).toBe(true);

      // All players should be connected to the same transaction
      expect(graph.edges.get('player-1')).toEqual(['tx-1']);
      expect(graph.edges.get('player-2')).toEqual(['tx-1']);
      expect(graph.edges.get('player-3')).toEqual(['tx-1']);

      // Transaction should have all 6 items (3 adds, 3 drops)
      const transaction = graph.chains.get('tx-1')!;
      expect(transaction.assetsReceived.length + transaction.assetsGiven.length).toBe(6);
    });
  });

  describe('Draft Pick Transformation Edge Cases', () => {
    test('should handle draft pick that becomes multiple players (invalid scenario)', async () => {
      const mockLeagues = [
        { inDatabase: true, sleeperLeagueId: '123', season: '2024' }
      ];

      const mockLeague = { id: 'league-1', name: 'Test League', sleeperLeagueId: '123' };

      // Impossible scenario: one pick becomes two players (data corruption)
      const mockTransactions = [
        {
          id: 'tx-1',
          type: 'draft',
          timestamp: BigInt(1640995200000),
          items: [
            {
              type: 'drop',
              draftPick: {
                id: 'pick-1',
                season: '2024',
                round: 1,
                originalOwnerId: 'mgr-1',
                playerSelected: { id: 'player-1', fullName: 'Player One' }
              },
              manager: { id: 'mgr-1', username: 'user1' }
            },
            {
              type: 'add',
              player: { id: 'player-1', sleeperId: 'p1', fullName: 'Player One' },
              manager: { id: 'mgr-1', username: 'user1' }
            },
            {
              type: 'add', // Invalid: second player from same pick
              player: { id: 'player-2', sleeperId: 'p2', fullName: 'Player Two' },
              manager: { id: 'mgr-1', username: 'user1' }
            }
          ]
        }
      ];

      mockPrisma.league.findUnique.mockResolvedValue(mockLeague);
      mockPrisma.transaction.findMany.mockResolvedValue(mockTransactions);

      // Should handle gracefully without crashing
      const graph = await service.buildTransactionGraph(mockLeagues);
      expect(graph.nodes.size).toBeGreaterThan(0);
      expect(graph.chains.has('tx-1')).toBe(true);
    });

    test('should handle draft pick with missing player selection', async () => {
      const mockLeagues = [
        { inDatabase: true, sleeperLeagueId: '123', season: '2024' }
      ];

      const mockLeague = { id: 'league-1', name: 'Test League', sleeperLeagueId: '123' };

      const mockTransactions = [
        {
          id: 'tx-1',
          type: 'draft',
          timestamp: BigInt(1640995200000),
          items: [
            {
              type: 'drop',
              draftPick: {
                id: 'pick-1',
                season: '2024',
                round: 1,
                originalOwnerId: 'mgr-1',
                playerSelected: null // No player selected yet
              },
              manager: { id: 'mgr-1', username: 'user1' }
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
      expect(pickNode.name).toBe('2024 Round 1 Pick'); // Should use fallback name
    });
  });

  describe('Timestamp Edge Cases', () => {
    test('should handle transactions with identical timestamps', async () => {
      const mockLeagues = [
        { inDatabase: true, sleeperLeagueId: '123', season: '2024' }
      ];

      const mockLeague = { id: 'league-1', name: 'Test League', sleeperLeagueId: '123' };

      const sameTimestamp = BigInt(1640995200000);
      const mockTransactions = [
        {
          id: 'tx-1',
          type: 'trade',
          timestamp: sameTimestamp,
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
          timestamp: sameTimestamp, // Same timestamp
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

      expect(graph.chains.size).toBe(2);
      expect(graph.edges.get('player-1')).toEqual(expect.arrayContaining(['tx-1', 'tx-2']));
    });

    test('should handle very large timestamp values', async () => {
      const mockLeagues = [
        { inDatabase: true, sleeperLeagueId: '123', season: '2024' }
      ];

      const mockLeague = { id: 'league-1', name: 'Test League', sleeperLeagueId: '123' };

      const mockTransactions = [
        {
          id: 'tx-1',
          type: 'trade',
          timestamp: BigInt('9223372036854775807'), // Max BigInt value
          items: [
            {
              type: 'add',
              player: { id: 'player-1', sleeperId: 'p1', fullName: 'Player One' },
              manager: { id: 'mgr-1', username: 'user1' }
            }
          ]
        }
      ];

      mockPrisma.league.findUnique.mockResolvedValue(mockLeague);
      mockPrisma.transaction.findMany.mockResolvedValue(mockTransactions);

      const graph = await service.buildTransactionGraph(mockLeagues);
      const transaction = graph.chains.get('tx-1')!;

      // Should convert to string properly
      expect(transaction.timestamp).toBe('9223372036854775807');
      expect(typeof transaction.timestamp).toBe('string');
    });
  });

  describe('Performance Tests', () => {
    test('should handle large transaction sets efficiently', async () => {
      const mockLeagues = [
        { inDatabase: true, sleeperLeagueId: '123', season: '2024' }
      ];

      const mockLeague = { id: 'league-1', name: 'Test League', sleeperLeagueId: '123' };

      // Generate 1000 transactions with 10000 unique players
      const mockTransactions = [];
      for (let i = 0; i < 1000; i++) {
        mockTransactions.push({
          id: `tx-${i}`,
          type: 'trade',
          timestamp: BigInt(1640995200000 + i * 1000),
          items: [
            {
              type: 'add',
              player: { 
                id: `player-${i * 10}`, 
                sleeperId: `p${i * 10}`, 
                fullName: `Player ${i * 10}` 
              },
              manager: { id: `mgr-${i % 12}`, username: `user${i % 12}` }
            },
            {
              type: 'drop',
              player: { 
                id: `player-${i * 10 + 1}`, 
                sleeperId: `p${i * 10 + 1}`, 
                fullName: `Player ${i * 10 + 1}` 
              },
              manager: { id: `mgr-${(i + 1) % 12}`, username: `user${(i + 1) % 12}` }
            }
          ]
        });
      }

      mockPrisma.league.findUnique.mockResolvedValue(mockLeague);
      mockPrisma.transaction.findMany.mockResolvedValue(mockTransactions);

      const startTime = Date.now();
      const graph = await service.buildTransactionGraph(mockLeagues);
      const buildTime = Date.now() - startTime;

      expect(buildTime).toBeLessThan(5000); // Should complete within 5 seconds
      expect(graph.nodes.size).toBe(2000); // 2 players per transaction * 1000 transactions
      expect(graph.chains.size).toBe(1000);
    });

    test('should handle deep recursion chains', async () => {
      const mockLeagues = [
        { inDatabase: true, sleeperLeagueId: '123', season: '2024' }
      ];

      const mockLeague = { id: 'league-1', name: 'Test League', sleeperLeagueId: '123' };

      // Create a long chain: player-0 -> player-1 -> player-2 -> ... -> player-99
      const mockTransactions = [];
      for (let i = 0; i < 100; i++) {
        mockTransactions.push({
          id: `tx-${i}`,
          type: 'trade',
          timestamp: BigInt(1640995200000 + i * 1000),
          items: [
            {
              type: 'add',
              player: { 
                id: `player-${i + 1}`, 
                sleeperId: `p${i + 1}`, 
                fullName: `Player ${i + 1}` 
              },
              manager: { id: 'mgr-1', username: 'user1' }
            },
            {
              type: 'drop',
              player: { 
                id: `player-${i}`, 
                sleeperId: `p${i}`, 
                fullName: `Player ${i}` 
              },
              manager: { id: 'mgr-1', username: 'user1' }
            }
          ]
        });
      }

      mockPrisma.league.findUnique.mockResolvedValue(mockLeague);
      mockPrisma.transaction.findMany.mockResolvedValue(mockTransactions);
      mockHistoricalService.getLeagueHistory.mockResolvedValue({ leagues: mockLeagues });
      mockPrisma.player.findUnique.mockResolvedValue({ 
        id: 'player-0', 
        sleeperId: 'p0', 
        fullName: 'Player 0' 
      });

      const startTime = Date.now();
      const chain = await service.buildTransactionChain('player-0', 'player', '123');
      const traceTime = Date.now() - startTime;

      expect(traceTime).toBeLessThan(10000); // Should complete within 10 seconds
      expect(chain.transactionPath.length).toBeLessThanOrEqual(100); // Should not exceed chain length
    });
  });

  describe('Memory Management', () => {
    test('should not leak memory with large datasets', async () => {
      const mockLeagues = [
        { inDatabase: true, sleeperLeagueId: '123', season: '2024' }
      ];

      // Create multiple separate graphs to test memory cleanup
      for (let iteration = 0; iteration < 10; iteration++) {
        const mockTransactions = [];
        for (let i = 0; i < 100; i++) {
          mockTransactions.push({
            id: `tx-${iteration}-${i}`,
            type: 'trade',
            timestamp: BigInt(1640995200000 + i * 1000),
            items: [
              {
                type: 'add',
                player: { 
                  id: `player-${iteration}-${i}`, 
                  sleeperId: `p${iteration}${i}`, 
                  fullName: `Player ${iteration}-${i}` 
                },
                manager: { id: 'mgr-1', username: 'user1' }
              }
            ]
          });
        }

        mockPrisma.league.findUnique.mockResolvedValue({
          id: `league-${iteration}`,
          name: `Test League ${iteration}`,
          sleeperLeagueId: '123'
        });
        mockPrisma.transaction.findMany.mockResolvedValue(mockTransactions);

        const graph = await service.buildTransactionGraph(mockLeagues);
        
        expect(graph.nodes.size).toBe(100);
        expect(graph.chains.size).toBe(100);

        // Clear references to help GC
        graph.nodes.clear();
        graph.chains.clear();
        graph.edges.clear();
      }

      // If we reach here without running out of memory, the test passes
      expect(true).toBe(true);
    });
  });

  describe('Data Corruption Scenarios', () => {
    test('should handle transactions with no items', async () => {
      const mockLeagues = [
        { inDatabase: true, sleeperLeagueId: '123', season: '2024' }
      ];

      const mockLeague = { id: 'league-1', name: 'Test League', sleeperLeagueId: '123' };

      const mockTransactions = [
        {
          id: 'tx-1',
          type: 'trade',
          timestamp: BigInt(1640995200000),
          items: [] // No items - data corruption
        }
      ];

      mockPrisma.league.findUnique.mockResolvedValue(mockLeague);
      mockPrisma.transaction.findMany.mockResolvedValue(mockTransactions);

      const graph = await service.buildTransactionGraph(mockLeagues);

      expect(graph.chains.has('tx-1')).toBe(true);
      const transaction = graph.chains.get('tx-1')!;
      expect(transaction.assetsReceived).toHaveLength(0);
      expect(transaction.assetsGiven).toHaveLength(0);
    });

    test('should handle mixed null and valid data', async () => {
      const mockLeagues = [
        { inDatabase: true, sleeperLeagueId: '123', season: '2024' }
      ];

      const mockLeague = { id: 'league-1', name: 'Test League', sleeperLeagueId: '123' };

      const mockTransactions = [
        {
          id: 'tx-1',
          type: 'trade',
          timestamp: BigInt(1640995200000),
          items: [
            {
              type: 'add',
              player: null, // Null player
              draftPick: null, // Null draft pick
              manager: { id: 'mgr-1', username: 'user1' }
            },
            {
              type: 'add',
              player: { id: 'player-1', sleeperId: 'p1', fullName: 'Player One' },
              draftPick: null,
              manager: { id: 'mgr-1', username: 'user1' }
            }
          ]
        }
      ];

      mockPrisma.league.findUnique.mockResolvedValue(mockLeague);
      mockPrisma.transaction.findMany.mockResolvedValue(mockTransactions);

      // Should throw error for invalid data but not crash
      await expect(service.buildTransactionGraph(mockLeagues)).rejects.toThrow();
    });
  });
});