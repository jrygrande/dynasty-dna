import { PrismaClient } from '@prisma/client';
import { historicalLeagueService } from './historicalLeagueService';

const prisma = new PrismaClient();

export interface AssetNode {
  id: string;
  type: 'player' | 'draft_pick';
  sleeperId?: string; // For players
  season?: string; // For draft picks
  round?: number; // For draft picks
  originalOwnerId?: string;
  currentOwnerId?: string;
  name?: string;
  position?: string;
  team?: string;
  pickNumber?: number;
  playerSelectedId?: string;
}

export interface TransactionNode {
  id: string;
  sleeperTransactionId: string;
  type: string; // trade, waiver, free_agent
  status: string;
  week?: number;
  season: string;
  leagueName: string;
  timestamp: string; // Changed from bigint to string for JSON serialization
  creator?: string;
  description: string;
  assetsReceived: AssetNode[];
  assetsGiven: AssetNode[];
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
  assetOrigins?: AssetOrigin[]; // NEW: Origins of assets involved in this transaction
}

export interface AssetOrigin {
  asset: AssetNode;
  originChain: TransactionNode[]; // The trading history of this asset
}

export interface TransactionChain {
  rootAsset: AssetNode;
  totalTransactions: number;
  seasonsSpanned: number;
  currentOwner: {
    id: string;
    username: string;
    displayName?: string;
  } | null;
  originalOwner: {
    id: string;
    username: string;
    displayName?: string;
  } | null;
  transactionPath: TransactionNode[];
  derivedAssets: TransactionChain[]; // Assets received in trades for this asset
}

export interface TransactionGraph {
  nodes: Map<string, AssetNode>;
  edges: Map<string, string[]>; // assetId -> transaction IDs involving it
  chains: Map<string, TransactionNode>; // transactionId -> transaction details
}

export class TransactionChainService {
  /**
   * Build complete transaction chain for an asset (player or draft pick)
   */
  async buildTransactionChain(
    assetId: string,
    assetType: 'player' | 'draft_pick',
    startLeagueId: string
  ): Promise<TransactionChain> {
    console.log(`🔗 Building transaction chain for ${assetType}: ${assetId}`);
    
    // Get dynasty history to work across all seasons
    const dynastyChain = await historicalLeagueService.getLeagueHistory(startLeagueId);
    
    // Get root asset info
    const rootAsset = await this.getAssetNode(assetId, assetType);
    
    // Build transaction graph across all seasons
    const graph = await this.buildTransactionGraph(dynastyChain.leagues, rootAsset);
    
    // Trace the path for this specific asset (with simple origin enhancement)
    const chain = await this.traceAssetPath(rootAsset, graph);
    
    return chain;
  }

  /**
   * Get transaction chains for all assets acquired by a manager
   */
  async getManagerAcquisitionChains(
    managerId: string,
    leagueId: string
  ): Promise<{
    manager: any;
    currentRoster: AssetNode[];
    acquisitionChains: TransactionChain[];
  }> {
    // Get manager info
    const manager = await prisma.manager.findUnique({
      where: { id: managerId }
    });

    if (!manager) {
      throw new Error(`Manager not found: ${managerId}`);
    }

    // Get current roster
    const internalLeague = await prisma.league.findUnique({
      where: { sleeperLeagueId: leagueId }
    });

    if (!internalLeague) {
      throw new Error(`League not found: ${leagueId}`);
    }

    const roster = await prisma.roster.findFirst({
      where: {
        managerId: manager.id,
        leagueId: internalLeague.id,
        week: null // Current season roster
      },
      include: {
        slots: {
          include: {
            player: true
          }
        }
      }
    });

    if (!roster) {
      throw new Error(`Roster not found for manager in league`);
    }

    // Build chains for each asset
    const acquisitionChains: TransactionChain[] = [];
    const currentRoster: AssetNode[] = [];

    for (const slot of roster.slots) {
      const playerAsset: AssetNode = {
        id: slot.player.id,
        type: 'player',
        sleeperId: slot.player.sleeperId,
        name: slot.player.fullName || 'Unknown Player',
        position: slot.player.position,
        team: slot.player.team
      };

      currentRoster.push(playerAsset);

      try {
        const chain = await this.buildTransactionChain(slot.player.id, 'player', leagueId);
        acquisitionChains.push(chain);
      } catch (error) {
        console.warn(`Failed to build chain for player ${slot.player.fullName}:`, error);
      }
    }

    return {
      manager: {
        id: manager.id,
        username: manager.username,
        displayName: manager.displayName
      },
      currentRoster,
      acquisitionChains
    };
  }

