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
  position?: string | null;
  team?: string | null;
  pickNumber?: number | null;
  playerSelectedId?: string | null;
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

export interface CompleteTransactionLineage {
  targetTransaction: TransactionNode;
  perspective: {
    manager: {
      id: string;
      username: string;
      displayName?: string;
    };
    role: 'giving' | 'receiving' | 'both';
  };
  
  // Complete lineage for EVERY asset in the transaction
  assetLineages: AssetCompleteLineage[];
  
  summary: {
    totalAssetsTraced: number;
    startupDraftAssets: number;
    rookieDraftAssets: number;
    waiverPickups: number;
    tradeAcquisitions: number;
    stillActiveAssets: number;
    retiredAssets: number;
    longestChainLength: number;
  };
}

export interface AssetCompleteLineage {
  asset: AssetNode;
  
  // Which side of the target transaction
  transactionSide: 'given' | 'received';
  managedBy: {
    id: string;
    username: string;
    displayName?: string;
  }; // Who had this asset at target transaction
  
  // COMPLETE BACKWARD CHAIN to origin
  originChain: {
    transactions: TransactionNode[];
    originPoint: {
      type: 'startup_draft' | 'rookie_draft' | 'waiver' | 'free_agent' | 'commissioner';
      transaction: TransactionNode;
      originalManager: {
        id: string;
        username: string;
        displayName?: string;
      };
      date: Date;
      metadata?: {
        draftPosition?: number;
        waivePriority?: number;
        faabSpent?: number;
      };
    };
  };
  
  // COMPLETE FORWARD CHAIN to present
  futureChain: {
    transactions: TransactionNode[];
    currentStatus: {
      type: 'active_roster' | 'traded' | 'dropped' | 'retired' | 'draft_pick_used';
      currentManager?: {
        id: string;
        username: string;
        displayName?: string;
      };
      lastTransaction?: TransactionNode;
      metadata?: {
        weeksOnRoster?: number;
        totalPoints?: number;
        championships?: number;
      };
    };
  };
  
  // Visual timeline data
  timeline: {
    totalDays: number;
    managerTenures: {
      manager: {
        id: string;
        username: string;
        displayName?: string;
      };
      startDate: Date;
      endDate: Date;
      daysHeld: number;
    }[];
  };
}

export class TransactionChainService {
  private prisma: PrismaClient;

