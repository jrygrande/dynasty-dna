import { create } from 'zustand';
import type { SleeperTransaction, TransactionChainNode } from '@/shared/types';

interface TransactionState {
  transactions: SleeperTransaction[];
  transactionChains: Record<string, TransactionChainNode>;
  selectedTransaction: SleeperTransaction | null;
  isLoading: boolean;
  error: string | null;

  setTransactions: (transactions: SleeperTransaction[]) => void;
  setTransactionChain: (playerId: string, chain: TransactionChainNode) => void;
  setSelectedTransaction: (transaction: SleeperTransaction | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearTransactionData: () => void;
}

export const useTransactionStore = create<TransactionState>((set) => ({
  transactions: [],
  transactionChains: {},
  selectedTransaction: null,
  isLoading: false,
  error: null,

  setTransactions: (transactions) => set({ transactions }),
  setTransactionChain: (playerId, chain) => 
    set((state) => ({
      transactionChains: {
        ...state.transactionChains,
        [playerId]: chain,
      },
    })),
  setSelectedTransaction: (selectedTransaction) => set({ selectedTransaction }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
  
  clearTransactionData: () => set({
    transactions: [],
    transactionChains: {},
    selectedTransaction: null,
    isLoading: false,
    error: null,
  }),
}));