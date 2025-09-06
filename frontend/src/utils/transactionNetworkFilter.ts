import { TransactionGraph, AssetNode, TransactionNode } from '../types/api';

export interface PlayerNetworkResult {
  nodes: (AssetNode & { depth: number; importance?: number })[];
  transactions: TransactionNode[];
  stats: {
    depth: number;
    totalTransactions: number;
    totalAssets: number;
    transactionsByDepth: Record<number, number>;
    assetsByDepth: Record<number, number>;
  };
}

/**
 * Get player transactions with degrees of separation filtering
 * Uses breadth-first search to find connected transactions up to the specified depth
 */
export function getPlayerTransactions(
  graph: TransactionGraph,
  playerId: string,
  depth: number
): PlayerNetworkResult {
  if (depth < 1 || depth > 5) {
    throw new Error('Depth must be between 1 and 5');
  }

  const focalPlayer = graph.nodes.get(playerId);
  if (!focalPlayer || focalPlayer.type !== 'player') {
    throw new Error('Player not found in graph');
  }

  const includedNodes = new Set<string>([playerId]);
  const includedTransactions = new Set<string>();
  const nodesByDepth: Record<number, Set<string>> = { 0: new Set([playerId]) };
  const transactionsByDepth: Record<number, Set<string>> = {};

  // Initialize depth tracking
  for (let d = 1; d <= depth; d++) {
    nodesByDepth[d] = new Set();
    transactionsByDepth[d] = new Set();
  }

  // Breadth-first search for connected transactions
  for (let currentDepth = 1; currentDepth <= depth; currentDepth++) {
    const assetsFromPreviousDepth = nodesByDepth[currentDepth - 1];
    
    // Find transactions involving assets from previous depth
    for (const [transactionId, transaction] of graph.chains) {
      if (includedTransactions.has(transactionId)) continue;

      const involvedAssets = [...transaction.assetsReceived, ...transaction.assetsGiven];
      const hasConnectionToPreviousDepth = involvedAssets.some(asset => 
        assetsFromPreviousDepth.has(asset.id)
      );

      if (hasConnectionToPreviousDepth) {
        includedTransactions.add(transactionId);
        transactionsByDepth[currentDepth].add(transactionId);

        // Add all assets from this transaction to current depth
        involvedAssets.forEach(asset => {
          if (!includedNodes.has(asset.id)) {
            includedNodes.add(asset.id);
            nodesByDepth[currentDepth].add(asset.id);
          }
        });
      }
    }
  }

  // Collect transactions first
  const resultTransactions: TransactionNode[] = [];
  for (const transactionId of includedTransactions) {
    const transaction = graph.chains.get(transactionId);
    if (transaction) {
      resultTransactions.push(transaction);
    }
  }

  // Collect final results with depth information
  const resultNodes: (AssetNode & { depth: number; importance?: number })[] = [];
  for (const nodeId of includedNodes) {
    const node = graph.nodes.get(nodeId);
    if (node) {
      // Find the depth of this node
      let nodeDepth = 0;
      for (let d = 0; d <= depth; d++) {
        if (nodesByDepth[d]?.has(nodeId)) {
          nodeDepth = d;
          break;
        }
      }
      
      // Calculate importance
      const importance = calculateNodeImportance(nodeId, resultTransactions);
      
      resultNodes.push({
        ...node,
        depth: nodeDepth,
        importance
      });
    }
  }

  // Calculate stats
  const stats = {
    depth,
    totalTransactions: resultTransactions.length,
    totalAssets: resultNodes.length,
    transactionsByDepth: {} as Record<number, number>,
    assetsByDepth: {} as Record<number, number>
  };

  for (let d = 0; d <= depth; d++) {
    stats.assetsByDepth[d] = nodesByDepth[d]?.size || 0;
    stats.transactionsByDepth[d] = transactionsByDepth[d]?.size || 0;
  }

  return {
    nodes: resultNodes,
    transactions: resultTransactions,
    stats
  };
}

/**
 * Find a player by name in the transaction graph
 * Returns the first matching player or null if not found
 */
export function findPlayerByName(graph: TransactionGraph, playerName: string): AssetNode | null {
  for (const [, node] of graph.nodes) {
    if (node.type === 'player' && node.name?.toLowerCase().includes(playerName.toLowerCase())) {
      return node;
    }
  }
  return null;
}

/**
 * Get all unique player names from the graph for autocomplete
 */
export function getPlayerNames(graph: TransactionGraph): Array<{ id: string; name: string }> {
  const players: Array<{ id: string; name: string }> = [];
  
  for (const [, node] of graph.nodes) {
    if (node.type === 'player' && node.name) {
      players.push({
        id: node.id,
        name: node.name
      });
    }
  }

  // Sort alphabetically by name
  return players.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Calculate node importance for sizing in visualization
 * Based on number of transactions the asset is involved in
 */
export function calculateNodeImportance(
  nodeId: string, 
  transactions: TransactionNode[]
): number {
  const involvementCount = transactions.reduce((count, transaction) => {
    const isInvolved = [...transaction.assetsReceived, ...transaction.assetsGiven]
      .some(asset => asset.id === nodeId);
    return count + (isInvolved ? 1 : 0);
  }, 0);
  
  // Return a value between 0.5 and 2.0 for scaling node radius
  return Math.max(0.5, Math.min(2.0, involvementCount / 2));
}

/**
 * Assign depth colors for visualization
 */
export function getDepthColor(depth: number): string {
  // Color palette from lightest (highest depth) to darkest (depth 0 - focal player)
  const colors = [
    '#1e40af', // Blue-800 - Focal player (depth 0)
    '#3b82f6', // Blue-600 - Direct connections (depth 1)
    '#60a5fa', // Blue-400 - Second degree (depth 2)
    '#93c5fd', // Blue-300 - Third degree (depth 3)
    '#bfdbfe', // Blue-200 - Fourth degree (depth 4)
    '#dbeafe'  // Blue-100 - Fifth degree (depth 5)
  ];
  
  return colors[Math.min(depth, colors.length - 1)];
}