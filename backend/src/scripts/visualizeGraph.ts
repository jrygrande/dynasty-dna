#!/usr/bin/env node

import { PrismaClient } from '@prisma/client';
import { transactionChainService } from '../services/transactionChainService';
import { historicalLeagueService } from '../services/historicalLeagueService';
import { config } from '../config';
import chalk from 'chalk';

const prisma = new PrismaClient();

interface GraphStats {
  buildTimeMs: number;
  totalNodes: number;
  totalEdges: number;
  totalTransactions: number;
  transactionTypes: Record<string, number>;
  assetTypes: Record<string, number>;
  seasonsSpanned: number;
  managersInvolved: number;
  avgTransactionsPerAsset: number;
  maxTransactionsPerAsset: number;
}

interface GraphNode {
  id: string;
  type: 'player' | 'draft_pick';
  name?: string;
  sleeperId?: string;
  season?: string;
  round?: number;
  position?: string | null;
  team?: string | null;
}

interface GraphEdge {
  assetId: string;
  transactionIds: string[];
}

interface GraphTransaction {
  id: string;
  type: string;
  season: string;
  timestamp: string;
  week?: number;
  managerFrom?: {
    id: string;
    username: string;
    displayName?: string;
  };
  managerTo?: {
    id: string;
    username: string;
    displayName?: string;
  };
  assetsReceived: GraphNode[];
  assetsGiven: GraphNode[];
}

interface GraphVisualizationOptions {
  leagueId: string;
  format: 'stats' | 'summary' | 'detailed';
  season?: string;
  transactionType?: string;
  managerId?: string;
  outputFormat: 'console' | 'json' | 'dot';
  limit?: number;
}

class TransactionGraphVisualizer {
  private options: GraphVisualizationOptions;

  constructor(options: GraphVisualizationOptions) {
    this.options = options;
  }

  /**
   * Main visualization method
   */
  async visualize(): Promise<void> {
    console.log(chalk.cyan('🔥 Dynasty DNA Transaction Graph Visualizer'));
    console.log(chalk.gray('=' .repeat(60)));
    console.log(chalk.blue(`📊 Analyzing league: ${this.options.leagueId}`));
    
    if (this.options.season) {
      console.log(chalk.blue(`📅 Season filter: ${this.options.season}`));
    }
    if (this.options.transactionType) {
      console.log(chalk.blue(`🏷️  Transaction type: ${this.options.transactionType}`));
    }
    if (this.options.managerId) {
      console.log(chalk.blue(`👤 Manager filter: ${this.options.managerId}`));
    }

    try {
      // Build the transaction graph
      const startTime = Date.now();
      const graphData = await this.buildGraph();
      const totalTime = Date.now() - startTime;

      console.log(chalk.green(`✅ Graph built in ${totalTime}ms`));
      console.log(chalk.gray('=' .repeat(60)));

      // Generate visualization based on format
      switch (this.options.format) {
        case 'stats':
          await this.renderStats(graphData.statistics);
          break;
        case 'summary':
          await this.renderSummary(graphData);
          break;
        case 'detailed':
          await this.renderDetailed(graphData);
          break;
      }

      // Export if requested
      if (this.options.outputFormat !== 'console') {
        await this.exportGraph(graphData);
      }

    } catch (error) {
      console.error(chalk.red('❌ Visualization failed:'), error);
      process.exit(1);
    }
  }

