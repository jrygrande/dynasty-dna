/**
 * FantasyCalc API client for dynasty player trade values.
 *
 * Values are calculated from ~1 million real fantasy football trades.
 * Endpoint: https://api.fantasycalc.com/values/current
 */

const BASE_URL = "https://api.fantasycalc.com";

export interface FantasyCalcPlayer {
  player: {
    name: string;
    position: string;
    maybeTeam: string | null;
    maybeBirthDate: string | null;
    espnId: number | null;
    yahooId: number | null;
    sleeperId: string | null;
  };
  value: number;
  overallRank: number;
  positionRank: number;
  redraftValue: number;
  combinedValue: number;
  trend30Day: number;
}

export interface FantasyCalcOptions {
  isDynasty?: boolean;
  numQbs?: number; // 1 for 1QB, 2 for superflex
  numTeams?: number;
  ppr?: number; // 0, 0.5, 1
}

export async function getFantasyCalcValues(
  opts: FantasyCalcOptions = {}
): Promise<FantasyCalcPlayer[]> {
  const params = new URLSearchParams({
    isDynasty: String(opts.isDynasty ?? true),
    numQbs: String(opts.numQbs ?? 1),
    numTeams: String(opts.numTeams ?? 12),
    ppr: String(opts.ppr ?? 0.5),
  });

  const res = await fetch(`${BASE_URL}/values/current?${params}`);
  if (!res.ok) {
    throw new Error(`FantasyCalc API error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}
