export interface SleeperLeague {
  league_id: string;
  name: string;
  season: string;
  status: 'pre_draft' | 'drafting' | 'in_season' | 'complete';
  sport: string;
  season_type: string;
  total_rosters: number;
  roster_positions: string[];
  scoring_settings: Record<string, number>;
  previous_league_id?: string;
  settings?: {
    max_keepers?: number;
    draft_rounds?: number;
    trade_deadline?: number;
    playoff_week_start?: number;
    num_teams?: number;
  };
}

export interface SleeperUser {
  user_id: string;
  username: string;
  display_name?: string;
  avatar?: string;
}

export interface SleeperRoster {
  roster_id: number;
  owner_id: string;
  players: string[];
  starters: string[];
  reserve?: string[];
  taxi?: string[];
  settings: {
    wins: number;
    losses: number;
    ties: number;
    fpts: number;
    fpts_against: number;
    fpts_decimal?: number;
    fpts_against_decimal?: number;
  };
}

export interface SleeperTransaction {
  transaction_id: string;
  type: 'trade' | 'waiver' | 'free_agent' | 'commissioner';
  status: 'complete' | 'failed';
  creator: string;
  created: number;
  roster_ids: number[];
  consenter_ids?: number[];
  week?: number;
  adds?: Record<string, number>;
  drops?: Record<string, number>;
  draft_picks?: SleeperDraftPick[];
  waiver_budget?: SleeperWaiverBudget[];
  settings?: Record<string, any>;
  metadata?: Record<string, any>;
}

export interface SleeperDraftPick {
  season: string;
  round: number;
  roster_id: number;
  previous_owner_id: number;
  owner_id: number;
}

export interface SleeperWaiverBudget {
  sender: number;
  receiver: number;
  amount: number;
}

export interface SleeperPlayer {
  player_id: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  position: string;
  team?: string;
  age?: number;
  years_exp?: number;
  status?: 'Active' | 'Inactive' | 'Injured Reserve' | 'Reserve/COVID-19' | 'Suspended';
  injury_status?: string;
  height?: string;
  weight?: string;
  birth_date?: string;
  college?: string;
  fantasy_data_id?: number;
  rotowire_id?: number;
  stats_id?: number;
  sportradar_id?: string;
  yahoo_id?: number;
}