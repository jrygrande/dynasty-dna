import { PrismaClient } from '@prisma/client';
import { transactionChainService } from './transactionChainService';
import { historicalLeagueService } from './historicalLeagueService';

const prisma = new PrismaClient();

// Core interfaces for the new approach
export interface AssetNode {
  id: string;
  type: 'player' | 'draft_pick';
  sleeperId?: string;
  name: string;
  position?: string;
  team?: string;
  season?: string;
  round?: number;
  originalOwnerId?: string;
  currentOwnerId?: string;
  pickNumber?: number;
  playerSelectedId?: string;
}

export interface TransactionNode {
  id: string;
  sleeperTransactionId: string;
  type: string;
  status: string;
  week?: number;
  season: string;
  leagueName: string;
  timestamp: string;
  creator?: string;
  description: string;
  assetsInvolved: AssetNode[];
  managersInvolved: Array<{
    id: string;
    username: string;
    displayName?: string;
    assetsGiven: AssetNode[];
    assetsReceived: AssetNode[];
  }>;
}

export interface AssetTradeTree {
  asset: AssetNode;                           // The asset this tree traces
  origin: {                                   // How the asset entered the league
    transaction: TransactionNode;
    type: 'startup_draft' | 'rookie_draft' | 'waiver' | 'free_agent' | 'unknown';
    originalManager: {
      id: string;
      username: string;
      displayName?: string;
    };
    date: Date;
  };
  chronologicalHistory: Array<{               // Every transaction chronologically
    transaction: TransactionNode;
    action: 'acquired' | 'dropped' | 'traded_away';
    fromManager?: {
      id: string;
      username: string;
      displayName?: string;
    };
    toManager?: {
      id: string;
      username: string;
      displayName?: string;
    };
  }>;
  finalTrade?: {                              // If the asset was traded away
    transaction: TransactionNode;
    tradePackage: {                           // What was received for this asset
      assetsReceived: AssetTradeTree[];       // Recursive trees for each acquired asset
      totalValue: string;                     // Summary description
    };
  };
  currentStatus: {
    type: 'on_roster' | 'dropped' | 'traded_away' | 'drafted_as_player';
    currentManager?: {
      id: string;
      username: string;
      displayName?: string;
    };
    transformedTo?: AssetNode;                // If draft pick became player
    asOfDate: Date;
  };
  timeline: {
    totalDaysTracked: number;
    managerTenures: Array<{
      manager: {
        id: string;
        username: string;
        displayName?: string;
      };
      startDate: Date;
      endDate?: Date;
      daysHeld: number;
    }>;
  };
}

export class AssetTradeTreeService {
  
  /**
   * Build complete asset trade tree starting from a specific transaction and asset
   */
  async buildAssetTradeTree(
    assetId: string,
    startingTransactionId: string,
    leagueId: string,
    visitedAssets: Set<string> = new Set(),
    depth: number = 0
  ): Promise<AssetTradeTree> {
    console.log(`🌳 Building asset trade tree for asset: ${assetId} starting from transaction: ${startingTransactionId}`);
    
    // Get the starting transaction and asset
    const transaction = await this.getTransactionById(startingTransactionId);
    const asset = await this.getAssetById(assetId);
    
    if (!transaction || !asset) {
      throw new Error(`Transaction ${startingTransactionId} or asset ${assetId} not found`);
    }
    
    // Build the complete tree
    const tree: AssetTradeTree = {
      asset,
      origin: await this.traceToOrigin(asset, transaction, leagueId),
      chronologicalHistory: await this.buildChronologicalHistory(asset, leagueId),
      currentStatus: await this.determineCurrentStatus(asset),
      timeline: await this.buildTimeline(asset, leagueId)
    };
    
    // Check if asset was traded away and build trade package if so
    const finalTrade = await this.findFinalTrade(asset, leagueId);
    if (finalTrade) {
      tree.finalTrade = {
        transaction: finalTrade,
        tradePackage: await this.buildTradePackage(asset, finalTrade, leagueId, visitedAssets, depth)
      };
    }
    
    return tree;
  }
  