  /**
   * Find all trade trees stemming from a draft pick
   */
  async getDraftPickTradeTree(
    season: string,
    round: number,
    originalOwnerId: string,
    leagueId: string
  ): Promise<TransactionChain> {
    // Find the draft pick
    const internalLeague = await prisma.league.findUnique({
      where: { sleeperLeagueId: leagueId }
    });

    if (!internalLeague) {
      throw new Error(`League not found: ${leagueId}`);
    }

    const draftPick = await prisma.draftPick.findFirst({
      where: {
        leagueId: internalLeague.id,
        season,
        round,
        originalOwnerId
      }
    });

    if (!draftPick) {
      throw new Error(`Draft pick not found: ${season} Round ${round} by ${originalOwnerId}`);
    }

    return this.buildTransactionChain(draftPick.id, 'draft_pick', leagueId);
  }

  /**
   * Trace complete asset genealogy including origins of traded assets
   */
  private async traceCompleteAssetGenealogy(
    rootAsset: AssetNode,
    graph: TransactionGraph,
    visitedAssets: Set<string> = new Set(),
    depth: number = 0,
    maxDepth: number = 20
  ): Promise<TransactionChain> {
    // Prevent infinite recursion
    if (visitedAssets.has(rootAsset.id)) {
      console.warn(`Circular reference detected for asset ${rootAsset.id} (${rootAsset.name}). Stopping trace.`);
      return {
        rootAsset,
        totalTransactions: 0,
        seasonsSpanned: 0,
        currentOwner: null,
        originalOwner: null,
        transactionPath: [],
        derivedAssets: []
      };
    }

    if (depth > maxDepth) {
      console.warn(`Maximum recursion depth (${maxDepth}) exceeded for asset ${rootAsset.id}. Stopping trace.`);
      return {
        rootAsset,
        totalTransactions: 0,
        seasonsSpanned: 0,
        currentOwner: null,
        originalOwner: null,
        transactionPath: [],
        derivedAssets: []
      };
    }

    visitedAssets.add(rootAsset.id);

    const transactionPath: TransactionNode[] = [];
    const derivedAssets: TransactionChain[] = [];
    let currentOwner = null;
    let originalOwner = null;

    // Get transactions where this asset appears
    const assetEdges = graph.edges.get(rootAsset.id) || [];
    
    // Sort by timestamp to get chronological order
    const sortedTransactions = assetEdges
      .map(transactionId => graph.chains.get(transactionId))
      .filter(Boolean)
      .sort((a, b) => parseInt(a!.timestamp) - parseInt(b!.timestamp));

    for (const transaction of sortedTransactions) {
      if (!transaction) continue;

      // For each transaction, check if we need to trace back asset origins
      const enhancedTransaction = await this.enhanceTransactionWithAssetOrigins(
        transaction, 
        graph, 
        rootAsset,
        visitedAssets,
        depth
      );

      // Add the enhanced transaction to path
      transactionPath.push(enhancedTransaction);

      // Track ownership
      if (enhancedTransaction.managerTo) {
        currentOwner = enhancedTransaction.managerTo;
      }
      if (!originalOwner && enhancedTransaction.managerFrom) {
        originalOwner = enhancedTransaction.managerFrom;
      }
    }

    visitedAssets.delete(rootAsset.id);

    const seasonsSpanned = new Set(transactionPath.map(t => t.season)).size;

    return {
      rootAsset,
      totalTransactions: transactionPath.length,
      seasonsSpanned,
      currentOwner,
      originalOwner,
      transactionPath,
      derivedAssets
    };
  }

