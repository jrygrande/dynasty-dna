import { create } from 'zustand';
import type { SleeperLeague, SleeperRoster, SleeperUser } from '@/shared/types';

interface LeagueState {
  currentLeague: SleeperLeague | null;
  rosters: SleeperRoster[];
  users: SleeperUser[];
  isLoading: boolean;
  error: string | null;
  
  setCurrentLeague: (league: SleeperLeague | null) => void;
  setRosters: (rosters: SleeperRoster[]) => void;
  setUsers: (users: SleeperUser[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearLeagueData: () => void;
}

export const useLeagueStore = create<LeagueState>((set) => ({
  currentLeague: null,
  rosters: [],
  users: [],
  isLoading: false,
  error: null,

  setCurrentLeague: (league) => set({ currentLeague: league }),
  setRosters: (rosters) => set({ rosters }),
  setUsers: (users) => set({ users }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
  
  clearLeagueData: () => set({
    currentLeague: null,
    rosters: [],
    users: [],
    isLoading: false,
    error: null,
  }),
}));