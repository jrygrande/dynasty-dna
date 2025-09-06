// Re-export backend types for frontend use
export interface AssetNode {
  id: string;
  type: 'player' | 'draft_pick';
  sleeperId?: string;
  season?: string;
  round?: number;
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
  type: string;
  status: string;
  week?: number;
  season: string;
  leagueName: string;
  timestamp: string;
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

export interface TransactionGraph {
  nodes: Map<string, AssetNode>;
  edges: Map<string, string[]>;
  chains: Map<string, TransactionNode>;
}

export interface AssetTradeTree {
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
  derivedAssets: AssetTradeTree[];
}

export interface TransactionGraphFilters {
  season?: string;
  transactionType?: string;
  managerId?: string;
  format?: 'json' | 'stats';
}