  /**
   * Trace asset backwards to its origin (draft/waiver)
   */
  private async traceToOrigin(
    asset: AssetNode,
    beforeTransaction: TransactionNode,
    leagueId: string
  ): Promise<AssetTradeTree['origin']> {
    console.log(`📍 Tracing origin for asset: ${asset.name}`);
    
    // Get dynasty chain to build graph across all seasons
    const dynastyChain = await historicalLeagueService.getLeagueHistory(leagueId);
    const graph = await transactionChainService.buildTransactionGraph(dynastyChain.leagues);
    
    // Find all transactions involving this asset before the starting transaction
    const assetTransactionIds = graph.edges.get(asset.id) || [];
    const relevantTransactions = assetTransactionIds
      .map(id => graph.chains.get(id))
      .filter(Boolean)
      .filter(tx => Number(tx!.timestamp) < Number(beforeTransaction.timestamp))
      .sort((a, b) => Number(a!.timestamp) - Number(b!.timestamp)); // Oldest first
    
    if (relevantTransactions.length === 0) {
      // No prior transactions - this asset appeared in the starting transaction
      return {
        transaction: beforeTransaction,
        type: this.determineOriginType(beforeTransaction),
        originalManager: this.extractManagerFromTransaction(beforeTransaction, asset),
        date: new Date(Number(beforeTransaction.timestamp))
      };
    }
    
    // Find the earliest transaction - this should be the origin
    const originTransaction = this.convertToOurTransactionNode(relevantTransactions[0]!);
    
    return {
      transaction: originTransaction,
      type: this.determineOriginType(originTransaction),
      originalManager: this.extractManagerFromTransaction(originTransaction, asset),
      date: new Date(Number(originTransaction.timestamp))
    };
  }
  
  /**
   * Build chronological history of all transactions involving this asset
   */
  private async buildChronologicalHistory(
    asset: AssetNode,
    leagueId: string
  ): Promise<AssetTradeTree['chronologicalHistory']> {
    console.log(`📅 Building chronological history for asset: ${asset.name}`);
    
    // Get dynasty chain to build graph across all seasons
    const dynastyChain = await historicalLeagueService.getLeagueHistory(leagueId);
    const graph = await transactionChainService.buildTransactionGraph(dynastyChain.leagues);
    
    const assetTransactionIds = graph.edges.get(asset.id) || [];
    const transactions = assetTransactionIds
      .map(id => graph.chains.get(id))
      .filter(Boolean)
      .sort((a, b) => Number(a!.timestamp) - Number(b!.timestamp)); // Chronological order
    
    const history: AssetTradeTree['chronologicalHistory'] = [];
    
    for (const transaction of transactions) {
      const convertedTransaction = this.convertToOurTransactionNode(transaction!);
      const action = this.determineAssetAction(asset, convertedTransaction);
      const fromManager = action === 'acquired' ? this.getOtherManager(convertedTransaction, asset) : this.getAssetManager(convertedTransaction, asset);
      const toManager = action === 'acquired' ? this.getAssetManager(convertedTransaction, asset) : this.getOtherManager(convertedTransaction, asset);
      
      history.push({
        transaction: convertedTransaction,
        action,
        fromManager,
        toManager
      });
    }
    
    return history;
  }
  
  /**
   * Find if this asset was eventually traded away
   */
  private async findFinalTrade(
    asset: AssetNode,
    leagueId: string
  ): Promise<TransactionNode | null> {
    const dynastyChain = await historicalLeagueService.getLeagueHistory(leagueId);
    const graph = await transactionChainService.buildTransactionGraph(dynastyChain.leagues);
    const assetTransactionIds = graph.edges.get(asset.id) || [];
    const transactions = assetTransactionIds
      .map(id => graph.chains.get(id))
      .filter(Boolean)
      .filter(tx => tx!.type === 'trade')
      .sort((a, b) => Number(b!.timestamp) - Number(a!.timestamp)); // Most recent first
    
    // Return the most recent trade where this asset was involved
    return transactions.length > 0 ? this.convertToOurTransactionNode(transactions[0]!) : null;
  }
  
