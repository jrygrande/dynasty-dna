export interface DatabaseLeague {
  id: string;
  sleeperLeagueId: string;
  name: string;
  season: string; // Changed to string like API
  seasonType: string;
  status?: string;
  sport: string;
  totalRosters: number;
  rosterPositions: string; // JSON string
  scoringSettings: string; // JSON string
  previousLeagueId?: string;
  sleeperPreviousLeagueId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface DatabasePlayer {
  id: string;
  sleeperId: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  position?: string;
  team?: string;
  age?: number;
  yearsExp?: number;
  status?: string;
  injuryStatus?: string;
  number?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface DatabaseManager {
  id: string;
  sleeperUserId: string;
  username: string;
  displayName?: string;
  avatar?: string;
  teamName?: string;
  isOwner: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface DatabaseTransaction {
  id: string;
  leagueId: string;
  sleeperTransactionId: string;
  type: string;
  status: string;
  week?: number;
  leg?: number;
  timestamp: bigint; // Changed to bigint for millisecond timestamps
  creator?: string;
  consenterIds?: string; // JSON string
  rosterIds?: string; // JSON string
  metadata?: string; // JSON string
  createdAt: Date;
  updatedAt: Date;
}

export interface DatabaseTransactionItem {
  id: string;
  transactionId: string;
  managerId?: string;
  playerId?: string;
  draftPickId?: string;
  faabAmount?: number;
  type: string;
  createdAt: Date;
}

export interface DatabaseRoster {
  id: string;
  leagueId: string;
  managerId: string;
  sleeperRosterId: number;
  week?: number;
  wins: number;
  losses: number;
  ties: number;
  fpts: number;
  fptsAgainst: number;
  fptsDecimal?: number;
  fptsAgainstDecimal?: number;
  waiveBudgetUsed: number;
  waiverPosition?: number;
  totalMoves: number;
  division?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface DatabaseDraftPick {
  id: string;
  leagueId: string;
  originalOwnerId: string;
  currentOwnerId: string;
  previousOwnerId?: string; // Added for three-way tracking
  season: string; // Changed to string
  round: number;
  pickNumber?: number;
  playerSelectedId?: string;
  traded: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface DatabaseDraft {
  id: string;
  leagueId: string;
  sleeperDraftId: string;
  season: string;
  seasonType: string;
  status: string;
  sport: string;
  rounds: number;
  draftType: string;
  startTime?: bigint;
  lastPicked?: bigint;
  created?: bigint;
  draftOrder?: string; // JSON string
  settings?: string; // JSON string
  createdAt: Date;
  updatedAt: Date;
}

export interface DatabaseDraftSelection {
  id: string;
  draftId: string;
  pickNumber: number;
  round: number;
  draftSlot: number;
  playerId: string;
  rosterId: number;
  pickedBy: string;
  isKeeper?: boolean;
  metadata?: string; // JSON string
  createdAt: Date;
}

export interface DatabaseTransactionDraftPick {
  id: string;
  transactionId: string;
  draftPickId?: string;
  season: string;
  round: number;
  rosterId: number;
  ownerId: number;
  previousOwnerId?: number;
  createdAt: Date;
}

export interface DatabaseNFLState {
  id: string;
  season: string;
  seasonType: string;
  week: number;
  leg: number;
  previousSeason: string;
  seasonStartDate: string;
  displayWeek: number;
  leagueSeason: string;
  leagueCreateSeason: string;
  seasonHasScores: boolean;
  lastUpdated: Date;
  updatedAt: Date;
}

export interface DatabasePlayerWeeklyScore {
  id: string;
  leagueId: string;
  playerId: string;
  rosterId: number;
  week: number;
  season: string;
  points: number;
  isStarter: boolean;
  position?: string;
  matchupId?: number;
  createdAt: Date;
}

export interface DatabaseMatchupResult {
  id: string;
  leagueId: string;
  rosterId: number;
  week: number;
  season: string;
  matchupId: number;
  totalPoints: number;
  opponentId?: number;
  won?: boolean;
  createdAt: Date;
}