// ============================================================
// Optimal Lineup Solver
// ============================================================
// Given a set of players with points and a list of roster position slots,
// finds the highest-scoring valid lineup using greedy positional assignment.

const FLEX_ELIGIBILITY: Record<string, string[]> = {
  FLEX: ["RB", "WR", "TE"],
  SUPER_FLEX: ["QB", "RB", "WR", "TE"],
  REC_FLEX: ["WR", "TE"],
};

const NON_SCORING_SLOTS = new Set(["BN", "IR", "TAXI"]);

export interface OptimalLineupResult {
  optimalPoints: number;
  optimalStarters: string[];
}

/**
 * Solve the optimal lineup given player points, positions, and roster slot configuration.
 *
 * Algorithm:
 * 1. Separate roster slots into specific (QB, RB, etc.) and flex (FLEX, SUPER_FLEX, REC_FLEX)
 * 2. Sort players by points descending
 * 3. Fill specific slots first (highest scorers get priority)
 * 4. Fill flex slots with remaining eligible players
 */
export function solveOptimalLineup(
  playerPoints: Record<string, number>,
  playerPositions: Record<string, string>,
  rosterPositions: string[],
): OptimalLineupResult {
  // Separate scoring slots into specific and flex
  const specificSlots: string[] = [];
  const flexSlots: string[] = [];

  for (const slot of rosterPositions) {
    if (NON_SCORING_SLOTS.has(slot)) continue;
    if (FLEX_ELIGIBILITY[slot]) {
      flexSlots.push(slot);
    } else {
      specificSlots.push(slot);
    }
  }

  // Sort players by points descending
  const sortedPlayers = Object.entries(playerPoints)
    .filter(([, pts]) => pts > 0)
    .sort(([, a], [, b]) => b - a);

  const assigned = new Set<string>();
  const starters: string[] = [];

  // Count how many of each specific slot we need
  const slotCounts = new Map<string, number>();
  for (const slot of specificSlots) {
    slotCounts.set(slot, (slotCounts.get(slot) || 0) + 1);
  }

  // Fill specific slots: for each slot type, assign best available matching players
  for (const [slot, count] of slotCounts) {
    let filled = 0;
    for (const [playerId] of sortedPlayers) {
      if (filled >= count) break;
      if (assigned.has(playerId)) continue;
      const pos = playerPositions[playerId];
      if (pos === slot) {
        assigned.add(playerId);
        starters.push(playerId);
        filled++;
      }
    }
  }

  // Fill flex slots with remaining eligible players
  for (const flexSlot of flexSlots) {
    const eligible = FLEX_ELIGIBILITY[flexSlot];
    if (!eligible) continue;

    let filled = false;
    for (const [playerId] of sortedPlayers) {
      if (filled) break;
      if (assigned.has(playerId)) continue;
      const pos = playerPositions[playerId];
      if (pos && eligible.includes(pos)) {
        assigned.add(playerId);
        starters.push(playerId);
        filled = true;
      }
    }
  }

  const optimalPoints = starters.reduce(
    (sum, pid) => sum + (playerPoints[pid] || 0),
    0,
  );

  return { optimalPoints, optimalStarters: starters };
}