  /**
   * Build the graph using the transaction chain service
   */
  private async buildGraph(): Promise<{
    statistics: GraphStats;
    nodes: GraphNode[];
    edges: GraphEdge[];
    transactions: GraphTransaction[];
  }> {
    console.log(chalk.blue('🔧 Building transaction graph...'));

    // Get dynasty history
    const dynastyChain = await historicalLeagueService.getLeagueHistory(this.options.leagueId);
    
    // Filter leagues if season specified
    let filteredLeagues = dynastyChain.leagues;
    if (this.options.season) {
      filteredLeagues = filteredLeagues.filter(l => l.season === this.options.season);
    }

    // Build the graph
    const transactionGraph = await transactionChainService.buildTransactionGraph(filteredLeagues);

    // Convert to the format expected by this visualizer
    const nodes: GraphNode[] = Array.from(transactionGraph.nodes.entries()).map(([, node]) => ({
      ...node
    }));

    const edges: GraphEdge[] = Array.from(transactionGraph.edges.entries()).map(([assetId, transactionIds]) => ({
      assetId,
      transactionIds
    }));

    const transactions: GraphTransaction[] = Array.from(transactionGraph.chains.entries()).map(([, transaction]) => ({
      ...transaction
    }));

    // Apply additional filtering
    let filteredTransactions = transactions;
    let filteredNodes = nodes;
    let filteredEdges = edges;

    if (this.options.transactionType) {
      filteredTransactions = transactions.filter(t => t.type === this.options.transactionType);
    }

    if (this.options.managerId) {
      filteredTransactions = filteredTransactions.filter(t => 
        t.managerFrom?.id === this.options.managerId || t.managerTo?.id === this.options.managerId
      );
    }

    // Calculate statistics
    const statistics: GraphStats = {
      buildTimeMs: 0, // Will be calculated externally
      totalNodes: filteredNodes.length,
      totalEdges: filteredEdges.reduce((sum, edge) => sum + edge.transactionIds.length, 0),
      totalTransactions: filteredTransactions.length,
      transactionTypes: {},
      assetTypes: { player: 0, draft_pick: 0 },
      seasonsSpanned: new Set(filteredTransactions.map(t => t.season)).size,
      managersInvolved: new Set([
        ...filteredTransactions.map(t => t.managerFrom?.id).filter(Boolean),
        ...filteredTransactions.map(t => t.managerTo?.id).filter(Boolean)
      ]).size,
      avgTransactionsPerAsset: 0,
      maxTransactionsPerAsset: 0
    };

    // Calculate transaction types
    for (const transaction of filteredTransactions) {
      statistics.transactionTypes[transaction.type] = (statistics.transactionTypes[transaction.type] || 0) + 1;
    }

    // Calculate asset types
    for (const node of filteredNodes) {
      statistics.assetTypes[node.type] = (statistics.assetTypes[node.type] || 0) + 1;
    }

    // Calculate transaction frequency per asset
    let totalTransactionsAcrossAssets = 0;
    for (const edge of filteredEdges) {
      const assetTransactionCount = edge.transactionIds.length;
      totalTransactionsAcrossAssets += assetTransactionCount;
      statistics.maxTransactionsPerAsset = Math.max(statistics.maxTransactionsPerAsset, assetTransactionCount);
    }

    statistics.avgTransactionsPerAsset = filteredNodes.length > 0 ? 
      Math.round((totalTransactionsAcrossAssets / filteredNodes.length) * 100) / 100 : 0;

    return {
      statistics,
      nodes: filteredNodes,
      edges: filteredEdges,
      transactions: filteredTransactions
    };
  }

  /**
   * Render statistics view
   */
  private async renderStats(stats: GraphStats): Promise<void> {
    console.log(chalk.yellow('📈 GRAPH STATISTICS'));
    console.log(chalk.gray('-'.repeat(40)));
    
    console.log(`${chalk.cyan('Nodes:')} ${chalk.white(stats.totalNodes.toLocaleString())}`);
    console.log(`${chalk.cyan('Edges:')} ${chalk.white(stats.totalEdges.toLocaleString())}`);
    console.log(`${chalk.cyan('Transactions:')} ${chalk.white(stats.totalTransactions.toLocaleString())}`);
    console.log(`${chalk.cyan('Seasons:')} ${chalk.white(stats.seasonsSpanned)}`);
    console.log(`${chalk.cyan('Managers:')} ${chalk.white(stats.managersInvolved)}`);
    
    console.log('\n' + chalk.yellow('📊 Asset Types:'));
    for (const [type, count] of Object.entries(stats.assetTypes)) {
      const percentage = ((count / stats.totalNodes) * 100).toFixed(1);
      console.log(`  ${chalk.cyan(type + ':')} ${chalk.white(count.toLocaleString())} (${percentage}%)`);
    }

    console.log('\n' + chalk.yellow('🔄 Transaction Types:'));
    for (const [type, count] of Object.entries(stats.transactionTypes)) {
      const percentage = ((count / stats.totalTransactions) * 100).toFixed(1);
      console.log(`  ${chalk.cyan(type + ':')} ${chalk.white(count.toLocaleString())} (${percentage}%)`);
    }

    console.log('\n' + chalk.yellow('📊 Transaction Frequency:'));
    console.log(`  ${chalk.cyan('Average per asset:')} ${chalk.white(stats.avgTransactionsPerAsset)}`);
    console.log(`  ${chalk.cyan('Maximum per asset:')} ${chalk.white(stats.maxTransactionsPerAsset)}`);
  }

