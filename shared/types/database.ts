export interface DatabaseLeague {
  id: string;
  sleeperLeagueId: string;
  name: string;
  year: number;
  totalRosters: number;
  rosterPositions: string[];
  scoringSettings: Record<string, number>;
  previousLeagueId?: string;
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
  createdAt: Date;
  updatedAt: Date;
}

export interface DatabaseManager {
  id: string;
  sleeperUserId: string;
  username: string;
  displayName?: string;
  avatar?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface DatabaseTransaction {
  id: string;
  leagueId: string;
  type: string;
  status: string;
  week?: number;
  timestamp: Date;
  metadata?: Record<string, any>;
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
  week?: number;
  wins: number;
  losses: number;
  ties: number;
  fpts: number;
  fptsAgainst: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface DatabaseDraftPick {
  id: string;
  leagueId: string;
  originalOwnerId: string;
  currentOwnerId: string;
  year: number;
  round: number;
  pickNumber?: number;
  playerSelectedId?: string;
  traded: boolean;
  createdAt: Date;
  updatedAt: Date;
}