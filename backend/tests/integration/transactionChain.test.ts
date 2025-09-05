import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { transactionChainService } from '../../src/services/transactionChainService';
import { config } from '../../src/config';

const prisma = new PrismaClient();

describe('Transaction Chain Integration Tests', () => {
  const TEST_LEAGUE_ID = config.testLeagueId || '1191596293294166016';
  let testPlayerId: string;
  let testDraftPickId: string;
  let testTransactionId: string;
  let testManagerId: string;

  beforeAll(async () => {
    // Set up test data by finding real entities from the test league
    const testLeague = await prisma.league.findUnique({
      where: { sleeperLeagueId: TEST_LEAGUE_ID }
    });

    if (!testLeague) {
      throw new Error(`Test league ${TEST_LEAGUE_ID} not found in database. Run npm run seed:dev first.`);
    }

    // Find a real player from transactions
    const playerTransaction = await prisma.transaction.findFirst({
      where: { 
        leagueId: testLeague.id,
        type: 'trade'
      },
      include: {
        items: {
          where: { player: { isNot: null } },
          include: { player: true }
        }
      }
    });

    if (!playerTransaction?.items[0]?.player) {
      throw new Error('No player transactions found in test league');
    }

    testPlayerId = playerTransaction.items[0].player.id;
    testTransactionId = playerTransaction.id;

    // Find a real draft pick
    const draftPickTransaction = await prisma.transaction.findFirst({
      where: {
        leagueId: testLeague.id,
        type: { in: ['draft', 'trade'] }
      },
      include: {
        items: {
          where: { draftPick: { isNot: null } },
          include: { draftPick: true }
        }
      }
    });

    if (draftPickTransaction?.items[0]?.draftPick) {
      testDraftPickId = draftPickTransaction.items[0].draftPick.id;
    }

    // Find a real manager
    const manager = await prisma.manager.findFirst({
      where: {
        leagues: {
          some: { id: testLeague.id }
        }
      }
    });

    if (!manager) {
      throw new Error('No managers found in test league');
    }

    testManagerId = manager.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('buildTransactionChain', () => {
    test('should build complete chain for a player', async () => {
      const chain = await transactionChainService.buildTransactionChain(
        testPlayerId,
        'player',
        TEST_LEAGUE_ID
      );

      expect(chain).toBeDefined();
      expect(chain.rootAsset).toBeDefined();
      expect(chain.rootAsset.id).toBe(testPlayerId);
      expect(chain.rootAsset.type).toBe('player');
      expect(chain.rootAsset.name).toBeDefined();

      expect(chain.totalTransactions).toBeGreaterThanOrEqual(0);
      expect(chain.seasonsSpanned).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(chain.transactionPath)).toBe(true);
      expect(Array.isArray(chain.derivedAssets)).toBe(true);

      // Verify chronological ordering
      if (chain.transactionPath.length > 1) {
        for (let i = 1; i < chain.transactionPath.length; i++) {
          const prev = BigInt(chain.transactionPath[i - 1].timestamp);
          const curr = BigInt(chain.transactionPath[i].timestamp);
          expect(curr).toBeGreaterThanOrEqual(prev);
        }
      }
    }, 30000);

    test('should build chain for draft pick if available', async () => {
      if (!testDraftPickId) {
        console.log('Skipping draft pick test - no draft picks found in test data');
        return;
      }

      const chain = await transactionChainService.buildTransactionChain(
        testDraftPickId,
        'draft_pick',
        TEST_LEAGUE_ID
      );

      expect(chain).toBeDefined();
      expect(chain.rootAsset.id).toBe(testDraftPickId);
      expect(chain.rootAsset.type).toBe('draft_pick');
      expect(chain.rootAsset.season).toBeDefined();
      expect(chain.rootAsset.round).toBeGreaterThan(0);
    }, 30000);

    test('should handle non-existent player gracefully', async () => {
      await expect(
        transactionChainService.buildTransactionChain(
          'non-existent-player',
          'player',
          TEST_LEAGUE_ID
        )
      ).rejects.toThrow('Player not found');
    });

    test('should handle dynasty chain across multiple seasons', async () => {
      // This should work because the test league has multiple seasons
      const chain = await transactionChainService.buildTransactionChain(
        testPlayerId,
        'player',
        TEST_LEAGUE_ID
      );

      // If the player appears in multiple seasons, seasonsSpanned should be > 1
      if (chain.seasonsSpanned > 1) {
        const seasons = new Set(chain.transactionPath.map(tx => tx.season));
        expect(seasons.size).toBe(chain.seasonsSpanned);
        expect(seasons.size).toBeGreaterThan(1);
      }
    }, 45000);
  });

  describe('buildCompleteTransactionLineage', () => {
    test('should build complete lineage for a transaction', async () => {
      const lineage = await transactionChainService.buildCompleteTransactionLineage(
        testTransactionId,
        testManagerId,
        TEST_LEAGUE_ID
      );

      expect(lineage).toBeDefined();
      expect(lineage.targetTransaction).toBeDefined();
      expect(lineage.targetTransaction.id).toBe(testTransactionId);

      expect(lineage.perspective).toBeDefined();
      expect(lineage.perspective.manager.id).toBe(testManagerId);
      expect(['giving', 'receiving', 'both']).toContain(lineage.perspective.role);

      expect(Array.isArray(lineage.assetLineages)).toBe(true);
      expect(lineage.assetLineages.length).toBeGreaterThan(0);

      // Verify each asset lineage structure
      for (const assetLineage of lineage.assetLineages) {
        expect(assetLineage.asset).toBeDefined();
        expect(['given', 'received']).toContain(assetLineage.transactionSide);
        expect(assetLineage.managedBy).toBeDefined();
        
        expect(assetLineage.originChain).toBeDefined();
        expect(Array.isArray(assetLineage.originChain.transactions)).toBe(true);
        expect(assetLineage.originChain.originPoint).toBeDefined();
        expect(['startup_draft', 'rookie_draft', 'waiver', 'free_agent', 'commissioner']).toContain(
          assetLineage.originChain.originPoint.type
        );

        expect(assetLineage.futureChain).toBeDefined();
        expect(Array.isArray(assetLineage.futureChain.transactions)).toBe(true);
        expect(assetLineage.futureChain.currentStatus).toBeDefined();

        expect(assetLineage.timeline).toBeDefined();
        expect(assetLineage.timeline.totalDays).toBeGreaterThanOrEqual(0);
        expect(Array.isArray(assetLineage.timeline.managerTenures)).toBe(true);
      }

      expect(lineage.summary).toBeDefined();
      expect(lineage.summary.totalAssetsTraced).toBe(lineage.assetLineages.length);
      expect(lineage.summary.longestChainLength).toBeGreaterThanOrEqual(0);
    }, 60000);

    test('should handle manager perspective correctly', async () => {
      const lineage = await transactionChainService.buildCompleteTransactionLineage(
        testTransactionId,
        testManagerId,
        TEST_LEAGUE_ID
      );

      // Manager should be involved in the transaction
      const transaction = lineage.targetTransaction;
      const isManagerFrom = transaction.managerFrom?.id === testManagerId;
      const isManagerTo = transaction.managerTo?.id === testManagerId;
      
      expect(isManagerFrom || isManagerTo).toBe(true);

      // Perspective should match actual involvement
      if (isManagerFrom && isManagerTo) {
        expect(lineage.perspective.role).toBe('both');
      } else if (isManagerFrom) {
        expect(lineage.perspective.role).toBe('giving');
      } else {
        expect(lineage.perspective.role).toBe('receiving');
      }
    });
  });

  describe('getManagerAcquisitionChains', () => {
    test('should get acquisition chains for manager', async () => {
      const result = await transactionChainService.getManagerAcquisitionChains(
        testManagerId,
        TEST_LEAGUE_ID
      );

      expect(result).toBeDefined();
      expect(result.manager).toBeDefined();
      expect(result.manager.id).toBe(testManagerId);

      expect(Array.isArray(result.currentRoster)).toBe(true);
      expect(Array.isArray(result.acquisitionChains)).toBe(true);

      // Should have at least some roster
      if (result.currentRoster.length > 0) {
        expect(result.acquisitionChains.length).toBeGreaterThan(0);

        // Each chain should correspond to a roster asset
        result.acquisitionChains.forEach(chain => {
          expect(chain.rootAsset).toBeDefined();
          expect(result.currentRoster.some(asset => asset.id === chain.rootAsset.id)).toBe(true);
        });
      }
    }, 90000);
  });

  describe('getDraftPickTradeTree', () => {
    test('should build trade tree for draft pick if available', async () => {
      // Find a draft pick we can test
      const testLeague = await prisma.league.findUnique({
        where: { sleeperLeagueId: TEST_LEAGUE_ID }
      });

      const draftPick = await prisma.draftPick.findFirst({
        where: { leagueId: testLeague!.id },
        include: { originalOwner: true }
      });

      if (!draftPick) {
        console.log('Skipping draft pick trade tree test - no draft picks found');
        return;
      }

      const tradeTree = await transactionChainService.getDraftPickTradeTree(
        draftPick.season,
        draftPick.round,
        draftPick.originalOwnerId,
        TEST_LEAGUE_ID
      );

      expect(tradeTree).toBeDefined();
      expect(tradeTree.rootAsset.type).toBe('draft_pick');
      expect(tradeTree.rootAsset.season).toBe(draftPick.season);
      expect(tradeTree.rootAsset.round).toBe(draftPick.round);
    }, 30000);
  });

  describe('Cycle Detection', () => {
    test('should handle circular references gracefully', async () => {
      // This tests the cycle detection in the real system
      // Most circular references would be prevented by the data model,
      // but the algorithm should handle them gracefully
      const chain = await transactionChainService.buildTransactionChain(
        testPlayerId,
        'player',
        TEST_LEAGUE_ID
      );

      expect(chain).toBeDefined();
      expect(chain.transactionPath.length).toBeLessThan(100); // Reasonable upper bound
    }, 30000);
  });

  describe('Multi-Season Traversal', () => {
    test('should traverse across dynasty seasons', async () => {
      // The test league should have multiple seasons linked
      const chain = await transactionChainService.buildTransactionChain(
        testPlayerId,
        'player',
        TEST_LEAGUE_ID
      );

      expect(chain).toBeDefined();

      // If the chain spans multiple seasons, verify the data integrity
      if (chain.seasonsSpanned > 1) {
        const seasons = chain.transactionPath.map(tx => tx.season);
        const uniqueSeasons = new Set(seasons);
        expect(uniqueSeasons.size).toBe(chain.seasonsSpanned);

        // Verify league names change appropriately for different seasons
        const leagueNames = new Set(chain.transactionPath.map(tx => tx.leagueName));
        // Should have appropriate league names (may be same name for dynasty)
        expect(leagueNames.size).toBeGreaterThanOrEqual(1);
      }
    });
  });

  describe('Draft Pick to Player Transformation', () => {
    test('should handle draft pick becoming player', async () => {
      if (!testDraftPickId) {
        console.log('Skipping draft pick transformation test - no draft picks found');
        return;
      }

      const chain = await transactionChainService.buildTransactionChain(
        testDraftPickId,
        'draft_pick',
        TEST_LEAGUE_ID
      );

      expect(chain).toBeDefined();

      // Look for draft transactions where the pick becomes a player
      const draftTransactions = chain.transactionPath.filter(tx => tx.type === 'draft');
      
      if (draftTransactions.length > 0) {
        // Should have assetsGiven (the draft pick) and assetsReceived (the player)
        draftTransactions.forEach(tx => {
          expect(tx.assetsGiven.length).toBeGreaterThan(0);
          expect(tx.assetsReceived.length).toBeGreaterThan(0);
          
          // Should have draft pick origins showing where the pick came from
          if (tx.assetOrigins) {
            tx.assetOrigins.forEach(origin => {
              expect(origin.asset.type).toBe('draft_pick');
              expect(Array.isArray(origin.originChain)).toBe(true);
            });
          }
        });
      }
    });
  });

  describe('Edge Cases', () => {
    test('should handle players with no transaction history', async () => {
      // Find a player that might only appear in current roster without transactions
      const testLeague = await prisma.league.findUnique({
        where: { sleeperLeagueId: TEST_LEAGUE_ID }
      });

      const playerWithoutTxs = await prisma.player.findFirst({
        where: {
          NOT: {
            transactionItems: {
              some: {
                transaction: {
                  leagueId: testLeague!.id
                }
              }
            }
          }
        }
      });

      if (playerWithoutTxs) {
        const chain = await transactionChainService.buildTransactionChain(
          playerWithoutTxs.id,
          'player',
          TEST_LEAGUE_ID
        );

        expect(chain).toBeDefined();
        expect(chain.totalTransactions).toBe(0);
        expect(chain.transactionPath).toHaveLength(0);
        expect(chain.derivedAssets).toHaveLength(0);
      }
    });

    test('should handle self-trades and commissioner moves', async () => {
      // Look for commissioner transactions or unusual transaction types
      const testLeague = await prisma.league.findUnique({
        where: { sleeperLeagueId: TEST_LEAGUE_ID }
      });

      const commissionerTx = await prisma.transaction.findFirst({
        where: {
          leagueId: testLeague!.id,
          type: 'commissioner'
        },
        include: {
          items: {
            include: { player: true }
          }
        }
      });

      if (commissionerTx?.items[0]?.player) {
        const chain = await transactionChainService.buildTransactionChain(
          commissionerTx.items[0].player.id,
          'player',
          TEST_LEAGUE_ID
        );

        expect(chain).toBeDefined();
        
        // Should handle commissioner transactions properly
        const commissionerTransactions = chain.transactionPath.filter(tx => tx.type === 'commissioner');
        expect(commissionerTransactions.length).toBeGreaterThan(0);
      }
    });
  });
});