  constructor(prismaInstance?: PrismaClient) {
    this.prisma = prismaInstance || prisma;
  }

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
   * Build complete transaction lineage from startup draft to present for all assets in a transaction
   */
  async buildCompleteTransactionLineage(
    transactionId: string,
    managerId: string,
    leagueId: string
  ): Promise<CompleteTransactionLineage> {
    console.log(`🔄 Building complete lineage for transaction: ${transactionId} from manager: ${managerId} perspective`);
    
    // 1. Get the target transaction
    const targetTransaction = await this.getTransactionById(transactionId);
    
    // 2. Get dynasty chain for full context
    const dynastyChain = await historicalLeagueService.getLeagueHistory(leagueId);
    
    // 3. Build complete transaction graph across all seasons
    const graph = await this.buildTransactionGraph(dynastyChain.leagues);
    
    // 4. Determine manager's role in this transaction
    const perspective = this.determineManagerPerspective(targetTransaction, managerId);
    
    // 5. Get all assets in the transaction
    const allAssets = [...targetTransaction.assetsGiven, ...targetTransaction.assetsReceived];
    
    // 6. Build complete lineage for each asset
    const assetLineages: AssetCompleteLineage[] = [];
    
    for (const asset of allAssets) {
      console.log(`📊 Tracing complete lineage for asset: ${asset.name}`);
      
      // Determine which side of transaction this asset is on from manager's perspective
      const transactionSide = this.getAssetTransactionSide(asset, targetTransaction, managerId);
      const managedBy = this.getAssetManagerAtTransaction(asset, targetTransaction);
      
      // Trace backward to origin
      const originChain = await this.traceToOrigin(asset, targetTransaction, graph);
      
      // Trace forward to present
      const futureChain = await this.traceToPresent(asset, targetTransaction, graph);
      
      // Build timeline
      const timeline = this.buildAssetTimeline(originChain, targetTransaction, futureChain);
      
      assetLineages.push({
        asset,
        transactionSide,
        managedBy,
        originChain,
        futureChain,
        timeline
      });
    }
    
    // 7. Build summary
    const summary = this.buildLineageSummary(assetLineages);
    
    return {
      targetTransaction,
      perspective,
      assetLineages,
      summary
    };
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
    const manager = await this.prisma.manager.findUnique({
      where: { id: managerId }
    });

    if (!manager) {
      throw new Error(`Manager not found: ${managerId}`);
    }

    // Get current roster
    const internalLeague = await this.prisma.league.findUnique({
      where: { sleeperLeagueId: leagueId }
    });

    if (!internalLeague) {
      throw new Error(`League not found: ${leagueId}`);
    }

    const roster = await this.prisma.roster.findFirst({
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
        position: slot.player.position || undefined,
        team: slot.player.team || undefined
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
    const internalLeague = await this.prisma.league.findUnique({
      where: { sleeperLeagueId: leagueId }
    });

    if (!internalLeague) {
      throw new Error(`League not found: ${leagueId}`);
    }

    const draftPick = await this.prisma.draftPick.findFirst({
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
    maxDepth: number = 10, // Reduce default max depth from 20 to 10
    visitedTransactions: Set<string> = new Set()
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

    // Additional guard: check for asset explosion
    if (visitedAssets.size > 500) {
      console.warn(`Too many visited assets (${visitedAssets.size}) for ${rootAsset.name}, stopping recursion to prevent memory explosion`);
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
      
      // Skip if we've already processed this transaction in this chain
      if (visitedTransactions.has(transaction.id)) {
        console.warn(`Skipping already processed transaction ${transaction.id} for asset ${rootAsset.name}`);
        continue;
      }
      visitedTransactions.add(transaction.id);

      // For each transaction, check if we need to trace back asset origins
      const enhancedTransaction = await this.enhanceTransactionWithAssetOrigins(
        transaction, 
        graph, 
        rootAsset,
        visitedAssets,
        depth,
        visitedTransactions
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

    // Keep asset in visited set to prevent circular references  
    // Note: We do NOT remove from visitedAssets to prevent infinite loops

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
    currentDepth: number,
    visitedTransactions: Set<string> = new Set()
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
              currentDepth + 1,
              10, // Reduce max depth
              new Set(visitedTransactions) // Copy visited transactions too
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
              currentDepth + 1,
              10, // Reduce max depth
              new Set(visitedTransactions) // Copy visited transactions too
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
  async buildTransactionGraph(
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

      const internalLeague = await this.prisma.league.findUnique({
        where: { sleeperLeagueId: league.sleeperLeagueId }
      });

      if (!internalLeague) {
        continue;
      }

      // Get all transactions for this league
      const transactions = await this.prisma.transaction.findMany({
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
    maxDepth: number = 10, // Reduce default max depth
    visitedTransactions: Set<string> = new Set()
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

    // Additional guard: check for asset explosion 
    if (visitedAssets.size > 500) {
      console.warn(`Too many visited assets (${visitedAssets.size}) for ${rootAsset.name}, stopping recursion to prevent memory explosion`);
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
              maxDepth,
              visitedTransactions
            );
            derivedAssets.push(derivedChain);
          } catch (error) {
            console.warn(`Failed to trace derived asset ${receivedAsset.id}:`, error);
          }
        }
      }
    }

    // Keep asset in visited set to prevent re-processing and circular references
    // Note: We do NOT remove from visitedAssets to prevent infinite loops

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

    if (transaction.type === 'trade') {
      // For trades, group items by manager to determine who gave what to whom
      const managerGroups = new Map<string, { add: AssetNode[], drop: AssetNode[], manager: any }>();
      
      for (const item of transaction.items) {
        const asset = await this.buildAssetNodeFromItem(item);
        const managerId = item.manager.id;
        
        if (!managerGroups.has(managerId)) {
          managerGroups.set(managerId, {
            add: [],
            drop: [],
            manager: item.manager
          });
        }
        
        const group = managerGroups.get(managerId)!;
        if (item.type === 'add') {
          group.add.push(asset);
        } else if (item.type === 'drop') {
          group.drop.push(asset);
        }
      }
      
      // Convert to arrays for easier handling
      const managers = Array.from(managerGroups.entries());
      
      if (managers.length === 2) {
        // Standard 2-manager trade
        const [, manager1Data] = managers[0];
        const [, manager2Data] = managers[1];
        
        // Manager1 gives what they drop, receives what they add
        // Manager2 gives what they drop, receives what they add
        // From transaction perspective: managerFrom gives, managerTo receives
        
        if (rootAsset) {
          // Determine perspective based on root asset
          const rootAssetInManager1 = manager1Data.drop.some(a => a.id === rootAsset.id) || 
                                     manager1Data.add.some(a => a.id === rootAsset.id);
          
          if (rootAssetInManager1) {
            // Show from manager1's perspective
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
            assetsGiven.push(...manager1Data.drop);
            assetsReceived.push(...manager1Data.add);
          } else {
            // Show from manager2's perspective  
            managerFrom = {
              id: manager2Data.manager.id,
              username: manager2Data.manager.username,
              displayName: manager2Data.manager.displayName
            };
            managerTo = {
              id: manager1Data.manager.id,
              username: manager1Data.manager.username,
              displayName: manager1Data.manager.displayName
            };
            assetsGiven.push(...manager2Data.drop);
            assetsReceived.push(...manager2Data.add);
          }
        } else {
          // No root asset context - use first manager as "from"
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
          assetsGiven.push(...manager1Data.drop);
          assetsReceived.push(...manager2Data.drop); // What manager2 gave = what manager1 received
        }
      } else {
        // Fallback for unusual trade structures
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
    } else {
      // For non-trades (draft, waiver, free_agent), use simple add/drop logic
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
    } else if (managerFrom && managerTo) {
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
      managerFrom: managerFrom || undefined,
      managerTo: managerTo || undefined
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
      const player = await this.prisma.player.findUnique({
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
        position: player.position || undefined,
        team: player.team || undefined
      };
    } else {
      const draftPick = await this.prisma.draftPick.findUnique({
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
        pickNumber: draftPick.pickNumber || undefined,
        playerSelectedId: draftPick.playerSelectedId || undefined,
        name: draftPick.playerSelected?.fullName || 
              `${draftPick.season} Round ${draftPick.round} Pick`
      };
    }
  }

  /**
   * Trace backward to find origin of an asset (startup draft, waiver, etc.)
   */
  private async traceToOrigin(
    asset: AssetNode, 
    beforeTransaction: TransactionNode, 
    graph: TransactionGraph
  ): Promise<AssetCompleteLineage['originChain']> {
    const transactions: TransactionNode[] = [];
    let currentAsset = asset;
    const visitedAssets = new Set<string>();
    
    while (true) {
      // Prevent infinite loops
      if (visitedAssets.has(currentAsset.id)) {
        console.warn(`Circular reference detected in origin trace for ${currentAsset.id}`);
        break;
      }
      visitedAssets.add(currentAsset.id);
      
      // Get all transactions for this asset BEFORE the target transaction
      const assetTransactionIds = graph.edges.get(currentAsset.id) || [];
      const relevantTransactions = assetTransactionIds
        .map(id => graph.chains.get(id))
        .filter(Boolean)
        .filter(tx => Number(tx!.timestamp) < Number(beforeTransaction.timestamp))
        .sort((a, b) => Number(b!.timestamp) - Number(a!.timestamp)); // Most recent first
      
      if (relevantTransactions.length === 0) {
        // No more transactions - we've reached the origin
        break;
      }
      
      const previousTx = relevantTransactions[0]!;
      transactions.unshift(previousTx); // Add to beginning
      
      // Check if this is an origin transaction
      if (this.isOriginTransaction(previousTx)) {
        const originPoint = this.buildOriginPoint(previousTx, currentAsset);
        return {
          transactions,
          originPoint
        };
      }
      
      // For trades, find what was given to get this asset
      if (previousTx.type === 'trade') {
        const tradedForAsset = this.findTradedForAsset(previousTx, currentAsset);
        if (tradedForAsset) {
          currentAsset = tradedForAsset;
        } else {
          // Can't trace further
          break;
        }
      } else {
        // Other transaction types end the trace
        break;
      }
    }
    
    // Fallback - assume the first transaction is the origin
    const fallbackTx = transactions[0] || beforeTransaction;
    const originPoint = this.buildOriginPoint(fallbackTx, asset);
    
    return {
      transactions,
      originPoint
    };
  }

  /**
   * Trace forward to find current status of an asset
   */
  private async traceToPresent(
    asset: AssetNode,
    afterTransaction: TransactionNode,
    graph: TransactionGraph
  ): Promise<AssetCompleteLineage['futureChain']> {
    const transactions: TransactionNode[] = [];
    let currentAsset = asset;
    const visitedAssets = new Set<string>();
    
    // Get all transactions AFTER the target transaction
    const assetTransactionIds = graph.edges.get(currentAsset.id) || [];
    const futureTransactions = assetTransactionIds
      .map(id => graph.chains.get(id))
      .filter(Boolean)
      .filter(tx => Number(tx!.timestamp) > Number(afterTransaction.timestamp))
      .sort((a, b) => Number(a!.timestamp) - Number(b!.timestamp)); // Oldest first
    
    for (const tx of futureTransactions) {
      if (!tx) continue;
      
      // Prevent infinite loops
      if (visitedAssets.has(currentAsset.id)) {
        console.warn(`Circular reference detected in future trace for ${currentAsset.id}`);
        break;
      }
      visitedAssets.add(currentAsset.id);
      
      transactions.push(tx);
      
      // If this is a trade, follow the asset
      if (tx.type === 'trade') {
        const newAsset = this.findReceivedAsset(tx, currentAsset);
        if (newAsset) {
          currentAsset = newAsset;
        }
      }
      
      // If asset was dropped/drafted, that's the end
      if (tx.type === 'waiver' || tx.type === 'free_agent' || tx.type === 'draft') {
        break;
      }
    }
    
    // Determine current status
    const currentStatus = this.determineCurrentStatus(currentAsset, transactions);
    
    return {
      transactions,
      currentStatus
    };
  }

  /**
   * Build timeline showing manager tenures
   */
  private buildAssetTimeline(
    originChain: AssetCompleteLineage['originChain'],
    targetTransaction: TransactionNode,
    futureChain: AssetCompleteLineage['futureChain']
  ): AssetCompleteLineage['timeline'] {
    const managerTenures: AssetCompleteLineage['timeline']['managerTenures'] = [];
    
    // Get all transactions in chronological order
    const allTransactions = [
      ...originChain.transactions,
      targetTransaction,
      ...futureChain.transactions
    ].sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
    
    let currentManager = originChain.originPoint.originalManager;
    let tenureStart = originChain.originPoint.date;
    
    for (const tx of allTransactions) {
      const txDate = new Date(Number(tx.timestamp));
      
      // If manager changed, record the previous tenure
      if (tx.managerTo && tx.managerTo.id !== currentManager.id) {
        const tenureEnd = txDate;
        const daysHeld = Math.floor((tenureEnd.getTime() - tenureStart.getTime()) / (1000 * 60 * 60 * 24));
        
        managerTenures.push({
          manager: currentManager,
          startDate: tenureStart,
          endDate: tenureEnd,
          daysHeld
        });
        
        currentManager = tx.managerTo;
        tenureStart = txDate;
      }
    }
    
    // Add final tenure (if still owned)
    const finalDate = new Date(); // Current date
    const finalDaysHeld = Math.floor((finalDate.getTime() - tenureStart.getTime()) / (1000 * 60 * 60 * 24));
    
    managerTenures.push({
      manager: currentManager,
      startDate: tenureStart,
      endDate: finalDate,
      daysHeld: finalDaysHeld
    });
    
    const totalDays = Math.floor((finalDate.getTime() - originChain.originPoint.date.getTime()) / (1000 * 60 * 60 * 24));
    
    return {
      totalDays,
      managerTenures
    };
  }

  /**
   * Check if transaction is an origin transaction (draft, waiver pickup, etc.)
   */
  private isOriginTransaction(transaction: TransactionNode): boolean {
    return ['draft', 'waiver', 'free_agent', 'commissioner'].includes(transaction.type);
  }

  /**
   * Build origin point from transaction
   */
  private buildOriginPoint(transaction: TransactionNode, _asset: AssetNode): AssetCompleteLineage['originChain']['originPoint'] {
    let type: AssetCompleteLineage['originChain']['originPoint']['type'] = 'free_agent';
    
    if (transaction.type === 'draft') {
      // Determine if startup or rookie draft based on season/asset
      if (transaction.season === '2020' || transaction.season === '2021') {
        type = 'startup_draft';
      } else {
        type = 'rookie_draft';
      }
    } else if (transaction.type === 'waiver') {
      type = 'waiver';
    } else if (transaction.type === 'free_agent') {
      type = 'free_agent';
    } else if (transaction.type === 'commissioner') {
      type = 'commissioner';
    }
    
    return {
      type,
      transaction,
      originalManager: transaction.managerTo || transaction.managerFrom || {
        id: 'unknown',
        username: 'unknown',
        displayName: 'Unknown'
      },
      date: new Date(Number(transaction.timestamp)),
      metadata: {
        // Could add draft position, FAAB, etc. here
      }
    };
  }

  /**
   * Find what asset was traded for the current asset in a trade
   */
  private findTradedForAsset(transaction: TransactionNode, currentAsset: AssetNode): AssetNode | null {
    // In a trade, if currentAsset was received, find what was given
    const wasReceived = transaction.assetsReceived.some(a => a.id === currentAsset.id);
    
    if (wasReceived && transaction.assetsGiven.length > 0) {
      // Return the first asset that was given (simplified logic)
      return transaction.assetsGiven[0];
    }
    
    // If currentAsset was given, find what was received
    const wasGiven = transaction.assetsGiven.some(a => a.id === currentAsset.id);
    
    if (wasGiven && transaction.assetsReceived.length > 0) {
      return transaction.assetsReceived[0];
    }
    
    return null;
  }

  /**
   * Find what asset was received in exchange for the current asset
   */
  private findReceivedAsset(transaction: TransactionNode, currentAsset: AssetNode): AssetNode | null {
    // Similar logic to findTradedForAsset but in the forward direction
    return this.findTradedForAsset(transaction, currentAsset);
  }

  /**
   * Determine current status of an asset based on its transaction history
   */
  private determineCurrentStatus(
    _asset: AssetNode,
    transactions: TransactionNode[]
  ): AssetCompleteLineage['futureChain']['currentStatus'] {
    if (transactions.length === 0) {
      return {
        type: 'active_roster',
        currentManager: undefined,
        metadata: {}
      };
    }
    
    const lastTransaction = transactions[transactions.length - 1];
    
    switch (lastTransaction.type) {
      case 'trade':
        return {
          type: 'traded',
          currentManager: lastTransaction.managerTo,
          lastTransaction,
          metadata: {}
        };
      
      case 'waiver':
      case 'free_agent':
        return {
          type: 'dropped',
          lastTransaction,
          metadata: {}
        };
      
      case 'draft':
        return {
          type: 'draft_pick_used',
          lastTransaction,
          metadata: {}
        };
      
      default:
        return {
          type: 'active_roster',
          currentManager: lastTransaction.managerTo,
          metadata: {}
        };
    }
  }

  /**
   * Get transaction by ID with all related data
   */
  private async getTransactionById(transactionId: string): Promise<TransactionNode> {
    const transaction = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
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
        },
        league: {
          select: {
            name: true,
            season: true
          }
        }
      }
    });

    if (!transaction) {
      throw new Error(`Transaction not found: ${transactionId}`);
    }

    return this.buildTransactionNode(transaction, transaction.league.name, transaction.league.season);
  }

  /**
   * Determine manager's role in a transaction
   */
  private determineManagerPerspective(
    transaction: TransactionNode, 
    managerId: string
  ): { manager: { id: string; username: string; displayName?: string }; role: 'giving' | 'receiving' | 'both' } {
    const managerFrom = transaction.managerFrom;
    const managerTo = transaction.managerTo;
    
    let role: 'giving' | 'receiving' | 'both' = 'receiving';
    
    if (managerFrom?.id === managerId && managerTo?.id === managerId) {
      role = 'both'; // Self-trade (like drafts)
    } else if (managerFrom?.id === managerId) {
      role = 'giving';
    } else if (managerTo?.id === managerId) {
      role = 'receiving';
    }

    // Get manager info
    const manager = managerFrom?.id === managerId ? managerFrom : managerTo;
    
    if (!manager) {
      throw new Error(`Manager ${managerId} not found in transaction ${transaction.id}`);
    }

    return { manager, role };
  }

  /**
   * Determine which side of transaction an asset is on from manager's perspective
   */
  private getAssetTransactionSide(
    asset: AssetNode, 
    transaction: TransactionNode, 
    managerId: string
  ): 'given' | 'received' {
    // Check if asset is in assetsGiven or assetsReceived
    const isGiven = transaction.assetsGiven.some(a => a.id === asset.id);
    const isReceived = transaction.assetsReceived.some(a => a.id === asset.id);
    
    // From manager's perspective - simplified logic
    // If the manager is the one giving (managerFrom), then:
    //   - assets in assetsGiven were given by this manager
    //   - assets in assetsReceived were received by this manager
    // If the manager is the one receiving (managerTo), then:
    //   - assets in assetsGiven were given by the other manager (so this manager received them)
    //   - assets in assetsReceived were received by this manager
    
    const managerIsGiving = transaction.managerFrom?.id === managerId;
    
    if (managerIsGiving) {
      // This manager is the giver, so assetsGiven = what they gave, assetsReceived = what they received
      return isGiven ? 'given' : 'received';
    } else {
      // This manager is the receiver, so assetsGiven = what other gave (they received), assetsReceived = what they received  
      return isReceived ? 'received' : 'given';
    }
  }

  /**
   * Get the manager who controlled an asset BEFORE the transaction occurred
   */
  private getAssetManagerAtTransaction(asset: AssetNode, transaction: TransactionNode) {
    // For assets being given, managerFrom controlled them before the transaction
    const isGiven = transaction.assetsGiven.some(a => a.id === asset.id);
    
    if (isGiven && transaction.managerFrom) {
      return transaction.managerFrom;
    }
    
    // For assets being received, managerTo got them FROM someone else
    // So the previous owner must be managerFrom (who gave them)
    if (!isGiven && transaction.managerFrom) {
      return transaction.managerFrom;
    }
    
    // Fallback
    return transaction.managerFrom || transaction.managerTo || {
      id: 'unknown',
      username: 'unknown',
      displayName: 'Unknown Manager'
    };
  }

  /**
   * Build summary statistics for asset lineages
   */
  private buildLineageSummary(assetLineages: AssetCompleteLineage[]) {
    let startupDraftAssets = 0;
    let rookieDraftAssets = 0;
    let waiverPickups = 0;
    let tradeAcquisitions = 0;
    let stillActiveAssets = 0;
    let retiredAssets = 0;
    let longestChainLength = 0;

    for (const lineage of assetLineages) {
      // Count origin types
      switch (lineage.originChain.originPoint.type) {
        case 'startup_draft':
          startupDraftAssets++;
          break;
        case 'rookie_draft':
          rookieDraftAssets++;
          break;
        case 'waiver':
          waiverPickups++;
          break;
        case 'free_agent':
        case 'commissioner':
          tradeAcquisitions++;
          break;
      }

      // Count current status
      switch (lineage.futureChain.currentStatus.type) {
        case 'active_roster':
          stillActiveAssets++;
          break;
        case 'traded':
        case 'dropped':
        case 'retired':
        case 'draft_pick_used':
          retiredAssets++;
          break;
      }

      // Track longest chain
      const totalTransactions = lineage.originChain.transactions.length + lineage.futureChain.transactions.length;
      longestChainLength = Math.max(longestChainLength, totalTransactions);
    }

    return {
      totalAssetsTraced: assetLineages.length,
      startupDraftAssets,
      rookieDraftAssets,
      waiverPickups,
      tradeAcquisitions,
      stillActiveAssets,
      retiredAssets,
      longestChainLength
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
export const transactionChainService = new TransactionChainService();