  /**
   * Enhance transaction with origins of assets involved (recursive tracing)
   */
  private async enhanceTransactionWithAssetOrigins(
    transaction: TransactionNode,
    graph: TransactionGraph,
    rootAsset: AssetNode,
    visitedAssets: Set<string>,
    currentDepth: number
  ): Promise<TransactionNode> {
    // Create enhanced transaction with potential asset origin chains
    const enhancedTransaction = { ...transaction };
    
    // For draft transactions, trace back the draft pick's trading history
    if (transaction.type === 'draft') {
      const draftPicksGiven = transaction.assetsGiven.filter(asset => asset.type === 'draft_pick');
      
      for (const draftPick of draftPicksGiven) {
        if (!visitedAssets.has(draftPick.id)) {
          try {
            // Recursively trace this draft pick's history
            const pickChain = await this.traceCompleteAssetGenealogy(
              draftPick,
              graph,
              new Set(visitedAssets), // Copy visited set to avoid interference
              currentDepth + 1
            );
            
            // If the pick has a trading history, prepend those transactions
            if (pickChain.transactionPath.length > 0) {
              // Add pick's history as "background" transactions
              enhancedTransaction.assetOrigins = enhancedTransaction.assetOrigins || [];
              enhancedTransaction.assetOrigins.push({
                asset: draftPick,
                originChain: pickChain.transactionPath
              });
            }
          } catch (error) {
            console.warn(`Failed to trace draft pick origin ${draftPick.id}:`, error);
          }
        }
      }
    }

    // For trade transactions, check if any assets involved have interesting origins
    if (transaction.type === 'trade') {
      const allAssets = [...transaction.assetsReceived, ...transaction.assetsGiven];
      
      for (const asset of allAssets) {
        if (asset.id !== rootAsset.id && asset.type === 'draft_pick' && !visitedAssets.has(asset.id)) {
          try {
            // Trace draft pick origins in trades too
            const pickChain = await this.traceCompleteAssetGenealogy(
              asset,
              graph,
              new Set(visitedAssets),
              currentDepth + 1
            );
            
            if (pickChain.transactionPath.length > 0) {
              enhancedTransaction.assetOrigins = enhancedTransaction.assetOrigins || [];
              enhancedTransaction.assetOrigins.push({
                asset,
                originChain: pickChain.transactionPath
              });
            }
          } catch (error) {
            console.warn(`Failed to trace asset origin ${asset.id}:`, error);
          }
        }
      }
    }

    return enhancedTransaction;
  }

  /**
   * Add simple draft pick origins to a transaction (non-recursive)
   */
  private async addSimpleDraftPickOrigins(
    transaction: TransactionNode,
    graph: TransactionGraph
  ): Promise<TransactionNode> {
    // Only process draft transactions
    if (transaction.type !== 'draft') {
      return transaction;
    }

    const enhancedTransaction = { ...transaction };
    
    // Look for draft picks in assetsGiven (picks that were "spent")
    const draftPicks = transaction.assetsGiven.filter(asset => asset.type === 'draft_pick');
    
    if (draftPicks.length > 0) {
      enhancedTransaction.assetOrigins = [];
      
      for (const draftPick of draftPicks) {
        // Method 1: Try exact ID match first
        const pickTransactionIds = graph.edges.get(draftPick.id) || [];
        
        let pickTransactions = pickTransactionIds
          .map(id => graph.chains.get(id))
          .filter(Boolean)
          .filter(t => t!.type === 'trade' && t!.id !== transaction.id) // Only trades, not this draft
          .sort((a, b) => Number(BigInt(b!.timestamp) - BigInt(a!.timestamp))); // Most recent first
        
        // Method 2: If no exact matches, find trades with logically equivalent picks
        if (pickTransactions.length === 0) {
          // Find all trades involving picks of same season/round/original owner
          const equivalentTrades: TransactionNode[] = [];
          
          for (const [assetId, asset] of graph.nodes) {
            if (asset.type === 'draft_pick' && 
                asset.season === draftPick.season && 
                asset.round === draftPick.round &&
                asset.originalOwnerId === draftPick.originalOwnerId) {
              
              const equivalentPickTxIds = graph.edges.get(assetId) || [];
              const equivalentPickTxs = equivalentPickTxIds
                .map(id => graph.chains.get(id))
                .filter(Boolean)
                .filter(t => t!.type === 'trade' && t!.id !== transaction.id);
              
              equivalentTrades.push(...equivalentPickTxs as TransactionNode[]);
            }
          }
          
          pickTransactions = equivalentTrades
            .sort((a, b) => Number(BigInt(b.timestamp) - BigInt(a.timestamp))); // Most recent first
        }
        
        if (pickTransactions.length > 0) {
          const mostRecentTrade = pickTransactions[0]!;
          enhancedTransaction.assetOrigins.push({
            asset: draftPick,
            originChain: [mostRecentTrade] // Just show the most recent trade, not full history
          });
        }
      }
    }

    return enhancedTransaction;
  }

