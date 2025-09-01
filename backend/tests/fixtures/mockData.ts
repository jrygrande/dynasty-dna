// Mock data for testing

export const mockNFLState = {
  season: '2025',
  week: 1,
  season_type: 'regular',
  previous_season: '2024'
};

export const mockUser = {
  user_id: '233789917321228288',
  username: 'testuser',
  display_name: 'Test User',
  avatar: null
};

export const mockLeague = {
  league_id: '1191596293294166016',
  name: 'Test Dynasty League',
  season: '2025',
  season_type: 'regular',
  status: 'in_season',
  sport: 'nfl',
  total_rosters: 12,
  roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN'],
  scoring_settings: {
    pass_yd: 0.04,
    pass_td: 4,
    rush_yd: 0.1,
    rush_td: 6,
    rec_yd: 0.1,
    rec_td: 6,
    rec: 1
  },
  previous_league_id: '1051592789462589440'
};

export const mockTransaction = {
  transaction_id: '1240509436661858304',
  type: 'trade',
  status: 'complete',
  creator: '233789917321228288',
  created: 1750128694014,
  roster_ids: [1, 10],
  consenter_ids: [1, 10],
  adds: {
    '9229': 10, // Anthony Richardson to roster 10
    '11640': 1  // Jermaine Burton to roster 1
  },
  drops: {
    '9229': 1,  // Anthony Richardson from roster 1
    '11640': 10 // Jermaine Burton from roster 10
  },
  draft_picks: [],
  waiver_budget: [],
  metadata: {},
  settings: null
};

export const mockPlayer = {
  player_id: '9229',
  first_name: 'Anthony',
  last_name: 'Richardson',
  full_name: 'Anthony Richardson',
  position: 'QB',
  team: 'IND',
  age: 23,
  years_exp: 2,
  status: 'Active',
  injury_status: null,
  number: '5'
};

export const mockRoster = {
  roster_id: 1,
  owner_id: '233789917321228288',
  players: ['9229', '4881', '6938'],
  settings: {
    wins: 7,
    losses: 7,
    ties: 0,
    fpts: 1857.65,
    fpts_against: 1966.67,
    fpts_decimal: 65,
    fpts_against_decimal: 67,
    waiver_budget_used: 200,
    waiver_position: 3,
    total_moves: 15,
    division: 1
  }
};

export const mockMatchup = {
  roster_id: 1,
  matchup_id: 1,
  points: 123.45,
  players: ['9229', '4881'],
  players_points: {
    '9229': 18.5,
    '4881': 24.8
  },
  starters: ['9229', '4881'],
  starters_points: [18.5, 24.8]
};

export const mockDraftPick = {
  season: '2025',
  round: 1,
  roster_id: 1,
  previous_owner_id: null,
  owner_id: 1
};

// Test helper functions
export const createMockLeagueWithHistory = (seasons: string[]) => {
  return seasons.map((season, index) => ({
    ...mockLeague,
    league_id: `test_league_${season}`,
    season,
    previous_league_id: index > 0 ? `test_league_${seasons[index - 1]}` : null
  }));
};

export const createMockTransactionChain = (playerId: string, steps: number) => {
  const chain = [];
  for (let i = 0; i < steps; i++) {
    chain.push({
      ...mockTransaction,
      transaction_id: `test_transaction_${i}`,
      created: Date.now() - (steps - i) * 86400000, // One day apart
      adds: { [playerId]: i % 2 === 0 ? 1 : 2 },
      drops: { [playerId]: i % 2 === 0 ? 2 : 1 }
    });
  }
  return chain;
};