  /**
   * Render summary view with key insights
   */
  private async renderSummary(graphData: {
    statistics: GraphStats;
    nodes: GraphNode[];
    edges: GraphEdge[];
    transactions: GraphTransaction[];
  }): Promise<void> {
    console.log(chalk.yellow('📋 GRAPH SUMMARY'));
    console.log(chalk.gray('-'.repeat(40)));

    await this.renderStats(graphData.statistics);

    console.log('\n' + chalk.yellow('🔍 Key Insights:'));

    // Find most traded asset
    const mostTradedAsset = this.findMostTradedAsset(graphData.edges, graphData.nodes);
    if (mostTradedAsset) {
      console.log(`  ${chalk.cyan('Most traded asset:')} ${chalk.white(mostTradedAsset.name)} (${mostTradedAsset.transactionCount} transactions)`);
    }

    // Find most active manager
    const mostActiveManager = this.findMostActiveManager(graphData.transactions);
    if (mostActiveManager) {
      console.log(`  ${chalk.cyan('Most active manager:')} ${chalk.white(mostActiveManager.displayName || mostActiveManager.username)} (${mostActiveManager.transactionCount} transactions)`);
    }

    // Find biggest trade (by asset count)
    const biggestTrade = this.findBiggestTrade(graphData.transactions);
    if (biggestTrade) {
      const totalAssets = biggestTrade.assetsGiven.length + biggestTrade.assetsReceived.length;
      console.log(`  ${chalk.cyan('Biggest trade:')} ${chalk.white(totalAssets)} assets in ${biggestTrade.season} Week ${biggestTrade.week || 'N/A'}`);
    }

    // Show recent activity
    const recentTransactions = this.getRecentTransactions(graphData.transactions, 5);
    if (recentTransactions.length > 0) {
      console.log('\n' + chalk.yellow('🕒 Recent Activity:'));
      for (const tx of recentTransactions) {
        const date = new Date(Number(tx.timestamp)).toLocaleDateString();
        const fromManager = tx.managerFrom?.displayName || tx.managerFrom?.username || 'Unknown';
        const toManager = tx.managerTo?.displayName || tx.managerTo?.username || 'Unknown';
        console.log(`  ${chalk.gray(date)} ${chalk.cyan(tx.type)} ${chalk.white(fromManager)} → ${chalk.white(toManager)}`);
      }
    }
  }