  /**
   * Build transaction graph from dynasty history
   */
  private async buildTransactionGraph(
    leagues: any[],
    focusAsset?: AssetNode
  ): Promise<TransactionGraph> {
    const graph: TransactionGraph = {
      nodes: new Map(),
      edges: new Map(),
      chains: new Map()
    };

    // Process each league in dynasty
    for (const league of leagues) {      
      if (!league.inDatabase) {
        continue;
      }

      const internalLeague = await prisma.league.findUnique({
        where: { sleeperLeagueId: league.sleeperLeagueId }
      });

      if (!internalLeague) {
        continue;
      }

      // Get all transactions for this league
      const transactions = await prisma.transaction.findMany({
        where: { leagueId: internalLeague.id },
        include: {
          items: {
            include: {
              player: true,
              manager: true,
              draftPick: {
                include: {
                  playerSelected: true,
                  originalOwner: true,
                  currentOwner: true
                }
              }
            }
          }
        },
        orderBy: { timestamp: 'asc' }
      });

      // Process each transaction
      for (const transaction of transactions) {
        const transactionNode = await this.buildTransactionNode(
          transaction,
          internalLeague.name,
          league.season,
          focusAsset
        );


        // Add all assets involved to the graph
        [...transactionNode.assetsReceived, ...transactionNode.assetsGiven].forEach(asset => {
          graph.nodes.set(asset.id, asset);
          
          if (!graph.edges.has(asset.id)) {
            graph.edges.set(asset.id, []);
          }
          graph.edges.get(asset.id)!.push(transactionNode.id);
        });

        // Store transaction details
        graph.chains.set(transactionNode.id, transactionNode);
      }
    }

    return graph;
  }

