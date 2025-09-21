export interface PerformanceMetrics {
  ppg: number;
  starterPct: number;
  ppgStarter: number;
  ppgBench: number;
  gamesPlayed: number;
  gamesStarted: number;
}

export interface PerformancePeriod {
  fromEvent: string; // event ID
  toEvent: string | null; // null = current
  leagueId: string;
  season: string;
  rosterId: number;
  ownerUserId: string;
  startWeek: number;
  endWeek: number | null;
  metrics: PerformanceMetrics;
  isContinuation?: boolean; // true if this period continues from previous season without transaction
  bySeasons?: Array<{
    season: string;
    leagueId: string;
    metrics: PerformanceMetrics;
  }>;
}

export interface PlayerScore {
  leagueId: string;
  week: number;
  rosterId: number;
  playerId: string;
  points: string; // stored as string in DB, converted to number for calculations
  isStarter: boolean;
}