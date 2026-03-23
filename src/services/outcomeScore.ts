/**
 * Manager Outcome Score (MOS)
 *
 * A 0-to-1 composite metric measuring how well a manager's season went.
 * Used as ground truth for experiment validation — better grading algorithms
 * should produce grades that correlate more strongly with MOS.
 *
 * Components (default weights):
 *   40% win percentage — most data-rich, least luck-dependent
 *   30% starter contribution — total starter points vs league best
 *   20% playoff advancement — rounds won / total playoff rounds
 *   10% championship result — champion, runner-up, semifinal loss
 */

import { getDb, schema } from "@/db";
import { eq } from "drizzle-orm";
import type { SleeperBracketMatchup } from "@/lib/sleeper";
import { extractBracketRosterIds } from "./gradingCore";

// ============================================================
// Types
// ============================================================

export interface MOSWeights {
  winPct: number;
  starter: number;
  playoff: number;
  champ: number;
}

export const DEFAULT_WEIGHTS: MOSWeights = {
  winPct: 0.4,
  starter: 0.3,
  playoff: 0.2,
  champ: 0.1,
};

export interface ManagerOutcomeScore {
  rosterId: number;
  leagueId: string;
  season: string;
  mos: number;
  components: {
    winPct: number;
    starterScore: number;
    playoffScore: number;
    champScore: number;
  };
}

export interface PlayoffResult {
  rosterId: number;
  roundsWon: number;
  totalRounds: number;
  /** 1 = champion, 2 = runner-up, 3-4 = semifinal loss, etc. */
  placement: number | null;
}

// ============================================================
// Bracket parsing
// ============================================================

/**
 * Parse a Sleeper winners bracket to determine playoff results per roster.
 *
 * The bracket is an array of matchups with round (r), winner (w), loser (l),
 * and optional placement (p) fields. We walk the bracket to count rounds won
 * per roster and determine final placement.
 */
export function parsePlayoffResults(
  bracket: SleeperBracketMatchup[],
  numPlayoffTeams: number,
): PlayoffResult[] {
  if (!bracket || bracket.length === 0) return [];

  const totalRounds = Math.ceil(Math.log2(Math.max(2, numPlayoffTeams)));

  const rosterIds = extractBracketRosterIds(bracket);

  // Track the highest round each roster advanced past.
  // A winner of round R advanced past R (they move to R+1).
  // A loser of round R was eliminated at R (advanced past R-1 rounds).
  // This correctly handles byes — a team with a bye in round 1
  // that wins in round 2 advanced past 2 rounds, same as totalRounds-1.
  const roundsAdvanced = new Map<number, number>();
  for (const id of rosterIds) {
    roundsAdvanced.set(id, 0);
  }

  for (const m of bracket) {
    // Skip consolation/placement matches (3rd place, 5th place, etc.)
    // These don't represent advancement in the championship bracket.
    // Championship match (p=1) and runner-up (p=2 via loss) still count.
    const isConsolation = m.p !== undefined && m.p !== null && m.p >= 3;
    if (isConsolation) continue;

    if (m.w !== null && m.w !== undefined) {
      const current = roundsAdvanced.get(m.w) ?? 0;
      roundsAdvanced.set(m.w, Math.max(current, m.r));
    }
    if (m.l !== null && m.l !== undefined) {
      const current = roundsAdvanced.get(m.l) ?? 0;
      roundsAdvanced.set(m.l, Math.max(current, m.r - 1));
    }
  }

  // Credit bye teams for advancing past the round(s) they skipped.
  // Detect as rosters whose first main-bracket appearance is round 2+.
  const firstAppearance = new Map<number, number>();
  for (const m of bracket) {
    const isConsolation = m.p !== undefined && m.p !== null && m.p >= 3;
    if (isConsolation) continue;
    for (const id of [m.t1, m.t2, m.w, m.l]) {
      if (typeof id === "number") {
        const current = firstAppearance.get(id) ?? Infinity;
        firstAppearance.set(id, Math.min(current, m.r));
      }
    }
  }
  for (const [id, firstRound] of firstAppearance) {
    if (firstRound > 1) {
      const current = roundsAdvanced.get(id) ?? 0;
      roundsAdvanced.set(id, Math.max(current, firstRound - 1));
    }
  }

  // Determine placement from bracket data
  // Sleeper sometimes provides `p` field, otherwise derive from bracket structure
  const placements = new Map<number, number>();

  // Check for explicit placement fields first
  for (const m of bracket) {
    if (m.p !== undefined && m.p !== null) {
      if (m.w !== null && m.w !== undefined) {
        // Winner of a placement match gets placement p
        placements.set(m.w, m.p);
      }
      if (m.l !== null && m.l !== undefined) {
        // Loser of a placement match gets p+1
        placements.set(m.l, m.p + 1);
      }
    }
  }

  // If no explicit placements, derive from bracket structure
  if (placements.size === 0) {
    // Find the final round (highest r value)
    const maxRound = Math.max(...bracket.map((m) => m.r));
    const finalMatch = bracket.find((m) => m.r === maxRound);

    if (finalMatch) {
      if (finalMatch.w !== null && finalMatch.w !== undefined) {
        placements.set(finalMatch.w, 1); // champion
      }
      if (finalMatch.l !== null && finalMatch.l !== undefined) {
        placements.set(finalMatch.l, 2); // runner-up
      }
    }

    // Semifinal losers (lost in round before final)
    const semiFinalMatches = bracket.filter((m) => m.r === maxRound - 1);
    for (const m of semiFinalMatches) {
      if (m.l !== null && m.l !== undefined && !placements.has(m.l)) {
        placements.set(m.l, 3); // semifinal loss (3rd-4th)
      }
    }
  }

  return Array.from(rosterIds).map((id) => ({
    rosterId: id,
    roundsWon: roundsAdvanced.get(id) ?? 0,
    totalRounds,
    placement: placements.get(id) ?? null,
  }));
}