  /**
   * Trace the complete path for a specific asset
   */
  private async traceAssetPath(
    rootAsset: AssetNode,
    graph: TransactionGraph,
    visitedAssets: Set<string> = new Set(),
    depth: number = 0,
    maxDepth: number = 20
  ): Promise<TransactionChain> {
    // Prevent infinite recursion from circular references
    if (visitedAssets.has(rootAsset.id)) {
      console.warn(`Circular reference detected for asset ${rootAsset.id} (${rootAsset.name}). Stopping trace.`);
      return {
        rootAsset,
        totalTransactions: 0,
        seasonsSpanned: 0,
        currentOwner: null,
        originalOwner: null,
        transactionPath: [],
        derivedAssets: []
      };
    }

    // Safety check for maximum recursion depth
    if (depth > maxDepth) {
      console.warn(`Maximum recursion depth (${maxDepth}) exceeded for asset ${rootAsset.id}. Stopping trace.`);
      return {
        rootAsset,
        totalTransactions: 0,
        seasonsSpanned: 0,
        currentOwner: null,
        originalOwner: null,
        transactionPath: [],
        derivedAssets: []
      };
    }

    // Add this asset to the visited set
    visitedAssets.add(rootAsset.id);

    const visitedTransactions = new Set<string>();
    const transactionPath: TransactionNode[] = [];
    const derivedAssets: TransactionChain[] = [];

    // Get transactions involving this asset
    const assetTransactionIds = graph.edges.get(rootAsset.id) || [];
    const assetTransactions = assetTransactionIds
      .map(id => graph.chains.get(id))
      .filter(Boolean) as TransactionNode[];

    // Sort by timestamp
    assetTransactions.sort((a, b) => {
      const timeA = BigInt(a.timestamp);
      const timeB = BigInt(b.timestamp);
      return Number(timeA - timeB);
    });

    let currentOwner = null;
    let originalOwner = null;

    // Trace through each transaction
    for (const transaction of assetTransactions) {
      if (visitedTransactions.has(transaction.id)) continue;
      visitedTransactions.add(transaction.id);

      // Enhance transaction with draft pick origins if it's a draft
      const enhancedTransaction = await this.addSimpleDraftPickOrigins(transaction, graph);
      transactionPath.push(enhancedTransaction);

      // Track ownership changes
      if (!originalOwner && transaction.managerFrom) {
        originalOwner = transaction.managerFrom;
      }

      if (transaction.managerTo) {
        currentOwner = transaction.managerTo;
      }

      // For each asset received in this trade, recursively build its chain
      for (const receivedAsset of transaction.assetsReceived) {
        if (receivedAsset.id !== rootAsset.id) {
          try {
            const derivedChain = await this.traceAssetPath(
              receivedAsset, 
              graph, 
              visitedAssets,
              depth + 1,
              maxDepth
            );
            derivedAssets.push(derivedChain);
          } catch (error) {
            console.warn(`Failed to trace derived asset ${receivedAsset.id}:`, error);
          }
        }
      }
    }

    // Remove this asset from visited set before returning (allow it to be processed in other branches)
    visitedAssets.delete(rootAsset.id);

    // Calculate metrics
    const seasonsSpanned = new Set(transactionPath.map(t => t.season)).size;

    return {
      rootAsset,
      totalTransactions: transactionPath.length,
      seasonsSpanned,
      currentOwner,
      originalOwner,
      transactionPath,
      derivedAssets
    };
  }

  /**
   * Build a transaction node from database transaction (context-aware)
   */
  private async buildTransactionNode(
    transaction: any,
    leagueName: string,
    season: string,
    rootAsset?: AssetNode
  ): Promise<TransactionNode> {
    const assetsReceived: AssetNode[] = [];
    const assetsGiven: AssetNode[] = [];
    let managerFrom = null;
    let managerTo = null;
    let perspectiveManager = null;
    let assetWasGiven = false;

    // First pass: find the perspective if we have a root asset
    if (rootAsset) {
      for (const item of transaction.items) {
        const asset = await this.buildAssetNodeFromItem(item);
        if (asset.id === rootAsset.id) {
          perspectiveManager = item.manager;
          assetWasGiven = (item.type === 'drop');
          break;
        }
      }
    }

    // Second pass: build assets from perspective
    if (perspectiveManager && rootAsset) {
      // Context-aware building - show from perspective of the root asset's owner
      for (const item of transaction.items) {
        const asset = await this.buildAssetNodeFromItem(item);
        
        if (item.manager.id === perspectiveManager.id) {
          // This is the perspective manager's side
          if (item.type === 'add') {
            assetsReceived.push(asset);
            if (!managerTo) {
              managerTo = {
                id: item.manager.id,
                username: item.manager.username,
                displayName: item.manager.displayName
              };
            }
          } else if (item.type === 'drop') {
            assetsGiven.push(asset);
            if (!managerFrom) {
              managerFrom = {
                id: item.manager.id,
                username: item.manager.username,
                displayName: item.manager.displayName
              };
            }
          }
        } else {
          // This is the other side of the trade
          if (item.type === 'add') {
            // Other manager received this, so perspective manager gave it
            assetsGiven.push(asset);
            if (!managerFrom) {
              managerFrom = {
                id: perspectiveManager.id,
                username: perspectiveManager.username,
                displayName: perspectiveManager.displayName
              };
            }
          } else if (item.type === 'drop') {
            // Other manager gave this, so perspective manager received it
            assetsReceived.push(asset);
            if (!managerTo) {
              managerTo = {
                id: perspectiveManager.id,
                username: perspectiveManager.username,
                displayName: perspectiveManager.displayName
              };
            }
          }
        }
      }
    } else {
      // Fallback to old behavior if no context
      for (const item of transaction.items) {
        const asset = await this.buildAssetNodeFromItem(item);
        
        if (item.type === 'add') {
          assetsReceived.push(asset);
          if (item.manager && !managerTo) {
            managerTo = {
              id: item.manager.id,
              username: item.manager.username,
              displayName: item.manager.displayName
            };
          }
        } else if (item.type === 'drop') {
          assetsGiven.push(asset);
          if (item.manager && !managerFrom) {
            managerFrom = {
              id: item.manager.id,
              username: item.manager.username,
              displayName: item.manager.displayName
            };
          }
        }
      }
    }

    // Build description
    let description = `${transaction.type} transaction`;
    if (managerFrom && managerTo) {
      description = `Trade between ${managerFrom.displayName || managerFrom.username} and ${managerTo.displayName || managerTo.username}`;
    } else if (managerTo) {
      description = `${transaction.type} by ${managerTo.displayName || managerTo.username}`;
    }

    return {
      id: transaction.id,
      sleeperTransactionId: transaction.sleeperTransactionId,
      type: transaction.type,
      status: transaction.status,
      week: transaction.week,
      season,
      leagueName,
      timestamp: this.safeBigIntToString(transaction.timestamp), // Convert BigInt to string
      creator: transaction.creator,
      description,
      assetsReceived,
      assetsGiven,
      managerFrom,
      managerTo
    };
  }