  /**
   * Render detailed view with visual representation
   */
  private async renderDetailed(graphData: {
    statistics: GraphStats;
    nodes: GraphNode[];
    edges: GraphEdge[];
    transactions: GraphTransaction[];
  }): Promise<void> {
    console.log(chalk.yellow('🔍 DETAILED GRAPH VIEW'));
    console.log(chalk.gray('-'.repeat(40)));

    await this.renderSummary(graphData);

    // Show transaction network
    console.log('\n' + chalk.yellow('🕸️  Transaction Network:'));
    
    const limit = this.options.limit || 20;
    const limitedTransactions = graphData.transactions
      .sort((a, b) => Number(b.timestamp) - Number(a.timestamp))
      .slice(0, limit);

    for (const tx of limitedTransactions) {
      const date = new Date(Number(tx.timestamp)).toLocaleDateString();
      const fromManager = tx.managerFrom?.displayName || tx.managerFrom?.username || 'Unknown';
      const toManager = tx.managerTo?.displayName || tx.managerTo?.username || 'Unknown';
      
      console.log(`\n${chalk.cyan('┌─')} ${chalk.yellow(tx.type.toUpperCase())} ${chalk.gray(`(${date})`)}`);
      console.log(`${chalk.cyan('├─')} ${chalk.white(fromManager)} ${chalk.gray('→')} ${chalk.white(toManager)}`);
      
      if (tx.assetsGiven.length > 0) {
        console.log(`${chalk.cyan('├─')} ${chalk.red('Gave:')} ${tx.assetsGiven.map(a => a.name).join(', ')}`);
      }
      
      if (tx.assetsReceived.length > 0) {
        console.log(`${chalk.cyan('└─')} ${chalk.green('Got:')} ${tx.assetsReceived.map(a => a.name).join(', ')}`);
      }
    }

    if (graphData.transactions.length > limit) {
      console.log(chalk.gray(`\n... and ${graphData.transactions.length - limit} more transactions`));
    }
  }

  /**
   * Export graph data
   */
  private async exportGraph(graphData: any): Promise<void> {
    const filename = `transaction-graph-${this.options.leagueId}-${Date.now()}`;
    
    if (this.options.outputFormat === 'json') {
      const fs = await import('fs');
      const filepath = `${filename}.json`;
      fs.writeFileSync(filepath, JSON.stringify(graphData, null, 2));
      console.log(chalk.green(`📁 Exported JSON to: ${filepath}`));
    } else if (this.options.outputFormat === 'dot') {
      const dotContent = this.generateDotFormat(graphData);
      const fs = await import('fs');
      const filepath = `${filename}.dot`;
      fs.writeFileSync(filepath, dotContent);
      console.log(chalk.green(`📁 Exported DOT format to: ${filepath}`));
      console.log(chalk.gray('   Use: dot -Tpng graph.dot -o graph.png'));
    }
  }

  /**
   * Generate DOT format for Graphviz
   */
  private generateDotFormat(graphData: {
    nodes: GraphNode[];
    edges: GraphEdge[];
    transactions: GraphTransaction[];
  }): string {
    let dot = 'digraph TransactionGraph {\n';
    dot += '  rankdir=TB;\n';
    dot += '  node [shape=box];\n\n';

    // Add nodes
    for (const node of graphData.nodes) {
      const label = node.name || `${node.type}-${node.id}`;
      const color = node.type === 'player' ? 'lightblue' : 'lightgreen';
      dot += `  "${node.id}" [label="${label}" fillcolor="${color}" style=filled];\n`;
    }

    dot += '\n';

    // Add edges (simplified - showing direct transaction relationships)
    for (const edge of graphData.edges) {
      for (const txId of edge.transactionIds) {
        const tx = graphData.transactions.find(t => t.id === txId);
        if (tx) {
          // Show relationships between assets in the same transaction
          for (const given of tx.assetsGiven) {
            for (const received of tx.assetsReceived) {
              dot += `  "${given.id}" -> "${received.id}" [label="${tx.type}"];\n`;
            }
          }
        }
      }
    }

    dot += '}\n';
    return dot;
  }

  /**
   * Helper methods for analysis
   */
  private findMostTradedAsset(edges: GraphEdge[], nodes: GraphNode[]): { name: string; transactionCount: number } | null {
    if (edges.length === 0) return null;
    
    const mostTradedEdge = edges.reduce((max, edge) => 
      edge.transactionIds.length > max.transactionIds.length ? edge : max
    );
    
    const asset = nodes.find(n => n.id === mostTradedEdge.assetId);
    return asset ? {
      name: asset.name || `${asset.type}-${asset.id}`,
      transactionCount: mostTradedEdge.transactionIds.length
    } : null;
  }

