export interface ApiResponse<T = any> {
  data?: T;
  message?: string;
  error?: ApiError;
}

export interface ApiError {
  message: string;
  code: string;
  statusCode?: number;
  stack?: string;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface LeagueSyncRequest {
  leagueId: string;
  forceRefresh?: boolean;
}

export interface LeagueSyncResponse {
  leagueId: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  message: string;
  progress?: {
    current: number;
    total: number;
    step: string;
  };
}

export interface TransactionChainNode {
  id: string;
  type: 'player' | 'draft_pick';
  name: string;
  position?: string;
  team?: string;
  value?: string;
  children: TransactionChainNode[];
  transaction?: {
    id: string;
    type: string;
    timestamp: string;
    participants: string[];
    description: string;
  };
}

export interface PlayerPerformanceData {
  playerId: string;
  playerName: string;
  position: string;
  rosterHistory: {
    managerId: string;
    managerName: string;
    startDate: string;
    endDate?: string;
    acquisitionType: 'draft' | 'trade' | 'waiver' | 'free_agent';
    acquisitionDetails?: string;
  }[];
  fantasyPoints?: {
    total: number;
    byWeek: { week: number; points: number; starter: boolean }[];
    bySeason: { season: number; points: number; games: number }[];
  };
}