  /**
   * Build asset node from transaction item
   */
  private async buildAssetNodeFromItem(item: any): Promise<AssetNode> {
    if (item.player) {
      return {
        id: item.player.id,
        type: 'player',
        sleeperId: item.player.sleeperId,
        name: item.player.fullName || 'Unknown Player',
        position: item.player.position,
        team: item.player.team
      };
    } else if (item.draftPick) {
      return {
        id: item.draftPick.id,
        type: 'draft_pick',
        season: item.draftPick.season,
        round: item.draftPick.round,
        originalOwnerId: item.draftPick.originalOwnerId,
        currentOwnerId: item.draftPick.currentOwnerId,
        pickNumber: item.draftPick.pickNumber,
        playerSelectedId: item.draftPick.playerSelectedId,
        name: item.draftPick.playerSelected?.fullName || 
              `${item.draftPick.season} Round ${item.draftPick.round} Pick`
      };
    }

    throw new Error(`Unknown asset type in transaction item: ${item.id}`);
  }

  /**
   * Get asset node by ID and type
   */
  private async getAssetNode(assetId: string, assetType: 'player' | 'draft_pick'): Promise<AssetNode> {
    if (assetType === 'player') {
      const player = await prisma.player.findUnique({
        where: { id: assetId }
      });

      if (!player) {
        throw new Error(`Player not found: ${assetId}`);
      }

      return {
        id: player.id,
        type: 'player',
        sleeperId: player.sleeperId,
        name: player.fullName || 'Unknown Player',
        position: player.position,
        team: player.team
      };
    } else {
      const draftPick = await prisma.draftPick.findUnique({
        where: { id: assetId },
        include: {
          playerSelected: true
        }
      });

      if (!draftPick) {
        throw new Error(`Draft pick not found: ${assetId}`);
      }

      return {
        id: draftPick.id,
        type: 'draft_pick',
        season: draftPick.season,
        round: draftPick.round,
        originalOwnerId: draftPick.originalOwnerId,
        currentOwnerId: draftPick.currentOwnerId,
        pickNumber: draftPick.pickNumber,
        playerSelectedId: draftPick.playerSelectedId,
        name: draftPick.playerSelected?.fullName || 
              `${draftPick.season} Round ${draftPick.round} Pick`
      };
    }
  }

  /**
   * Safely convert BigInt to string for JSON serialization
   */
  private safeBigIntToString(value: any): string {
    if (typeof value === 'bigint') {
      return value.toString();
    }
    return String(value);
  }

  /**
   * Clean up resources
   */
  async disconnect(): Promise<void> {
    await prisma.$disconnect();
  }
}

// Export singleton instance
export const transactionChainService = new TransactionChainService();