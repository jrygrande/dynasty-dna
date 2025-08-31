import type { ApiResponse, LeagueSyncRequest, LeagueSyncResponse, TransactionChainNode } from '@/shared/types';

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
};

export { ApiError };