import type { ApiResponse, LeagueSyncRequest, LeagueSyncResponse, TransactionChainNode } from '@/shared/types';
import type { TransactionGraph, AssetTradeTree, TransactionGraphFilters } from '../types/api';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

class ApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public code?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function fetchApi<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;
  
  const config: RequestInit = {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  };

  try {
    const response = await fetch(url, config);
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new ApiError(
        errorData.error?.message || `HTTP ${response.status}`,
        response.status,
        errorData.error?.code
      );
    }

    return await response.json();
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError('Network error', 0, 'NETWORK_ERROR');
  }
}

export const api = {
  async getHealth() {
    return fetchApi<{ uptime: number; message: string; timestamp: string }>('/health');
  },

  async syncLeague(request: LeagueSyncRequest): Promise<LeagueSyncResponse> {
    return fetchApi<LeagueSyncResponse>(`/leagues/${request.leagueId}/sync`, {
      method: 'POST',
      body: JSON.stringify(request),
    });
  },

  async getLeagueTransactions(leagueId: string) {
    return fetchApi<ApiResponse<any>>(`/leagues/${leagueId}/transactions`);
  },

  async getPlayerTransactionChain(playerId: string): Promise<TransactionChainNode> {
    return fetchApi<TransactionChainNode>(`/players/${playerId}/transaction-chain`);
  },

  async getPlayerPerformance(playerId: string) {
    return fetchApi<ApiResponse<any>>(`/players/${playerId}/performance`);
  },

  // Transaction Tree Visualization Endpoints
  
  async getTransactionGraph(leagueId: string, filters?: TransactionGraphFilters) {
    const params = new URLSearchParams();
    if (filters?.season) params.append('season', filters.season);
    if (filters?.transactionType) params.append('transactionType', filters.transactionType);
    if (filters?.managerId) params.append('managerId', filters.managerId);
    if (filters?.format) params.append('format', filters.format);
    
    const queryString = params.toString();
    const url = `/leagues/${leagueId}/transaction-graph${queryString ? `?${queryString}` : ''}`;
    
    return fetchApi<{
      graph: TransactionGraph;
      stats: {
        totalNodes: number;
        totalTransactions: number;
        seasonsSpanned: number;
        buildTimeMs: number;
      };
    }>(url);
  },

  async getAssetCompleteTree(leagueId: string, assetId: string) {
    return fetchApi<{
      tree: AssetTradeTree;
      metadata: {
        totalNodes: number;
        maxDepth: number;
        buildTimeMs: number;
      };
    }>(`/leagues/${leagueId}/assets/${assetId}/complete-tree`);
  },

  async getAssetTradeTree(leagueId: string, assetId: string) {
    return fetchApi<{
      tree: AssetTradeTree;
      metadata: {
        totalNodes: number;
        buildTimeMs: number;
      };
    }>(`/leagues/${leagueId}/assets/${assetId}/trade-tree`);
  },

  // Player Network Endpoint
  async getPlayerNetwork(leagueId: string, playerId: string, options?: {
    depth?: number;
    season?: string;
    transactionType?: string;
    includeStats?: boolean;
  }) {
    const params = new URLSearchParams();
    if (options?.depth) params.append('depth', options.depth.toString());
    if (options?.season) params.append('season', options.season);
    if (options?.transactionType) params.append('transactionType', options.transactionType);
    if (options?.includeStats !== undefined) params.append('includeStats', options.includeStats.toString());
    
    const queryString = params.toString();
    const url = `/leagues/${leagueId}/players/${playerId}/network${queryString ? `?${queryString}` : ''}`;
    
    return fetchApi<{
      leagueId: string;
      playerId: string;
      depth: number;
      focalPlayer: {
        id: string;
        type: 'player';
        name: string;
        position?: string;
        team?: string;
      };
      network: {
        nodes: Array<{
          id: string;
          type: 'player' | 'draft_pick';
          name: string;
          position?: string;
          team?: string;
          depth: number;
          importance: number;
        }>;
        transactions: Array<{
          id: string;
          type: string;
          description: string;
          timestamp: string;
          season: string;
          assetsReceived: any[];
          assetsGiven: any[];
          managerFrom?: { id: string; username: string; displayName?: string; };
          managerTo?: { id: string; username: string; displayName?: string; };
        }>;
        connections: Array<{
          fromAsset: string;
          toAsset: string;
          transactionId: string;
          depth: number;
        }>;
      };
      stats: {
        totalNodes: number;
        totalTransactions: number;
        depthDistribution: Record<number, number>;
        transactionTypes: Record<string, number>;
        buildTimeMs: number;
      };
      filters?: {
        season?: string;
        transactionType?: string;
      };
      generatedAt: string;
    }>(url);
  },
};

export { ApiError };