#!/usr/bin/env node

import { PrismaClient } from '@prisma/client';
import { transactionChainService } from '../services/transactionChainService';
import { assetTradeTreeService } from '../services/assetTradeTreeService';
import { config } from '../config';
import chalk from 'chalk';

const prisma = new PrismaClient();

interface ValidationResult {
  passed: boolean;
  message: string;
  details?: any;
}

interface GraphValidationReport {
  timestamp: Date;
  leagueId: string;
  totalValidations: number;
  passed: number;
  failed: number;
  warnings: number;
  results: ValidationResult[];
  summary: {
    graphConstruction: 'PASS' | 'FAIL' | 'WARN';
    chainTracing: 'PASS' | 'FAIL' | 'WARN';
    dataIntegrity: 'PASS' | 'FAIL' | 'WARN';
    performance: 'PASS' | 'FAIL' | 'WARN';
  };
}

class GraphValidator {
  private results: ValidationResult[] = [];
  private leagueId: string;

  constructor(leagueId: string) {
    this.leagueId = leagueId;
  }

  private addResult(passed: boolean, message: string, details?: any) {
    this.results.push({ passed, message, details });
  }

  /**
   * Validate basic graph construction
   */
  async validateGraphConstruction(): Promise<void> {
    console.log(chalk.blue('🔧 Validating graph construction...'));

    try {
      // Get test league
      const testLeague = await prisma.league.findUnique({
        where: { sleeperLeagueId: this.leagueId }
      });

      if (!testLeague) {
        this.addResult(false, 'Test league not found in database', { leagueId: this.leagueId });
        return;
      }

      // Get transaction count for validation
      const txCount = await prisma.transaction.count({
        where: { leagueId: testLeague.id }
      });

      if (txCount === 0) {
        this.addResult(false, 'No transactions found in test league', { leagueId: testLeague.id });
        return;
      }

      this.addResult(true, `Found ${txCount} transactions in test league`, { transactionCount: txCount });

      // Try to build graph - this will test the core algorithm
      const startTime = Date.now();
      const dynastyChain = await (await import('../services/historicalLeagueService')).historicalLeagueService.getLeagueHistory(this.leagueId);
      const graph = await transactionChainService.buildTransactionGraph(dynastyChain.leagues);
      const buildTime = Date.now() - startTime;

      this.addResult(true, `Graph built successfully in ${buildTime}ms`, {
        buildTimeMs: buildTime,
        nodeCount: graph.nodes.size,
        edgeCount: graph.edges.size,
        chainCount: graph.chains.size
      });

      // Validate graph structure
      if (graph.nodes.size === 0) {
        this.addResult(false, 'Graph has no nodes', { graph: { nodes: 0, edges: 0, chains: 0 } });
      } else {
        this.addResult(true, `Graph has ${graph.nodes.size} nodes`, { nodeCount: graph.nodes.size });
      }

      if (graph.edges.size === 0) {
        this.addResult(false, 'Graph has no edges', { edgeCount: 0 });
      } else {
        this.addResult(true, `Graph has edges for ${graph.edges.size} assets`, { edgeCount: graph.edges.size });
      }

      // Validate that all assets in transactions are in nodes
      let orphanedAssets = 0;
      for (const [txId, transaction] of graph.chains) {
        const allAssets = [...transaction.assetsReceived, ...transaction.assetsGiven];
        for (const asset of allAssets) {
          if (!graph.nodes.has(asset.id)) {
            orphanedAssets++;
          }
        }
      }

      if (orphanedAssets > 0) {
        this.addResult(false, `Found ${orphanedAssets} assets in transactions not in nodes map`, { orphanedAssets });
      } else {
        this.addResult(true, 'All transaction assets are properly mapped to nodes', {});
      }

      // Validate that all edges point to valid transactions
      let invalidEdges = 0;
      for (const [assetId, txIds] of graph.edges) {
        for (const txId of txIds) {
          if (!graph.chains.has(txId)) {
            invalidEdges++;
          }
        }
      }

      if (invalidEdges > 0) {
        this.addResult(false, `Found ${invalidEdges} edges pointing to non-existent transactions`, { invalidEdges });
      } else {
        this.addResult(true, 'All edges point to valid transactions', {});
      }

    } catch (error) {
      this.addResult(false, 'Graph construction failed with error', { 
        error: error instanceof Error ? error.message : String(error) 
      });
    }
  }