  private findMostActiveManager(transactions: GraphTransaction[]): { username: string; displayName?: string; transactionCount: number } | null {
    const managerCounts = new Map<string, { manager: any; count: number }>();
    
    for (const tx of transactions) {
      if (tx.managerFrom) {
        const key = tx.managerFrom.id;
        const existing = managerCounts.get(key) || { manager: tx.managerFrom, count: 0 };
        managerCounts.set(key, { ...existing, count: existing.count + 1 });
      }
      if (tx.managerTo) {
        const key = tx.managerTo.id;
        const existing = managerCounts.get(key) || { manager: tx.managerTo, count: 0 };
        managerCounts.set(key, { ...existing, count: existing.count + 1 });
      }
    }

    if (managerCounts.size === 0) return null;

    const mostActive = Array.from(managerCounts.values()).reduce((max, current) =>
      current.count > max.count ? current : max
    );

    return {
      username: mostActive.manager.username,
      displayName: mostActive.manager.displayName,
      transactionCount: mostActive.count
    };
  }

  private findBiggestTrade(transactions: GraphTransaction[]): GraphTransaction | null {
    return transactions
      .filter(tx => tx.type === 'trade')
      .reduce((biggest, current) => {
        const currentSize = current.assetsGiven.length + current.assetsReceived.length;
        const biggestSize = biggest ? biggest.assetsGiven.length + biggest.assetsReceived.length : 0;
        return currentSize > biggestSize ? current : biggest;
      }, null as GraphTransaction | null);
  }

  private getRecentTransactions(transactions: GraphTransaction[], limit: number): GraphTransaction[] {
    return transactions
      .sort((a, b) => Number(b.timestamp) - Number(a.timestamp))
      .slice(0, limit);
  }
}

/**
 * CLI entry point
 */
async function runVisualization(options: Partial<GraphVisualizationOptions> = {}) {
  const defaultOptions: GraphVisualizationOptions = {
    leagueId: config.testLeagueId || '1191596293294166016',
    format: 'summary',
    outputFormat: 'console',
    limit: 20
  };

  const finalOptions = { ...defaultOptions, ...options };
  
  const visualizer = new TransactionGraphVisualizer(finalOptions);
  
  try {
    await visualizer.visualize();
  } catch (error) {
    console.error(chalk.red('❌ Visualization failed:'), error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// CLI handling
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Dynasty DNA Transaction Graph Visualizer');
    console.log('');
    console.log('Usage: npm run visualize:graph [options]');
    console.log('');
    console.log('Options:');
    console.log('  --league-id <id>      League ID to visualize (default: test league)');
    console.log('  --season <year>       Filter by season (e.g. 2023)');
    console.log('  --type <type>         Filter by transaction type (trade, draft, waiver, etc.)');
    console.log('  --manager <id>        Filter by manager ID');
    console.log('  --format <format>     Output format: stats, summary, detailed (default: summary)');
    console.log('  --output <format>     Export format: console, json, dot (default: console)');
    console.log('  --limit <number>      Limit detailed view transactions (default: 20)');
    console.log('  --help, -h            Show this help message');
    console.log('');
    console.log('Examples:');
    console.log('  npm run visualize:graph                              # Basic summary');
    console.log('  npm run visualize:graph -- --format detailed         # Detailed view');
    console.log('  npm run visualize:graph -- --season 2023             # 2023 season only');
    console.log('  npm run visualize:graph -- --type trade              # Trades only');
    console.log('  npm run visualize:graph -- --output json             # Export to JSON');
    process.exit(0);
  }

  // Parse CLI arguments
  const options: Partial<GraphVisualizationOptions> = {};
  
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--league-id':
        options.leagueId = args[++i];
        break;
      case '--season':
        options.season = args[++i];
        break;
      case '--type':
        options.transactionType = args[++i];
        break;
      case '--manager':
        options.managerId = args[++i];
        break;
      case '--format':
        options.format = args[++i] as 'stats' | 'summary' | 'detailed';
        break;
      case '--output':
        options.outputFormat = args[++i] as 'console' | 'json' | 'dot';
        break;
      case '--limit':
        options.limit = parseInt(args[++i]);
        break;
    }
  }

  runVisualization(options).catch((error) => {
    console.error('Visualization failed:', error);
    process.exit(1);
  });
}

export { TransactionGraphVisualizer, runVisualization };