  /**
   * Build the trade package - what was received when this asset was traded away
   */
  private async buildTradePackage(
    tradedAsset: AssetNode,
    tradeTransaction: TransactionNode,
    leagueId: string,
    visitedAssets: Set<string> = new Set(),
    depth: number = 0
  ): Promise<{ assetsReceived: AssetTradeTree[]; totalValue: string; }> {
    // Prevent infinite recursion
    if (depth > 10) {
      console.warn(`Maximum recursion depth reached for asset ${tradedAsset.id}`);
      return {
        assetsReceived: [],
        totalValue: 'Deep recursion prevented'
      };
    }

    // Find the manager who traded away the asset
    let tradingManager: any = null;
    for (const manager of tradeTransaction.managersInvolved) {
      if (manager.assetsGiven.some(a => a.id === tradedAsset.id)) {
        tradingManager = manager;
        break;
      }
    }

    if (!tradingManager) {
      return {
        assetsReceived: [],
        totalValue: 'No trading manager found'
      };
    }

    // Get all assets this manager received in the same transaction
    const assetsReceived = tradingManager.assetsReceived;
    const tradeTreesReceived: AssetTradeTree[] = [];

    for (const receivedAsset of assetsReceived) {
      // Prevent infinite loops
      if (visitedAssets.has(receivedAsset.id)) {
        console.warn(`Circular reference detected for asset ${receivedAsset.id}`);
        continue;
      }

      try {
        // Add to visited set
        visitedAssets.add(receivedAsset.id);

        // Recursively build the tree for this received asset
        const receivedAssetTree = await this.buildAssetTradeTree(
          receivedAsset.id,
          tradeTransaction.id,
          leagueId,
          visitedAssets,
          depth + 1
        );

        tradeTreesReceived.push(receivedAssetTree);

        // Remove from visited set to allow processing in other branches
        visitedAssets.delete(receivedAsset.id);
      } catch (error) {
        console.warn(`Failed to build tree for received asset ${receivedAsset.id}:`, error);
      }
    }

    // Build summary description
    const assetNames = assetsReceived.map(asset => asset.name);
    const totalValue = assetNames.length === 1 
      ? assetNames[0]
      : `${assetNames.length}-asset package: ${assetNames.slice(0, 2).join(', ')}${assetNames.length > 2 ? '...' : ''}`;

    return {
      assetsReceived: tradeTreesReceived,
      totalValue
    };
  }
  
  /**
   * Determine the current status of an asset
   */
  private async determineCurrentStatus(asset: AssetNode): Promise<AssetTradeTree['currentStatus']> {
    // For players, check if they're on any current roster
    if (asset.type === 'player') {
      const currentRoster = await prisma.rosterSlot.findFirst({
        where: { playerId: asset.id },
        include: {
          roster: {
            include: {
              manager: true,
              league: true
            }
          }
        }
      });

      if (currentRoster) {
        return {
          type: 'on_roster',
          currentManager: {
            id: currentRoster.roster.manager.id,
            username: currentRoster.roster.manager.username,
            displayName: currentRoster.roster.manager.displayName || undefined
          },
          asOfDate: new Date()
        };
      } else {
        return {
          type: 'dropped',
          asOfDate: new Date()
        };
      }
    }

    // For draft picks, check if they were used to draft a player
    if (asset.type === 'draft_pick') {
      const draftPick = await prisma.draftPick.findUnique({
        where: { id: asset.id },
        include: {
          playerSelected: true,
          currentOwner: true
        }
      });

      if (draftPick?.playerSelected) {
        return {
          type: 'drafted_as_player',
          transformedTo: {
            id: draftPick.playerSelected.id,
            type: 'player',
            sleeperId: draftPick.playerSelected.sleeperId,
            name: draftPick.playerSelected.fullName || 'Unknown Player',
            position: draftPick.playerSelected.position || undefined,
            team: draftPick.playerSelected.team || undefined
          },
          asOfDate: new Date()
        };
      } else if (draftPick?.currentOwner) {
        return {
          type: 'on_roster',
          currentManager: {
            id: draftPick.currentOwner.id,
            username: draftPick.currentOwner.username,
            displayName: draftPick.currentOwner.displayName || undefined
          },
          asOfDate: new Date()
        };
      }
    }

    // Default status
    return {
      type: 'dropped',
      asOfDate: new Date()
    };
  }
  