  /**
   * Validate transaction chain tracing
   */
  async validateChainTracing(): Promise<void> {
    console.log(chalk.blue('🔗 Validating chain tracing...'));

    try {
      // Find a player with transaction history
      const testLeague = await prisma.league.findUnique({
        where: { sleeperLeagueId: this.leagueId }
      });

      if (!testLeague) return;

      const playerWithTx = await prisma.transaction.findFirst({
        where: { 
          leagueId: testLeague.id,
          type: 'trade'
        },
        include: {
          items: {
            where: { player: { isNot: null } },
            include: { player: true },
            take: 1
          }
        }
      });

      if (!playerWithTx?.items[0]?.player) {
        this.addResult(false, 'No player transactions found for chain tracing test', {});
        return;
      }

      const testPlayer = playerWithTx.items[0].player;

      // Test basic chain building
      const startTime = Date.now();
      const chain = await transactionChainService.buildTransactionChain(
        testPlayer.id,
        'player',
        this.leagueId
      );
      const traceTime = Date.now() - startTime;

      this.addResult(true, `Chain traced successfully for player ${testPlayer.fullName} in ${traceTime}ms`, {
        playerId: testPlayer.id,
        playerName: testPlayer.fullName,
        traceTimeMs: traceTime,
        totalTransactions: chain.totalTransactions,
        seasonsSpanned: chain.seasonsSpanned
      });

      // Validate chain structure
      if (chain.rootAsset.id !== testPlayer.id) {
        this.addResult(false, 'Chain root asset ID mismatch', {
          expected: testPlayer.id,
          actual: chain.rootAsset.id
        });
      } else {
        this.addResult(true, 'Chain root asset matches request', {});
      }

      // Validate chronological ordering
      if (chain.transactionPath.length > 1) {
        let chronologicallyOrdered = true;
        for (let i = 1; i < chain.transactionPath.length; i++) {
          const prevTimestamp = BigInt(chain.transactionPath[i - 1].timestamp);
          const currTimestamp = BigInt(chain.transactionPath[i].timestamp);
          if (currTimestamp < prevTimestamp) {
            chronologicallyOrdered = false;
            break;
          }
        }

        if (chronologicallyOrdered) {
          this.addResult(true, 'Transaction chain is chronologically ordered', {
            transactionCount: chain.transactionPath.length
          });
        } else {
          this.addResult(false, 'Transaction chain is not chronologically ordered', {
            transactionCount: chain.transactionPath.length
          });
        }
      }

      // Test complete transaction lineage
      const startTimeLineage = Date.now();
      const manager = await prisma.manager.findFirst({
        where: {
          leagues: {
            some: { id: testLeague.id }
          }
        }
      });

      if (manager) {
        const lineage = await transactionChainService.buildCompleteTransactionLineage(
          playerWithTx.id,
          manager.id,
          this.leagueId
        );
        const lineageTime = Date.now() - startTimeLineage;

        this.addResult(true, `Complete lineage built in ${lineageTime}ms`, {
          lineageTimeMs: lineageTime,
          assetsTraced: lineage.assetLineages.length,
          longestChain: lineage.summary.longestChainLength
        });

        // Validate lineage structure
        if (lineage.assetLineages.length === 0) {
          this.addResult(false, 'Complete lineage has no asset lineages', {});
        } else {
          this.addResult(true, `Complete lineage traced ${lineage.assetLineages.length} assets`, {
            assetCount: lineage.assetLineages.length
          });
        }
      }

    } catch (error) {
      this.addResult(false, 'Chain tracing failed with error', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Validate data integrity
   */
  async validateDataIntegrity(): Promise<void> {
    console.log(chalk.blue('🔍 Validating data integrity...'));

    try {
      const testLeague = await prisma.league.findUnique({
        where: { sleeperLeagueId: this.leagueId }
      });

      if (!testLeague) return;

      // Check for orphaned transaction items
      const orphanedItems = await prisma.transactionItem.count({
        where: {
          AND: [
            { player: null },
            { draftPick: null }
          ]
        }
      });

      if (orphanedItems > 0) {
        this.addResult(false, `Found ${orphanedItems} transaction items with no associated asset`, {
          orphanedItems
        });
      } else {
        this.addResult(true, 'All transaction items have associated assets', {});
      }

      // Check for transactions with no items
      const emptyTransactions = await prisma.transaction.count({
        where: {
          leagueId: testLeague.id,
          items: {
            none: {}
          }
        }
      });

      if (emptyTransactions > 0) {
        this.addResult(false, `Found ${emptyTransactions} transactions with no items`, {
          emptyTransactions
        });
      } else {
        this.addResult(true, 'All transactions have items', {});
      }

      // Check for circular references in draft picks
      const draftPicks = await prisma.draftPick.findMany({
        where: { leagueId: testLeague.id },
        include: { playerSelected: true }
      });

      let circularPicks = 0;
      for (const pick of draftPicks) {
        if (pick.playerSelectedId === pick.id) {
          circularPicks++;
        }
      }

      if (circularPicks > 0) {
        this.addResult(false, `Found ${circularPicks} draft picks with circular references`, {
          circularPicks
        });
      } else {
        this.addResult(true, 'No circular references found in draft picks', {});
      }

      // Check timestamp consistency
      const transactions = await prisma.transaction.findMany({
        where: { leagueId: testLeague.id },
        orderBy: { timestamp: 'asc' },
        take: 100
      });

      let timestampIssues = 0;
      for (let i = 1; i < transactions.length; i++) {
        if (transactions[i].timestamp < transactions[i - 1].timestamp) {
          timestampIssues++;
        }
      }

      if (timestampIssues > 0) {
        this.addResult(false, `Found ${timestampIssues} timestamp ordering issues`, {
          timestampIssues
        });
      } else {
        this.addResult(true, 'Transaction timestamps are properly ordered', {});
      }

    } catch (error) {
      this.addResult(false, 'Data integrity validation failed', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Validate known scenarios
   */
  async validateKnownScenarios(): Promise<void> {
    console.log(chalk.blue('📋 Validating known scenarios...'));

    try {
      const testLeague = await prisma.league.findUnique({
        where: { sleeperLeagueId: this.leagueId }
      });

      if (!testLeague) return;

      // Scenario 1: Find a trade transaction and validate its structure
      const tradeTransaction = await prisma.transaction.findFirst({
        where: {
          leagueId: testLeague.id,
          type: 'trade'
        },
        include: {
          items: {
            include: {
              player: true,
              manager: true,
              draftPick: true
            }
          }
        }
      });

      if (tradeTransaction) {
        // A trade should have both adds and drops
        const adds = tradeTransaction.items.filter(item => item.type === 'add');
        const drops = tradeTransaction.items.filter(item => item.type === 'drop');

        if (adds.length > 0 && drops.length > 0) {
          this.addResult(true, 'Trade transaction has both adds and drops', {
            transactionId: tradeTransaction.id,
            adds: adds.length,
            drops: drops.length
          });
        } else {
          this.addResult(false, 'Trade transaction missing adds or drops', {
            transactionId: tradeTransaction.id,
            adds: adds.length,
            drops: drops.length
          });
        }

        // Should have at least 2 different managers involved
        const managers = new Set(tradeTransaction.items.map(item => item.manager.id));
        if (managers.size >= 2) {
          this.addResult(true, `Trade involves ${managers.size} managers`, {
            managerCount: managers.size
          });
        } else {
          this.addResult(false, `Trade only involves ${managers.size} manager(s)`, {
            managerCount: managers.size
          });
        }
      }

      // Scenario 2: Validate draft transaction
      const draftTransaction = await prisma.transaction.findFirst({
        where: {
          leagueId: testLeague.id,
          type: 'draft'
        },
        include: {
          items: {
            include: {
              player: true,
              draftPick: true,
              manager: true
            }
          }
        }
      });

      if (draftTransaction) {
        // Draft should have a draft pick drop and player add
        const playerAdds = draftTransaction.items.filter(item => item.type === 'add' && item.player);
        const pickDrops = draftTransaction.items.filter(item => item.type === 'drop' && item.draftPick);

        if (playerAdds.length > 0 && pickDrops.length > 0) {
          this.addResult(true, 'Draft transaction properly converts pick to player', {
            transactionId: draftTransaction.id,
            playersAdded: playerAdds.length,
            picksUsed: pickDrops.length
          });
        } else {
          this.addResult(false, 'Draft transaction structure is invalid', {
            transactionId: draftTransaction.id,
            playersAdded: playerAdds.length,
            picksUsed: pickDrops.length
          });
        }
      }

      // Scenario 3: Test asset trade tree if available
      if (tradeTransaction?.items[0]?.player) {
        const assetId = tradeTransaction.items[0].player.id;
        const startTime = Date.now();
        
        try {
          const tradeTree = await assetTradeTreeService.buildAssetTradeTree(
            assetId,
            tradeTransaction.id,
            testLeague.id
          );
          const treeTime = Date.now() - startTime;

          this.addResult(true, `Asset trade tree built successfully in ${treeTime}ms`, {
            assetId,
            transactionId: tradeTransaction.id,
            treeTimeMs: treeTime
          });
        } catch (error) {
          this.addResult(false, 'Asset trade tree construction failed', {
            assetId,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

    } catch (error) {
      this.addResult(false, 'Known scenarios validation failed', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Test performance with larger datasets
   */
  async validatePerformance(): Promise<void> {
    console.log(chalk.blue('⚡ Validating performance...'));

    try {
      const testLeague = await prisma.league.findUnique({
        where: { sleeperLeagueId: this.leagueId }
      });

      if (!testLeague) return;

      // Test multiple chain builds in parallel
      const players = await prisma.player.findMany({
        where: {
          transactionItems: {
            some: {
              transaction: {
                leagueId: testLeague.id
              }
            }
          }
        },
        take: 5 // Test with 5 players
      });

      if (players.length > 0) {
        const startTime = Date.now();
        const chainPromises = players.map(player =>
          transactionChainService.buildTransactionChain(player.id, 'player', this.leagueId)
        );

        const chains = await Promise.all(chainPromises);
        const totalTime = Date.now() - startTime;
        const avgTime = totalTime / chains.length;

        if (avgTime < 5000) { // Under 5 seconds per chain on average
          this.addResult(true, `Performance test passed: ${chains.length} chains in ${totalTime}ms (avg: ${avgTime.toFixed(0)}ms)`, {
            chainCount: chains.length,
            totalTimeMs: totalTime,
            averageTimeMs: Math.round(avgTime)
          });
        } else {
          this.addResult(false, `Performance test failed: chains taking too long (avg: ${avgTime.toFixed(0)}ms)`, {
            chainCount: chains.length,
            totalTimeMs: totalTime,
            averageTimeMs: Math.round(avgTime)
          });
        }

        // Check for memory leaks by ensuring chains are reasonable size
        const maxTransactions = Math.max(...chains.map(c => c.totalTransactions));
        if (maxTransactions > 1000) {
          this.addResult(false, `Potential infinite loop detected: chain with ${maxTransactions} transactions`, {
            maxTransactions
          });
        } else {
          this.addResult(true, `Chain sizes are reasonable (max: ${maxTransactions} transactions)`, {
            maxTransactions
          });
        }
      }

    } catch (error) {
      this.addResult(false, 'Performance validation failed', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Generate validation report
   */
  generateReport(): GraphValidationReport {
    const passed = this.results.filter(r => r.passed).length;
    const failed = this.results.filter(r => !r.passed).length;
    const warnings = 0; // Could add warning category later

    const categorizeResults = (category: string) => {
      const categoryResults = this.results.filter(r => r.message.toLowerCase().includes(category));
      const categoryPassed = categoryResults.filter(r => r.passed).length;
      const categoryFailed = categoryResults.filter(r => !r.passed).length;
      
      if (categoryFailed > 0) return 'FAIL';
      if (categoryPassed > 0) return 'PASS';
      return 'WARN';
    };

    return {
      timestamp: new Date(),
      leagueId: this.leagueId,
      totalValidations: this.results.length,
      passed,
      failed,
      warnings,
      results: this.results,
      summary: {
        graphConstruction: categorizeResults('graph'),
        chainTracing: categorizeResults('chain'),
        dataIntegrity: categorizeResults('integrity'),
        performance: categorizeResults('performance')
      }
    };
  }

  /**
   * Run all validations
   */
  async runAllValidations(): Promise<GraphValidationReport> {
    console.log(chalk.yellow(`🧪 Starting graph validation for league: ${this.leagueId}`));
    console.log(chalk.gray('=' .repeat(60)));

    await this.validateGraphConstruction();
    await this.validateChainTracing();
    await this.validateDataIntegrity();
    await this.validateKnownScenarios();
    await this.validatePerformance();

    return this.generateReport();
  }
}

async function runValidation(leagueId?: string) {
  const testLeagueId = leagueId || config.testLeagueId || '1191596293294166016';
  
  const validator = new GraphValidator(testLeagueId);
  
  try {
    const report = await validator.runAllValidations();
    
    console.log(chalk.gray('=' .repeat(60)));
    console.log(chalk.yellow('📊 VALIDATION REPORT'));
    console.log(chalk.gray('=' .repeat(60)));
    
    console.log(`📅 Timestamp: ${report.timestamp.toISOString()}`);
    console.log(`🏈 League ID: ${report.leagueId}`);
    console.log(`✅ Passed: ${chalk.green(report.passed)}`);
    console.log(`❌ Failed: ${chalk.red(report.failed)}`);
    console.log(`⚠️  Warnings: ${chalk.yellow(report.warnings)}`);
    
    console.log('\n📋 Category Summary:');
    console.log(`  Graph Construction: ${report.summary.graphConstruction === 'PASS' ? chalk.green('PASS') : chalk.red('FAIL')}`);
    console.log(`  Chain Tracing: ${report.summary.chainTracing === 'PASS' ? chalk.green('PASS') : chalk.red('FAIL')}`);
    console.log(`  Data Integrity: ${report.summary.dataIntegrity === 'PASS' ? chalk.green('PASS') : chalk.red('FAIL')}`);
    console.log(`  Performance: ${report.summary.performance === 'PASS' ? chalk.green('PASS') : chalk.red('FAIL')}`);
    
    console.log('\n📝 Detailed Results:');
    report.results.forEach((result, index) => {
      const icon = result.passed ? '✅' : '❌';
      const color = result.passed ? chalk.green : chalk.red;
      console.log(`  ${icon} ${color(result.message)}`);
      
      if (result.details && Object.keys(result.details).length > 0) {
        console.log(chalk.gray(`     ${JSON.stringify(result.details)}`));
      }
    });

    if (report.failed === 0) {
      console.log(chalk.green('\n🎉 All validations passed! Graph is properly constructed.'));
    } else {
      console.log(chalk.red(`\n🚨 ${report.failed} validations failed. Please review the issues above.`));
      process.exit(1);
    }

  } catch (error) {
    console.error(chalk.red('❌ Validation failed with error:'), error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// CLI handling
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Dynasty DNA Graph Validation Tool');
    console.log('');
    console.log('Usage: npm run validate:graph [league-id]');
    console.log('');
    console.log('Options:');
    console.log('  league-id     Specific league ID to validate (optional)');
    console.log('  --help, -h    Show this help message');
    console.log('');
    console.log('Examples:');
    console.log('  npm run validate:graph                    # Validate default test league');
    console.log('  npm run validate:graph 1234567890        # Validate specific league');
    process.exit(0);
  }

  const leagueId = args[0];
  runValidation(leagueId).catch((error) => {
    console.error('Validation failed:', error);
    process.exit(1);
  });
}

export { GraphValidator, runValidation };