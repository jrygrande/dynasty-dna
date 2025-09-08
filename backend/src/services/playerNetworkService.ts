import { PrismaClient } from '@prisma/client';
import { AssetNode, TransactionNode } from './transactionChainService';
import { historicalLeagueService } from './historicalLeagueService';

const prisma = new PrismaClient();

export interface PlayerNetworkNode extends AssetNode {
  depth: number;
  importance: number;
}

export interface PlayerNetworkConnection {
  fromAsset: string;
  toAsset: string;
  transactionId: string;
  depth: number;
}

export interface PlayerNetworkStats {
  totalNodes: number;
  totalTransactions: number;
  depthDistribution: Record<number, number>;
  transactionTypes: Record<string, number>;
  buildTimeMs: number;
}

export interface PlayerNetworkResponse {
  focalPlayer: AssetNode;
  network: {
    nodes: PlayerNetworkNode[];
    transactions: TransactionNode[];
    connections: PlayerNetworkConnection[];
  };
  stats: PlayerNetworkStats;
}

export class PlayerNetworkService {
  private prisma: PrismaClient;

  constructor(prismaInstance?: PrismaClient) {
    this.prisma = prismaInstance || prisma;
  }

  /**
   * Get player network starting from a focal player and expanding by degrees of separation
   */
  async getPlayerNetwork(
    playerId: string,
    leagueId: string,
    depth: number = 2,
    options: {
      season?: string;
      transactionType?: string;
      includeStats?: boolean;
    } = {}
  ): Promise<PlayerNetworkResponse> {
    const startTime = Date.now();
    
    console.log(`🔍 Building player network for player ${playerId} with depth ${depth} in league ${leagueId}`);

    // Get the focal player
    const focalPlayer = await this.getFocalPlayer(playerId);
    
    // Build the network using breadth-first search
    const networkData = await this.buildNetworkBFS(focalPlayer, leagueId, depth, options);
    
    const buildTime = Date.now() - startTime;

    // Calculate statistics
    const stats = this.calculateNetworkStats(networkData, buildTime);

    return {
      focalPlayer,
      network: networkData,
      stats
    };
  }

  /**
   * Get focal player information
   */
  private async getFocalPlayer(playerId: string): Promise<AssetNode> {
    const player = await this.prisma.player.findUnique({
      where: { id: playerId }
    });

    if (!player) {
      throw new Error(`Player not found: ${playerId}`);
    }

    return {
      id: player.id,
      type: 'player',
      sleeperId: player.sleeperId,
      name: player.fullName || 'Unknown Player',
      position: player.position || undefined,
      team: player.team || undefined
    };
  }

  /**
   * Build player network using breadth-first search
   */
  private async buildNetworkBFS(
    focalPlayer: AssetNode,
    leagueId: string,
    maxDepth: number,
    options: {
      season?: string;
      transactionType?: string;
    }
  ): Promise<{
    nodes: PlayerNetworkNode[];
    transactions: TransactionNode[];
    connections: PlayerNetworkConnection[];
  }> {
    const nodes = new Map<string, PlayerNetworkNode>();
    const transactions = new Map<string, TransactionNode>();
    const connections: PlayerNetworkConnection[] = [];
    const visitedAssets = new Set<string>();
    
    // Initialize with focal player at depth 0
    nodes.set(focalPlayer.id, {
      ...focalPlayer,
      depth: 0,
      importance: 1.0 // Highest importance for focal player
    });

    // Queue for BFS: [assetId, currentDepth]
    const queue: Array<[string, number]> = [[focalPlayer.id, 0]];

    while (queue.length > 0 && queue[0][1] <= maxDepth) {
      const [currentAssetId, currentDepth] = queue.shift()!;
      
      if (visitedAssets.has(currentAssetId) || currentDepth > maxDepth) {
        continue;
      }
      
      visitedAssets.add(currentAssetId);

      // Get transactions involving this asset
      const assetTransactions = await this.getAssetTransactions(currentAssetId, leagueId, options);
      
      for (const transaction of assetTransactions) {
        // Add transaction if not already included
        if (!transactions.has(transaction.id)) {
          transactions.set(transaction.id, transaction);
        }

        // Process all assets in this transaction
        const allAssets = [...transaction.assetsReceived, ...transaction.assetsGiven];
        
        for (const asset of allAssets) {
          if (asset.id !== currentAssetId && !visitedAssets.has(asset.id)) {
            const nextDepth = currentDepth + 1;
            
            // Add to nodes if within depth limit
            if (nextDepth <= maxDepth) {
              const importance = this.calculateAssetImportance(asset, nextDepth, maxDepth);
              
              nodes.set(asset.id, {
                ...asset,
                depth: nextDepth,
                importance
              });

              // Only add to queue for further exploration if we want deeper network traversal
              // For player timelines, we typically want depth=1 but without expanding to related asset transactions
              if (nextDepth < maxDepth) {
                queue.push([asset.id, nextDepth]);
              }

              // Create connection
              connections.push({
                fromAsset: currentAssetId,
                toAsset: asset.id,
                transactionId: transaction.id,
                depth: nextDepth
              });
            }
          }
        }
      }
    }

    return {
      nodes: Array.from(nodes.values()),
      transactions: Array.from(transactions.values()),
      connections
    };
  }