  /**
   * Build timeline showing how long each manager held this asset
   */
  private async buildTimeline(asset: AssetNode, leagueId: string): Promise<AssetTradeTree['timeline']> {
    // Get chronological history first
    const history = await this.buildChronologicalHistory(asset, leagueId);
    
    if (history.length === 0) {
      return {
        totalDaysTracked: 0,
        managerTenures: []
      };
    }

    const managerTenures: AssetTradeTree['timeline']['managerTenures'] = [];
    let currentManager: any = null;
    let tenureStart: Date | null = null;

    for (const event of history) {
      const eventDate = new Date(Number(event.transaction.timestamp));

      if (event.action === 'acquired') {
        // New manager acquired the asset
        if (currentManager && tenureStart) {
          // End previous manager's tenure
          const daysHeld = Math.ceil((eventDate.getTime() - tenureStart.getTime()) / (1000 * 60 * 60 * 24));
          managerTenures.push({
            manager: currentManager,
            startDate: tenureStart,
            endDate: eventDate,
            daysHeld
          });
        }

        // Start new tenure
        currentManager = event.toManager;
        tenureStart = eventDate;
      } else if (event.action === 'dropped' || event.action === 'traded_away') {
        // Manager lost the asset
        if (currentManager && tenureStart) {
          const daysHeld = Math.ceil((eventDate.getTime() - tenureStart.getTime()) / (1000 * 60 * 60 * 24));
          managerTenures.push({
            manager: currentManager,
            startDate: tenureStart,
            endDate: eventDate,
            daysHeld
          });
          currentManager = null;
          tenureStart = null;
        }
      }
    }

    // Handle ongoing tenure (asset still owned)
    if (currentManager && tenureStart) {
      const now = new Date();
      const daysHeld = Math.ceil((now.getTime() - tenureStart.getTime()) / (1000 * 60 * 60 * 24));
      managerTenures.push({
        manager: currentManager,
        startDate: tenureStart,
        endDate: undefined, // Still ongoing
        daysHeld
      });
    }

    // Calculate total days tracked
    const totalDaysTracked = managerTenures.reduce((sum, tenure) => sum + tenure.daysHeld, 0);

    return {
      totalDaysTracked,
      managerTenures
    };
  }
  
  // Helper methods
  
  /**
   * Convert TransactionNode from transactionChainService to our format
   */
  private convertToOurTransactionNode(chainTransaction: any): TransactionNode {
    return {
      id: chainTransaction.id,
      sleeperTransactionId: chainTransaction.sleeperTransactionId,
      type: chainTransaction.type,
      status: chainTransaction.status || 'complete',
      week: chainTransaction.week,
      season: chainTransaction.season,
      leagueName: chainTransaction.leagueName,
      timestamp: chainTransaction.timestamp,
      creator: chainTransaction.creator,
      description: chainTransaction.description,
      assetsInvolved: [...chainTransaction.assetsReceived, ...chainTransaction.assetsGiven],
      managersInvolved: [{
        id: chainTransaction.managerTo?.id || 'unknown',
        username: chainTransaction.managerTo?.username || 'unknown',
        displayName: chainTransaction.managerTo?.displayName,
        assetsGiven: chainTransaction.assetsGiven || [],
        assetsReceived: chainTransaction.assetsReceived || []
      }]
    };
  }
  
  private async getTransactionById(transactionId: string): Promise<TransactionNode | null> {
    const transaction = await prisma.transaction.findUnique({
      where: { id: transactionId },
      include: {
        league: true,
        items: {
          include: {
            player: true,
            draftPick: true,
            manager: true
          }
        }
      }
    });

    if (!transaction) return null;

    // Convert to our format
    const assetsInvolved: AssetNode[] = [];
    const managersMap = new Map<string, any>();

    for (const item of transaction.items) {
      // Build asset
      let asset: AssetNode;
      if (item.player) {
        asset = {
          id: item.player.id,
          type: 'player',
          sleeperId: item.player.sleeperId,
          name: item.player.fullName || 'Unknown Player',
          position: item.player.position || undefined,
          team: item.player.team || undefined
        };
      } else if (item.draftPick) {
        asset = {
          id: item.draftPick.id,
          type: 'draft_pick',
          name: `${item.draftPick.season} Round ${item.draftPick.round} Pick`,
          season: item.draftPick.season,
          round: item.draftPick.round,
          originalOwnerId: item.draftPick.originalOwnerId,
          currentOwnerId: item.draftPick.currentOwnerId,
          pickNumber: item.draftPick.pickNumber || undefined,
          playerSelectedId: item.draftPick.playerSelectedId || undefined
        };
      } else {
        continue;
      }

      assetsInvolved.push(asset);

      // Track managers
      if (item.manager) {
        const managerId = item.manager.id;
        if (!managersMap.has(managerId)) {
          managersMap.set(managerId, {
            id: item.manager.id,
            username: item.manager.username,
            displayName: item.manager.displayName,
            assetsGiven: [],
            assetsReceived: []
          });
        }

        const manager = managersMap.get(managerId);
        if (item.type === 'drop') {
          manager.assetsGiven.push(asset);
        } else if (item.type === 'add') {
          manager.assetsReceived.push(asset);
        }
      }
    }

    return {
      id: transaction.id,
      sleeperTransactionId: transaction.sleeperTransactionId,
      type: transaction.type,
      status: transaction.status,
      week: transaction.week || undefined,
      season: transaction.league.season,
      leagueName: transaction.league.name,
      timestamp: transaction.timestamp.toString(),
      creator: transaction.creator || undefined,
      description: `${transaction.type} transaction`,
      assetsInvolved,
      managersInvolved: Array.from(managersMap.values())
    };
  }
  