/**
 * Convert a playoff placement to a championship score (0-1).
 */
function champScoreFromPlacement(placement: number | null): number {
  if (placement === null) return 0;
  if (placement === 1) return 1.0; // champion
  if (placement === 2) return 0.5; // runner-up
  if (placement <= 4) return 0.25; // semifinal loss
  return 0;
}

// ============================================================
// MOS computation
// ============================================================

/**
 * Compute MOS for all rosters in a single league.
 */
export async function computeLeagueMOS(
  leagueId: string,
  weights: MOSWeights = DEFAULT_WEIGHTS,
  dbOverride?: ReturnType<typeof getDb>,
): Promise<ManagerOutcomeScore[]> {
  const db = dbOverride ?? getDb();

  // Load league metadata
  const [league] = await db
    .select({
      id: schema.leagues.id,
      season: schema.leagues.season,
      settings: schema.leagues.settings,
      winnersBracket: schema.leagues.winnersBracket,
    })
    .from(schema.leagues)
    .where(eq(schema.leagues.id, leagueId));

  if (!league) return [];

  // Load rosters
  const rosters = await db
    .select({
      rosterId: schema.rosters.rosterId,
      wins: schema.rosters.wins,
      losses: schema.rosters.losses,
      ties: schema.rosters.ties,
    })
    .from(schema.rosters)
    .where(eq(schema.rosters.leagueId, leagueId));

  if (rosters.length === 0) return [];

  // Load matchups to compute starter point totals
  const matchups = await db
    .select({
      rosterId: schema.matchups.rosterId,
      starterPoints: schema.matchups.starterPoints,
    })
    .from(schema.matchups)
    .where(eq(schema.matchups.leagueId, leagueId));

  // Sum starter points per roster
  const starterTotals = new Map<number, number>();
  for (const m of matchups) {
    const pts = m.starterPoints as number[] | null;
    if (!pts) continue;
    const weekTotal = pts.reduce((sum, p) => sum + (p ?? 0), 0);
    starterTotals.set(
      m.rosterId,
      (starterTotals.get(m.rosterId) ?? 0) + weekTotal,
    );
  }

  const maxStarterTotal = Math.max(...starterTotals.values(), 1);

  // Parse playoff results
  const settings = league.settings as Record<string, unknown> | null;
  const numPlayoffTeams = (settings?.playoff_teams as number) ?? 6;
  const bracket = league.winnersBracket as SleeperBracketMatchup[] | null;

  const playoffResults = bracket && bracket.length > 0
    ? parsePlayoffResults(bracket, numPlayoffTeams)
    : [];

  const playoffMap = new Map(playoffResults.map((r) => [r.rosterId, r]));

  // Check if playoff/champ data is available
  const hasPlayoffData = playoffResults.length > 0;

  // Normalize weights if playoff data is missing
  let effectiveWeights = weights;
  if (!hasPlayoffData) {
    // Redistribute playoff + champ weight to winPct and starter
    const redistributed = weights.playoff + weights.champ;
    const remaining = weights.winPct + weights.starter;
    effectiveWeights = {
      winPct: weights.winPct + (redistributed * weights.winPct) / remaining,
      starter: weights.starter + (redistributed * weights.starter) / remaining,
      playoff: 0,
      champ: 0,
    };
  }

  return rosters.map((roster) => {
    const totalGames =
      (roster.wins ?? 0) + (roster.losses ?? 0) + (roster.ties ?? 0);
    const winPct =
      totalGames > 0
        ? ((roster.wins ?? 0) + (roster.ties ?? 0) * 0.5) / totalGames
        : 0;

    const starterScore =
      (starterTotals.get(roster.rosterId) ?? 0) / maxStarterTotal;

    const pr = playoffMap.get(roster.rosterId);
    const playoffScore = pr ? pr.roundsWon / pr.totalRounds : 0;
    const champScore = pr ? champScoreFromPlacement(pr.placement) : 0;

    const mos =
      effectiveWeights.winPct * winPct +
      effectiveWeights.starter * starterScore +
      effectiveWeights.playoff * playoffScore +
      effectiveWeights.champ * champScore;

    return {
      rosterId: roster.rosterId,
      leagueId,
      season: league.season,
      mos,
      components: { winPct, starterScore, playoffScore, champScore },
    };
  });
}

/**
 * Compute MOS for all leagues in a family (cross-season).
 */
export async function computeFamilyMOS(
  familyId: string,
  weights: MOSWeights = DEFAULT_WEIGHTS,
  dbOverride?: ReturnType<typeof getDb>,
): Promise<ManagerOutcomeScore[]> {
  const db = dbOverride ?? getDb();

  const members = await db
    .select({ leagueId: schema.leagueFamilyMembers.leagueId })
    .from(schema.leagueFamilyMembers)
    .where(eq(schema.leagueFamilyMembers.familyId, familyId));

  const allResults = await Promise.all(
    members.map((member) => computeLeagueMOS(member.leagueId, weights, db)),
  );

  return allResults.flat();
}
