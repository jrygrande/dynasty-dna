import { config } from '../config';
import NodeCache from 'node-cache';
// Define types locally to avoid import path issues
interface SleeperLeague {
  league_id?: string;
  name: string;
  season: string;
  season_type?: string;
  status?: string;
  sport?: string;
  total_rosters: number;
  roster_positions?: string[];
  scoring_settings?: Record<string, any>;
  previous_league_id?: string;
}

interface SleeperUser {
  user_id: string;
  username?: string;
  display_name?: string;
  avatar?: string;
}

interface SleeperRoster {
  roster_id: number;
  owner_id: string;
  players?: string[];
  starters?: string[];
  settings?: {
    wins?: number;
    losses?: number;
    ties?: number;
    fpts?: number;
    fpts_against?: number;
    fpts_decimal?: number;
    fpts_against_decimal?: number;
    waiver_budget_used?: number;
    waiver_position?: number;
    total_moves?: number;
    division?: number;
  };
}

export interface SleeperTransaction {
  transaction_id: string;
  type: string;
  status: string;
  leg: number;
  status_updated: number;
  creator?: string;
  consenter_ids?: number[];
  roster_ids?: number[];
  metadata?: Record<string, any>;
  adds?: Record<string, number>;
  drops?: Record<string, number>;
  waiver_budget?: Record<string, number>;
  draft_picks?: SleeperDraftPick[];
}

interface SleeperDraftPick {
  season: string;
  round: number;
  roster_id: number; // original owner's roster_id
  previous_owner_id?: number; // previous owner's roster id (in this trade)
  owner_id: number; // the new owner of this pick after the trade
}

interface SleeperPlayer {
  first_name?: string;
  last_name?: string;
  full_name?: string;
  position?: string;
  team?: string;
  age?: number;
  years_exp?: number;
  status?: string;
  injury_status?: string;
  number?: number;
}

export class SleeperAPIError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public endpoint?: string
  ) {
    super(message);
    this.name = 'SleeperAPIError';
  }
}

export interface NFLState {
  week: number;
  leg: number;
  season: string;
  season_type: string;
  league_season: string;
  previous_season: string;
  season_start_date: string;
  display_week: number;
  league_create_season: string;
  season_has_scores: boolean;
}

export interface DraftInfo {
  draft_id: string;
  season: string;
  season_type: string;
  status: string;
  sport: string;
  rounds: number;
  type: string;
  start_time?: number;
  last_picked?: number;
  created?: number;
  draft_order?: Record<string, number>;
  settings?: Record<string, any>;
  league_id: string;
}

export interface DraftSelection {
  draft_id: string;
  pick_no: number;
  round: number;
  draft_slot: number;
  roster_id: number;
  player_id: string;
  picked_by: string;
  is_keeper?: boolean;
  metadata?: Record<string, any>;
}

export interface TradedPick {
  season: string;
  round: number;
  roster_id: number; // Original owner
  owner_id: number; // Current owner
  previous_owner_id?: number; // Who traded it most recently
}

export interface SleeperMatchup {
  roster_id: number;
  matchup_id?: number;
  points: number;
  players_points?: Record<string, number>; // Individual player fantasy points!
  starters?: string[]; // Player IDs of starters
  players?: string[]; // All player IDs on roster
  custom_points?: number;
}

export interface PlayerWeeklyScore {
  playerId: string;
  rosterId: number;
  week: number;
  points: number;
  isStarter: boolean;
  matchupId?: number;
}

class SleeperClient {
  private cache: NodeCache;
  private lastRequestTime = 0;

  constructor() {
    // Cache for 1 hour by default, with statistics tracking enabled
    this.cache = new NodeCache({ 
      stdTTL: 3600,
      useClones: false,
      checkperiod: 600
    });
  }

  /**
   * Rate limiting: Enforce minimum delay between requests
   */
  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    const minDelay = config.apiRateLimitDelayMs;

    if (timeSinceLastRequest < minDelay) {
      const waitTime = minDelay - timeSinceLastRequest;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    this.lastRequestTime = Date.now();
  }