  private async getAssetById(assetId: string): Promise<AssetNode | null> {
    // Try to find as player first
    const player = await prisma.player.findUnique({
      where: { id: assetId }
    });

    if (player) {
      return {
        id: player.id,
        type: 'player',
        sleeperId: player.sleeperId,
        name: player.fullName || 'Unknown Player',
        position: player.position || undefined,
        team: player.team || undefined
      };
    }

    // Try to find as draft pick
    const draftPick = await prisma.draftPick.findUnique({
      where: { id: assetId },
      include: {
        playerSelected: true
      }
    });

    if (draftPick) {
      return {
        id: draftPick.id,
        type: 'draft_pick',
        name: draftPick.playerSelected?.fullName 
          ? `${draftPick.season} Round ${draftPick.round} Pick → ${draftPick.playerSelected.fullName}`
          : `${draftPick.season} Round ${draftPick.round} Pick`,
        season: draftPick.season,
        round: draftPick.round,
        originalOwnerId: draftPick.originalOwnerId,
        currentOwnerId: draftPick.currentOwnerId,
        pickNumber: draftPick.pickNumber || undefined,
        playerSelectedId: draftPick.playerSelectedId || undefined
      };
    }

    return null;
  }
  
  private determineOriginType(transaction: TransactionNode): AssetTradeTree['origin']['type'] {
    if (transaction.type === 'draft') return 'rookie_draft';
    if (transaction.type === 'waiver') return 'waiver';
    if (transaction.type === 'free_agent') return 'free_agent';
    return 'unknown';
  }
  
  private extractManagerFromTransaction(transaction: TransactionNode, asset: AssetNode): AssetTradeTree['origin']['originalManager'] {
    // Find the manager who received this asset in the transaction
    for (const manager of transaction.managersInvolved) {
      if (manager.assetsReceived.some(a => a.id === asset.id)) {
        return {
          id: manager.id,
          username: manager.username,
          displayName: manager.displayName
        };
      }
    }
    
    // Fallback - return first manager
    const firstManager = transaction.managersInvolved[0];
    return {
      id: firstManager?.id || 'unknown',
      username: firstManager?.username || 'unknown',
      displayName: firstManager?.displayName
    };
  }
  
  private determineAssetAction(asset: AssetNode, transaction: TransactionNode): 'acquired' | 'dropped' | 'traded_away' {
    // Check if asset was received (added)
    for (const manager of transaction.managersInvolved) {
      if (manager.assetsReceived.some(a => a.id === asset.id)) {
        return transaction.type === 'trade' ? 'acquired' : 'acquired';
      }
    }
    
    // Asset was given (dropped or traded away)
    return transaction.type === 'trade' ? 'traded_away' : 'dropped';
  }
  
  private getAssetManager(transaction: TransactionNode, asset: AssetNode): AssetTradeTree['chronologicalHistory'][0]['fromManager'] {
    // Find manager who received this asset
    for (const manager of transaction.managersInvolved) {
      if (manager.assetsReceived.some(a => a.id === asset.id)) {
        return {
          id: manager.id,
          username: manager.username,
          displayName: manager.displayName
        };
      }
    }
    return undefined;
  }
  
  private getOtherManager(transaction: TransactionNode, asset: AssetNode): AssetTradeTree['chronologicalHistory'][0]['toManager'] {
    // Find manager who gave this asset
    for (const manager of transaction.managersInvolved) {
      if (manager.assetsGiven.some(a => a.id === asset.id)) {
        return {
          id: manager.id,
          username: manager.username,
          displayName: manager.displayName
        };
      }
    }
    return undefined;
  }
}

// Export singleton instance
export const assetTradeTreeService = new AssetTradeTreeService();