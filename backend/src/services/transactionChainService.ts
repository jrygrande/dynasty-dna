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
  edges: Map<string, TransactionNode[]>; // assetId -> transactions involving it
  chains: Map<string, TransactionChain>;
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
    
    // Trace the path for this specific asset
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
      if (!league.inDatabase) continue;

      const internalLeague = await prisma.league.findUnique({
        where: { sleeperLeagueId: league.sleeperLeagueId }
      });

      if (!internalLeague) continue;

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
          league.season
        );

        // Add all assets involved to the graph
        [...transactionNode.assetsReceived, ...transactionNode.assetsGiven].forEach(asset => {
          graph.nodes.set(asset.id, asset);
          
          if (!graph.edges.has(asset.id)) {
            graph.edges.set(asset.id, []);
          }
          graph.edges.get(asset.id)!.push(transactionNode);
        });
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
    const assetTransactions = graph.edges.get(rootAsset.id) || [];

    // Sort by timestamp (now strings, but convert back to BigInt for accurate comparison)
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

      transactionPath.push(transaction);

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
   * Build a transaction node from database transaction
   */
  private async buildTransactionNode(
    transaction: any,
    leagueName: string,
    season: string
  ): Promise<TransactionNode> {
    const assetsReceived: AssetNode[] = [];
    const assetsGiven: AssetNode[] = [];
    let managerFrom = null;
    let managerTo = null;

    // Process transaction items
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