  /**
   * Make a request to the Sleeper API with rate limiting and caching
   */
  private async request<T>(
    endpoint: string,
    cacheKey?: string,
    cacheTTL?: number
  ): Promise<T> {
    // Check cache first
    if (cacheKey) {
      const cached = this.cache.get<T>(cacheKey);
      if (cached !== undefined) {
        return cached;
      }
    }

    await this.enforceRateLimit();

    const url = `${config.sleeperApiBaseUrl}${endpoint}`;
    
    try {
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new SleeperAPIError(
          `API request failed: ${response.status} ${response.statusText}`,
          response.status,
          endpoint
        );
      }

      const data = await response.json() as T;

      // Cache the result if cache key provided
      if (cacheKey) {
        this.cache.set(cacheKey, data, cacheTTL || 3600);
      }

      return data;
    } catch (error) {
      if (error instanceof SleeperAPIError) {
        throw error;
      }
      throw new SleeperAPIError(
        `Network error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        undefined,
        endpoint
      );
    }
  }

  /**
   * Get current NFL state for timing context
   */
  async getNFLState(): Promise<NFLState> {
    return this.request<NFLState>(
      '/state/nfl',
      'nfl-state',
      300 // Cache for 5 minutes
    );
  }

  /**
   * Get user information by username or user ID
   */
  async getUser(identifier: string): Promise<SleeperUser | null> {
    try {
      return await this.request<SleeperUser>(
        `/user/${identifier}`,
        `user-${identifier}`,
        3600 // Cache for 1 hour
      );
    } catch (error) {
      if (error instanceof SleeperAPIError && error.statusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Get all leagues for a user in a specific season
   */
  async getUserLeagues(userId: string, season: string): Promise<Array<SleeperLeague & { league_id: string }>> {
    const response = await this.request<Record<string, SleeperLeague>>(
      `/user/${userId}/leagues/nfl/${season}`,
      `user-leagues-${userId}-${season}`,
      1800 // Cache for 30 minutes
    );
    
    // Convert keyed object to array with league_id included
    return Object.entries(response).map(([leagueId, league]) => ({
      ...league,
      league_id: leagueId
    }));
  }

  /**
   * Get specific league information
   */
  async getLeague(leagueId: string): Promise<SleeperLeague | null> {
    try {
      return await this.request<SleeperLeague>(
        `/league/${leagueId}`,
        `league-${leagueId}`,
        3600 // Cache for 1 hour
      );
    } catch (error) {
      if (error instanceof SleeperAPIError && error.statusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Get all rosters for a league
   */
  async getLeagueRosters(leagueId: string): Promise<SleeperRoster[]> {
    return this.request<SleeperRoster[]>(
      `/league/${leagueId}/rosters`,
      `rosters-${leagueId}`,
      1800 // Cache for 30 minutes
    );
  }

  /**
   * Get all users in a league
   */
  async getLeagueUsers(leagueId: string): Promise<SleeperUser[]> {
    return this.request<SleeperUser[]>(
      `/league/${leagueId}/users`,
      `users-${leagueId}`,
      3600 // Cache for 1 hour
    );
  }

  /**
   * Get transactions for a specific week in a league
   */
  async getLeagueTransactions(leagueId: string, week: number): Promise<SleeperTransaction[]> {
    const currentWeek = await this.getCurrentWeek();
    const cacheTTL = week === currentWeek ? 300 : 86400; // 5 min for current week, 24h for past weeks

    return this.request<SleeperTransaction[]>(
      `/league/${leagueId}/transactions/${week}`,
      `transactions-${leagueId}-${week}`,
      cacheTTL
    );
  }

  /**
   * Get all transactions for a league across all weeks (1-18)
   */
  async getAllLeagueTransactions(leagueId: string): Promise<SleeperTransaction[]> {
    const allTransactions: SleeperTransaction[] = [];
    
    // Fetch transactions for all weeks (1-18 covers regular season + playoffs)
    for (let week = 1; week <= 18; week++) {
      try {
        const weekTransactions = await this.getLeagueTransactions(leagueId, week);
        allTransactions.push(...weekTransactions);
      } catch (error) {
        // Log error but continue with other weeks
        console.warn(`Failed to fetch transactions for week ${week}:`, error);
      }
    }

    return allTransactions;
  }

  /**
   * Get traded picks for a league
   */
  async getLeagueTradedPicks(leagueId: string): Promise<TradedPick[]> {
    return this.request<TradedPick[]>(
      `/league/${leagueId}/traded_picks`,
      `traded-picks-${leagueId}`,
      3600 // Cache for 1 hour
    );
  }

  /**
   * Get drafts for a league
   */
  async getLeagueDrafts(leagueId: string): Promise<DraftInfo[]> {
    return this.request<DraftInfo[]>(
      `/league/${leagueId}/drafts`,
      `drafts-${leagueId}`,
      86400 // Cache for 24 hours
    );
  }

  /**
   * Get specific draft information
   */
  async getDraft(draftId: string): Promise<DraftInfo> {
    return this.request<DraftInfo>(
      `/draft/${draftId}`,
      `draft-${draftId}`,
      86400 // Cache for 24 hours
    );
  }

  /**
   * Get draft picks (actual selections)
   */
  async getDraftPicks(draftId: string): Promise<DraftSelection[]> {
    return this.request<DraftSelection[]>(
      `/draft/${draftId}/picks`,
      `draft-picks-${draftId}`,
      86400 // Cache for 24 hours
    );
  }

  /**
   * Get traded picks for a specific draft
   */
  async getDraftTradedPicks(draftId: string): Promise<TradedPick[]> {
    return this.request<TradedPick[]>(
      `/draft/${draftId}/traded_picks`,
      `draft-traded-picks-${draftId}`,
      86400 // Cache for 24 hours
    );
  }

  /**
   * Get all NFL players (warning: large response ~5MB)
   */
  async getAllPlayers(): Promise<Record<string, SleeperPlayer>> {
    return this.request<Record<string, SleeperPlayer>>(
      '/players/nfl',
      'all-players',
      86400 // Cache for 24 hours
    );
  }

  /**
   * Helper method to get current week from NFL state
   */
  private async getCurrentWeek(): Promise<number> {
    const nflState = await this.getNFLState();
    return nflState.week;
  }

  /**
   * Get matchups for a specific week (includes individual player fantasy points!)
   */
  async getLeagueMatchups(leagueId: string, week: number): Promise<SleeperMatchup[]> {
    const currentWeek = await this.getCurrentWeek();
    const cacheTTL = week === currentWeek ? 300 : 86400; // 5 min for current week, 24h for past weeks

    return this.request<SleeperMatchup[]>(
      `/league/${leagueId}/matchups/${week}`,
      `matchups-${leagueId}-${week}`,
      cacheTTL
    );
  }

  /**
   * Get all matchups for a league across all weeks (1-18)
   */
  async getAllLeagueMatchups(leagueId: string): Promise<SleeperMatchup[]> {
    const allMatchups: SleeperMatchup[] = [];
    
    // Fetch matchups for all weeks (1-18 covers regular season + playoffs)
    for (let week = 1; week <= 18; week++) {
      try {
        const weekMatchups = await this.getLeagueMatchups(leagueId, week);
        allMatchups.push(...weekMatchups);
      } catch (error) {
        // Log error but continue with other weeks
        console.warn(`Failed to fetch matchups for week ${week}:`, error);
      }
    }

    return allMatchups;
  }

  /**
   * Get player weekly scoring data for a specific week
   */
  async getPlayerWeeklyScores(leagueId: string, week: number): Promise<PlayerWeeklyScore[]> {
    const matchups = await this.getLeagueMatchups(leagueId, week);
    const playerScores: PlayerWeeklyScore[] = [];

    for (const matchup of matchups) {
      const { roster_id, players_points, starters, matchup_id } = matchup;

      if (players_points) {
        for (const [playerId, points] of Object.entries(players_points)) {
          const isStarter = starters?.includes(playerId) ?? false;
          
          playerScores.push({
            playerId,
            rosterId: roster_id,
            week,
            points,
            isStarter,
            matchupId: matchup_id
          });
        }
      }
    }

    return playerScores;
  }

  /**
   * Get all player weekly scoring data for a league across all weeks
   */
  async getAllPlayerWeeklyScores(leagueId: string): Promise<PlayerWeeklyScore[]> {
    const allPlayerScores: PlayerWeeklyScore[] = [];
    
    for (let week = 1; week <= 18; week++) {
      try {
        const weekPlayerScores = await this.getPlayerWeeklyScores(leagueId, week);
        allPlayerScores.push(...weekPlayerScores);
      } catch (error) {
        console.warn(`Failed to fetch player scores for week ${week}:`, error);
      }
    }

    return allPlayerScores;
  }

  /**
   * Clear all cached data (useful for testing or manual refresh)
   */
  clearCache(): void {
    this.cache.flushAll();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { keys: number; hits: number; misses: number } {
    return this.cache.getStats();
  }
}

// Export singleton instance
export const sleeperClient = new SleeperClient();