  /**
   * Get all transactions involving a specific asset across dynasty history
   */
  async getAssetTransactions(
    assetId: string,
    leagueId: string,
    options: {
      season?: string;
      transactionType?: string;
    }
  ): Promise<TransactionNode[]> {
    // Get dynasty history to work across all seasons
    const dynastyChain = await historicalLeagueService.getLeagueHistory(leagueId);
    
    const transactionNodes: TransactionNode[] = [];

    // Process each league in dynasty history
    for (const dynastyLeague of dynastyChain.leagues) {
      if (!dynastyLeague.inDatabase) {
        continue;
      }

      const internalLeague = await this.prisma.league.findUnique({
        where: { sleeperLeagueId: dynastyLeague.sleeperLeagueId }
      });

      if (!internalLeague) {
        continue;
      }

      // Skip if season filter doesn't match
      if (options.season && dynastyLeague.season !== options.season) {
        continue;
      }

      // Build WHERE conditions for this league
      const whereConditions: any = {
        leagueId: internalLeague.id,
        items: {
          some: {
            OR: [
              { playerId: assetId },
              { draftPickId: assetId }
              // Removed: { draftPick: { playerSelectedId: assetId } }
              // This was causing false positives by including transactions of draft picks
              // that would later select a player, even though those transactions happened
              // before the pick was used. Player timelines should only show direct involvement.
            ]
          }
        }
      };

      if (options.transactionType) {
        whereConditions.type = options.transactionType;
      }

      // Execute optimized query for this league
      const transactions = await this.prisma.transaction.findMany({
        where: whereConditions,
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

      // Convert to TransactionNode format
      for (const transaction of transactions) {
        const transactionNode = await this.buildTransactionNode(
          transaction,
          internalLeague.name,
          dynastyLeague.season
        );
        transactionNodes.push(transactionNode);
      }
    }

    // Sort all transactions by timestamp
    transactionNodes.sort((a, b) => parseInt(a.timestamp) - parseInt(b.timestamp));

    return transactionNodes;
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

    // For trades, we need to show the complete bilateral exchange
    if (transaction.type === 'trade') {
      // Group items by manager
      const itemsByManager = new Map<string, { adds: any[], drops: any[], manager: any }>();
      
      for (const item of transaction.items) {
        const managerId = item.manager.id;
        if (!itemsByManager.has(managerId)) {
          itemsByManager.set(managerId, { adds: [], drops: [], manager: item.manager });
        }
        
        if (item.type === 'add') {
          itemsByManager.get(managerId)!.adds.push(item);
        } else if (item.type === 'drop') {
          itemsByManager.get(managerId)!.drops.push(item);
        }
      }

      // Find the managers involved in the trade
      const managerEntries = Array.from(itemsByManager.entries());
      
      if (managerEntries.length >= 2) {
        // For the transaction view, we'll show what both managers traded
        // Manager 1's drops go to assetsGiven, Manager 2's drops go to assetsReceived
        const [manager1Id, manager1Data] = managerEntries[0];
        const [manager2Id, manager2Data] = managerEntries[1];
        
        // What manager1 gave away (their drops)
        for (const item of manager1Data.drops) {
          const asset = await this.buildAssetNodeFromItem(item);
          assetsGiven.push(asset);
        }
        
        // What manager2 gave away (their drops) = what manager1 received
        for (const item of manager2Data.drops) {
          const asset = await this.buildAssetNodeFromItem(item);
          assetsReceived.push(asset);
        }
        
        // Set the trading partners
        managerFrom = {
          id: manager1Data.manager.id,
          username: manager1Data.manager.username,
          displayName: manager1Data.manager.displayName
        };
        
        managerTo = {
          id: manager2Data.manager.id,
          username: manager2Data.manager.username,
          displayName: manager2Data.manager.displayName
        };
      }
    } else {
      // For non-trades, use the original logic
      for (const item of transaction.items) {
        const asset = await this.buildAssetNodeFromItem(item);
        
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
      }
    }

    // Build description
    let description = `${transaction.type} transaction`;
    if (transaction.type === 'draft') {
      if (managerTo) {
        description = `Draft selection by ${managerTo.displayName || managerTo.username}`;
      }
    } else if (managerFrom && managerTo && managerFrom.id !== managerTo.id) {
      description = `Trade between ${managerFrom.displayName || managerFrom.username} and ${managerTo.displayName || managerTo.username}`;
    } else if (managerTo) {
      description = `${transaction.type} by ${managerTo.displayName || managerTo.username}`;
    }

    // For trades, restructure to show participants and what they received
    let participants: Array<{ manager: any, assetsReceived: any[] }> = [];
    
    if (transaction.type === 'trade' && managerFrom && managerTo) {
      participants = [
        {
          manager: managerFrom,
          assetsReceived: assetsReceived // What manager1 received (manager2's drops)
        },
        {
          manager: managerTo,
          assetsReceived: assetsGiven // What manager2 received (manager1's drops)
        }
      ];
    }

    return {
      id: transaction.id,
      sleeperTransactionId: transaction.sleeperTransactionId,
      type: transaction.type,
      status: transaction.status,
      week: transaction.week,
      season,
      leagueName,
      timestamp: this.safeBigIntToString(transaction.timestamp),
      creator: transaction.creator,
      description,
      assetsReceived,
      assetsGiven,
      managerFrom: managerFrom || undefined,
      managerTo: managerTo || undefined,
      participants: participants.length > 0 ? participants : undefined
    };
  }

  /**
   * Find the correct draft selection for a draft pick, handling cross-dynasty year lookups
   */
  private async findCorrectDraftSelection(draftPick: any): Promise<{ playerSelectedId: string | null; playerSelectedName: string | null }> {
    // If the pick season matches the league season, use the existing data
    const currentLeague = await this.prisma.league.findUnique({
      where: { id: draftPick.leagueId }
    });
    
    if (currentLeague && draftPick.season === currentLeague.season) {
      return {
        playerSelectedId: draftPick.playerSelectedId,
        playerSelectedName: draftPick.playerSelected?.fullName || null
      };
    }

    if (!currentLeague) {
      console.warn(`Could not find current league with ID: ${draftPick.leagueId}`);
      return { playerSelectedId: null, playerSelectedName: null };
    }

    // Find the correct league for this draft season in the dynasty chain
    const dynastyChain = await historicalLeagueService.getLeagueHistory(currentLeague.sleeperLeagueId);
    const targetLeague = dynastyChain.leagues.find(l => l.season === draftPick.season && l.inDatabase);
    
    if (!targetLeague) {
      console.warn(`Could not find league for draft season ${draftPick.season}`);
      return { playerSelectedId: null, playerSelectedName: null };
    }

    const targetInternalLeague = await this.prisma.league.findUnique({
      where: { sleeperLeagueId: targetLeague.sleeperLeagueId }
    });

    if (!targetInternalLeague) {
      console.warn(`Could not find internal league for Sleeper league ${targetLeague.sleeperLeagueId}`);
      return { playerSelectedId: null, playerSelectedName: null };
    }

    // For traded picks, we need to find which draft selection corresponds to this pick
    // The approach: find the draft pick in the target league that was originally owned by the same manager
    try {
      // First, try to find a matching draft pick in the target league by original owner and round
      const targetLeagueDraftPick = await this.prisma.draftPick.findFirst({
        where: {
          leagueId: targetInternalLeague.id,
          season: draftPick.season,
          round: draftPick.round,
          originalOwnerId: draftPick.originalOwnerId
        }
      });

      if (targetLeagueDraftPick) {
        // Now find the draft selection that used this pick
        const draftSelection = await this.prisma.draftSelection.findFirst({
          where: {
            draft: {
              leagueId: targetInternalLeague.id,
              season: draftPick.season
            },
            round: draftPick.round,
            draftSlot: targetLeagueDraftPick.pickNumber || targetLeagueDraftPick.round
          },
          include: {
            player: true
          }
        });

        if (draftSelection) {
          return {
            playerSelectedId: draftSelection.playerId,
            playerSelectedName: draftSelection.player.fullName
          };
        }
      }

      // If the above doesn't work, try to find by current owner
      // (in case the pick was traded but the currentOwnerId is updated correctly)
      const currentOwnerDraftPick = await this.prisma.draftPick.findFirst({
        where: {
          leagueId: targetInternalLeague.id,
          season: draftPick.season,
          round: draftPick.round,
          currentOwnerId: draftPick.currentOwnerId
        }
      });

      if (currentOwnerDraftPick) {
        const draftSelection = await this.prisma.draftSelection.findFirst({
          where: {
            draft: {
              leagueId: targetInternalLeague.id,
              season: draftPick.season
            },
            round: draftPick.round,
            draftSlot: currentOwnerDraftPick.pickNumber
          },
          include: {
            player: true
          }
        });

        if (draftSelection) {
          return {
            playerSelectedId: draftSelection.playerId,
            playerSelectedName: draftSelection.player.fullName
          };
        }
      }

      console.warn(`Could not find draft selection for ${draftPick.season} Round ${draftPick.round} Pick from ${draftPick.originalOwnerId} to ${draftPick.currentOwnerId}`);
      console.log('Debug - Draft Pick Details:', JSON.stringify({
        id: draftPick.id,
        season: draftPick.season,
        round: draftPick.round,
        originalOwnerId: draftPick.originalOwnerId,
        currentOwnerId: draftPick.currentOwnerId,
        leagueId: draftPick.leagueId
      }, null, 2));
      console.log('Debug - Target League ID:', targetInternalLeague.id);
      return { playerSelectedId: null, playerSelectedName: null };
      
    } catch (error) {
      console.error('Error finding draft selection:', error);
      return { playerSelectedId: null, playerSelectedName: null };
    }
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
      // Find the correct draft selection for this pick
      const correctSelection = await this.findCorrectDraftSelection(item.draftPick);
      
      return {
        id: item.draftPick.id,
        type: 'draft_pick',
        season: item.draftPick.season,
        round: item.draftPick.round,
        originalOwnerId: item.draftPick.originalOwnerId,
        currentOwnerId: item.draftPick.currentOwnerId,
        pickNumber: item.draftPick.pickNumber,
        playerSelectedId: correctSelection.playerSelectedId,
        originalOwnerName: item.draftPick.originalOwner?.displayName || item.draftPick.originalOwner?.username,
        playerSelectedName: correctSelection.playerSelectedName,
        name: `${item.draftPick.season} Round ${item.draftPick.round} Pick`
      };
    }

    throw new Error(`Unknown asset type in transaction item: ${item.id}`);
  }

  /**
   * Calculate asset importance based on depth and centrality
   */
  private calculateAssetImportance(asset: AssetNode, depth: number, maxDepth: number): number {
    // Base importance decreases with depth
    const baseImportance = 1.0 - (depth / (maxDepth + 1));
    
    // Boost importance for players vs draft picks
    const typeMultiplier = asset.type === 'player' ? 1.0 : 0.8;
    
    return Math.max(0.1, baseImportance * typeMultiplier);
  }

  /**
   * Calculate network statistics
   */
  private calculateNetworkStats(
    network: {
      nodes: PlayerNetworkNode[];
      transactions: TransactionNode[];
      connections: PlayerNetworkConnection[];
    },
    buildTime: number
  ): PlayerNetworkStats {
    const depthDistribution: Record<number, number> = {};
    const transactionTypes: Record<string, number> = {};

    // Count nodes by depth
    for (const node of network.nodes) {
      depthDistribution[node.depth] = (depthDistribution[node.depth] || 0) + 1;
    }

    // Count transaction types
    for (const transaction of network.transactions) {
      transactionTypes[transaction.type] = (transactionTypes[transaction.type] || 0) + 1;
    }

    return {
      totalNodes: network.nodes.length,
      totalTransactions: network.transactions.length,
      depthDistribution,
      transactionTypes,
      buildTimeMs: buildTime
    };
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
    await this.prisma.$disconnect();
  }
}

// Export singleton instance
export const playerNetworkService = new PlayerNetworkService();