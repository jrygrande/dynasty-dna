import { getDb, schema } from "@/db";
import { eq, and, inArray } from "drizzle-orm";
import { solveOptimalLineup } from "@/lib/lineup";

// ============================================================
// Configuration
// ============================================================

const SLOT_SCORES = {
  followedGood: 1.0, // correct & smart
  followedBad: 0.3, // smart but unlucky
  brokeGood: 2.0, // insightful call
  brokeBad: -0.5, // bad gut call
};

const GRADE_THRESHOLDS: Record<string, number> = {
  "A+": 95,
  A: 90,
  "B+": 85,
  B: 80,
  C: 70,
  D: 60,
  "D-": 50,
};

const ROLLING_WINDOW = 4;

function scoreToGrade(score: number): string {
  if (score >= GRADE_THRESHOLDS["A+"]) return "A+";
  if (score >= GRADE_THRESHOLDS["A"]) return "A";
  if (score >= GRADE_THRESHOLDS["B+"]) return "B+";
  if (score >= GRADE_THRESHOLDS["B"]) return "B";
  if (score >= GRADE_THRESHOLDS["C"]) return "C";
  if (score >= GRADE_THRESHOLDS["D"]) return "D";
  if (score >= GRADE_THRESHOLDS["D-"]) return "D-";
  return "F";
}

// ============================================================
// Types
// ============================================================

export interface WeekGrade {
  week: number;
  score: number;
  actualPoints: number;
  optimalPoints: number;
  efficiency: number;
  pointsLeftOnBench: number;
  slotBreakdown: {
    followedGood: number;
    followedBad: number;
    brokeGood: number;
    brokeBad: number;
  };
}

export interface RosterLineupGrade {
  rosterId: number;
  ownerId: string;
  score: number;
  efficiency: number;
  totalPointsLeftOnBench: number;
  perfectWeeks: number;
  insightfulStarts: number;
  grade: string;
  weeks: WeekGrade[];
}

// ============================================================
// Rolling average computation
// ============================================================

/**
 * Build rolling 4-week PPG averages for each player per week.
 * Only weeks where the player was NFL-active are included in the window.
 * Returns: Map<"leagueId:week:playerId", number>
 *
 * For early weeks, uses carry-over data from `prevMatchups`.
 */
function buildRollingAverages(
  matchups: Array<{
    leagueId: string;
    week: number;
    rosterId: number;
    playerPoints: Record<string, number> | null;
  }>,
  prevMatchups: Array<{
    leagueId: string;
    week: number;
    rosterId: number;
    playerPoints: Record<string, number> | null;
  }>,
  leagueId: string,
  prevLeagueId: string | null,
  activeWeeks: Set<string>, // set of "playerId:season:week" keys where player was NFL-active
  leagueSeasons: Map<string, number>, // leagueId → season year
): Map<string, number> {
  // Collect all weekly points per player across both leagues
  // Only include weeks where the player was NFL-active
  // key: playerId, value: sorted array of { leagueId, week, points }
  const playerWeeklyPoints = new Map<
    string,
    Array<{ leagueId: string; week: number; points: number }>
  >();

  const addMatchupData = (
    rows: typeof matchups,
  ) => {
    for (const m of rows) {
      if (!m.playerPoints) continue;
      const season = leagueSeasons.get(m.leagueId);
      for (const [playerId, pts] of Object.entries(m.playerPoints)) {
        // Only include weeks where the player was NFL-active
        if (season !== undefined) {
          const activeKey = `${playerId}:${season}:${m.week}`;
          if (!activeWeeks.has(activeKey)) continue;
        }

        if (!playerWeeklyPoints.has(playerId)) {
          playerWeeklyPoints.set(playerId, []);
        }
        // Avoid duplicate entries
        const arr = playerWeeklyPoints.get(playerId)!;
        const existing = arr.find(
          (e) => e.leagueId === m.leagueId && e.week === m.week,
        );
        if (!existing) {
          arr.push({ leagueId: m.leagueId, week: m.week, points: pts });
        }
      }
    }
  };

  addMatchupData(prevMatchups);
  addMatchupData(matchups);

  // Build an ordered timeline: prev league weeks come first, then current
  // We need a way to define ordering across leagues
  // prevLeague weeks are "before" current league weeks
  const weekOrder = (lid: string, week: number): number => {
    if (lid === prevLeagueId) return week; // prev league: weeks 1-18
    return 100 + week; // current league: 101-118
  };

  // Sort each player's entries by timeline order
  for (const [, entries] of playerWeeklyPoints) {
    entries.sort((a, b) => weekOrder(a.leagueId, a.week) - weekOrder(b.leagueId, b.week));
  }

  // For each current-league week, compute rolling 4-week avg from prior weeks
  const result = new Map<string, number>();
  const currentWeeks = new Set(
    matchups.filter((m) => m.leagueId === leagueId).map((m) => m.week),
  );

  for (const week of currentWeeks) {
    const currentOrder = weekOrder(leagueId, week);

    for (const [playerId, entries] of playerWeeklyPoints) {
      // Get entries before this week
      const priorEntries = entries.filter(
        (e) => weekOrder(e.leagueId, e.week) < currentOrder,
      );

      if (priorEntries.length === 0) {
        // No history → 0 PPG
        result.set(`${leagueId}:${week}:${playerId}`, 0);
        continue;
      }

      // Take last ROLLING_WINDOW entries
      const window = priorEntries.slice(-ROLLING_WINDOW);
      const avg =
        window.reduce((sum, e) => sum + e.points, 0) / window.length;
      result.set(`${leagueId}:${week}:${playerId}`, avg);
    }
  }

  return result;
}

// ============================================================
// Main grading function
// ============================================================

export async function gradeLeagueLineups(
  leagueId: string,
): Promise<RosterLineupGrade[]> {
  const db = getDb();

  // 1. Load league settings
  const [league] = await db
    .select({
      rosterPositions: schema.leagues.rosterPositions,
      previousLeagueId: schema.leagues.previousLeagueId,
      season: schema.leagues.season,
    })
    .from(schema.leagues)
    .where(eq(schema.leagues.id, leagueId))
    .limit(1);

  if (!league) {
    console.warn(`[lineupGrading] League ${leagueId} not found`);
    return [];
  }

  const rosterPositions = (league.rosterPositions as string[]) || [];
  if (rosterPositions.length === 0) return [];

  // 2. Load matchups for this league
  const currentMatchups = await db
    .select({
      leagueId: schema.matchups.leagueId,
      week: schema.matchups.week,
      rosterId: schema.matchups.rosterId,
      points: schema.matchups.points,
      starters: schema.matchups.starters,
      playerPoints: schema.matchups.playerPoints,
    })
    .from(schema.matchups)
    .where(eq(schema.matchups.leagueId, leagueId));

  if (currentMatchups.length === 0) return [];

  // 3. Load previous league matchups (last 4 weeks) for early-week rolling averages
  let prevMatchups: typeof currentMatchups = [];
  const prevLeagueId = league.previousLeagueId;
  if (prevLeagueId) {
    prevMatchups = await db
      .select({
        leagueId: schema.matchups.leagueId,
        week: schema.matchups.week,
        rosterId: schema.matchups.rosterId,
        points: schema.matchups.points,
        starters: schema.matchups.starters,
        playerPoints: schema.matchups.playerPoints,
      })
      .from(schema.matchups)
      .where(
        and(
          eq(schema.matchups.leagueId, prevLeagueId),
        ),
      );
    // Only keep last 4 weeks of previous season
    const maxPrevWeek = Math.max(...prevMatchups.map((m) => m.week), 0);
    const minPrevWeek = Math.max(1, maxPrevWeek - ROLLING_WINDOW + 1);
    prevMatchups = prevMatchups.filter(
      (m) => m.week >= minPrevWeek,
    );
  }

  // 4. Load player positions
  const allPlayerIds = new Set<string>();
  for (const m of [...currentMatchups, ...prevMatchups]) {
    if (m.playerPoints) {
      for (const pid of Object.keys(m.playerPoints as Record<string, number>)) {
        allPlayerIds.add(pid);
      }
    }
    if (m.starters) {
      for (const pid of m.starters as string[]) {
        allPlayerIds.add(pid);
      }
    }
  }

  const playerPositions: Record<string, string> = {};
  const gsisToPlayerId = new Map<string, string>();
  if (allPlayerIds.size > 0) {
    const playerRows = await db
      .select({ id: schema.players.id, position: schema.players.position, gsisId: schema.players.gsisId })
      .from(schema.players)
      .where(inArray(schema.players.id, Array.from(allPlayerIds)));

    for (const row of playerRows) {
      if (row.position) playerPositions[row.id] = row.position;
      if (row.gsisId) gsisToPlayerId.set(row.gsisId, row.id);
    }
  }

  // 5. Load NFL active weeks for rolling average filtering
  const currentSeason = parseInt(league.season, 10);
  const relevantSeasons = [currentSeason];
  let prevSeason: number | undefined;
  if (prevLeagueId) {
    const [prevLeague] = await db
      .select({ season: schema.leagues.season })
      .from(schema.leagues)
      .where(eq(schema.leagues.id, prevLeagueId))
      .limit(1);
    if (prevLeague) {
      prevSeason = parseInt(prevLeague.season, 10);
      if (!isNaN(prevSeason)) relevantSeasons.push(prevSeason);
    }
  }

  // Build set of "playerId:season:week" where player was NFL-active
  const activeWeeks = new Set<string>();
  if (gsisToPlayerId.size > 0) {
    const validSeasons = relevantSeasons.filter((s) => !isNaN(s));
    if (validSeasons.length > 0) {
      const statusRows = await db
        .select({
          gsisId: schema.nflWeeklyRosterStatus.gsisId,
          season: schema.nflWeeklyRosterStatus.season,
          week: schema.nflWeeklyRosterStatus.week,
        })
        .from(schema.nflWeeklyRosterStatus)
        .where(
          and(
            eq(schema.nflWeeklyRosterStatus.status, "ACT"),
            inArray(schema.nflWeeklyRosterStatus.season, validSeasons),
          ),
        );

      for (const row of statusRows) {
        const playerId = gsisToPlayerId.get(row.gsisId);
        if (playerId) {
          activeWeeks.add(`${playerId}:${row.season}:${row.week}`);
        }
      }
    }
  }

  // League → season mapping for rolling average builder
  const leagueSeasons = new Map<string, number>();
  leagueSeasons.set(leagueId, currentSeason);
  if (prevLeagueId && prevSeason !== undefined && !isNaN(prevSeason)) {
    leagueSeasons.set(prevLeagueId, prevSeason);
  }

  // 6. Build rolling averages
  const typedCurrentMatchups = currentMatchups.map((m) => ({
    ...m,
    playerPoints: m.playerPoints as Record<string, number> | null,
  }));
  const typedPrevMatchups = prevMatchups.map((m) => ({
    ...m,
    playerPoints: m.playerPoints as Record<string, number> | null,
  }));

  const rollingAvgs = buildRollingAverages(
    typedCurrentMatchups,
    typedPrevMatchups,
    leagueId,
    prevLeagueId,
    activeWeeks,
    leagueSeasons,
  );

  // 7. Grade each (week, roster) matchup
  const rosterGrades = new Map<
    number,
    {
      ownerId: string;
      weekGrades: WeekGrade[];
      totalInsightful: number;
    }
  >();

  // Load roster → owner mapping
  const rosterRows = await db
    .select({ rosterId: schema.rosters.rosterId, ownerId: schema.rosters.ownerId })
    .from(schema.rosters)
    .where(eq(schema.rosters.leagueId, leagueId));

  const rosterOwnerMap = new Map<number, string>();
  for (const r of rosterRows) {
    if (r.ownerId) rosterOwnerMap.set(r.rosterId, r.ownerId);
  }

  for (const matchup of typedCurrentMatchups) {
    const actualStarters = (matchup.starters as string[] | null) || [];
    const matchupPlayerPoints = matchup.playerPoints || {};
    const actualPoints = matchup.points || 0;

    // Skip weeks with no data
    if (Object.keys(matchupPlayerPoints).length === 0) continue;
    if (actualStarters.length === 0) continue;

    // Run solver with actual points → actual-optimal lineup
    const actualOptimal = solveOptimalLineup(
      matchupPlayerPoints,
      playerPositions,
      rosterPositions,
    );

    if (actualOptimal.optimalPoints === 0) continue;

    // Build rolling-average points for this roster's players this week
    const avgPoints: Record<string, number> = {};
    for (const playerId of Object.keys(matchupPlayerPoints)) {
      const key = `${leagueId}:${matchup.week}:${playerId}`;
      avgPoints[playerId] = rollingAvgs.get(key) || 0;
    }

    // Run solver with rolling averages → expected-optimal lineup
    const expectedOptimal = solveOptimalLineup(
      avgPoints,
      playerPositions,
      rosterPositions,
    );

    const actualOptimalSet = new Set(actualOptimal.optimalStarters);
    const expectedOptimalSet = new Set(expectedOptimal.optimalStarters);

    // Score each starter slot
    const breakdown = { followedGood: 0, followedBad: 0, brokeGood: 0, brokeBad: 0 };
    let slotScoreSum = 0;
    let slotsScored = 0;

    for (const starter of actualStarters) {
      // Skip players with no position (e.g., "0" placeholder for empty slots)
      if (!playerPositions[starter] && !matchupPlayerPoints[starter]) continue;

      const goodOutcome = actualOptimalSet.has(starter);
      const followedProcess = expectedOptimalSet.has(starter);

      let slotScore: number;
      if (followedProcess && goodOutcome) {
        slotScore = SLOT_SCORES.followedGood;
        breakdown.followedGood++;
      } else if (followedProcess && !goodOutcome) {
        slotScore = SLOT_SCORES.followedBad;
        breakdown.followedBad++;
      } else if (!followedProcess && goodOutcome) {
        slotScore = SLOT_SCORES.brokeGood;
        breakdown.brokeGood++;
      } else {
        slotScore = SLOT_SCORES.brokeBad;
        breakdown.brokeBad++;
      }

      slotScoreSum += slotScore;
      slotsScored++;
    }

    if (slotsScored === 0) continue;

    const meanSlotScore = slotScoreSum / slotsScored;
    // Normalize to 0-100 (1.0 baseline = 100, cap at 100)
    const weekScore = Math.min(100, (meanSlotScore / 1.0) * 100);
    const efficiency =
      actualOptimal.optimalPoints > 0
        ? (actualPoints / actualOptimal.optimalPoints) * 100
        : 100;
    const pointsLeftOnBench = Math.max(0, actualOptimal.optimalPoints - actualPoints);

    const weekGrade: WeekGrade = {
      week: matchup.week,
      score: Math.round(weekScore * 10) / 10,
      actualPoints: Math.round(actualPoints * 10) / 10,
      optimalPoints: Math.round(actualOptimal.optimalPoints * 10) / 10,
      efficiency: Math.round(efficiency * 10) / 10,
      pointsLeftOnBench: Math.round(pointsLeftOnBench * 10) / 10,
      slotBreakdown: breakdown,
    };

    if (!rosterGrades.has(matchup.rosterId)) {
      rosterGrades.set(matchup.rosterId, {
        ownerId: rosterOwnerMap.get(matchup.rosterId) || "",
        weekGrades: [],
        totalInsightful: 0,
      });
    }
    const rg = rosterGrades.get(matchup.rosterId)!;
    rg.weekGrades.push(weekGrade);
    rg.totalInsightful += breakdown.brokeGood;
  }

  // 7. Aggregate per roster
  const results: RosterLineupGrade[] = [];

  for (const [rosterId, data] of rosterGrades) {
    if (data.weekGrades.length === 0) continue;

    const avgScore =
      data.weekGrades.reduce((sum, w) => sum + w.score, 0) /
      data.weekGrades.length;
    const totalPLB = data.weekGrades.reduce(
      (sum, w) => sum + w.pointsLeftOnBench,
      0,
    );
    const perfectWeeks = data.weekGrades.filter(
      (w) => w.pointsLeftOnBench === 0,
    ).length;
    const avgEfficiency =
      data.weekGrades.reduce((sum, w) => sum + w.efficiency, 0) /
      data.weekGrades.length;

    results.push({
      rosterId,
      ownerId: data.ownerId,
      score: Math.round(avgScore * 10) / 10,
      efficiency: Math.round(avgEfficiency * 10) / 10,
      totalPointsLeftOnBench: Math.round(totalPLB * 10) / 10,
      perfectWeeks,
      insightfulStarts: data.totalInsightful,
      grade: scoreToGrade(avgScore),
      weeks: data.weekGrades.sort((a, b) => a.week - b.week),
    });
  }

  // 8. Write to managerMetrics
  const season = league.season;
  const scores = results.map((r) => r.score).sort((a, b) => a - b);

  for (const roster of results) {
    if (!roster.ownerId) continue;

    // Compute percentile within league
    const rank = scores.filter((s) => s < roster.score).length;
    const percentile =
      scores.length > 1 ? (rank / (scores.length - 1)) * 100 : 50;

    const metricBase = {
      leagueId,
      managerId: roster.ownerId,
      metric: "lineup_score" as const,
      value: roster.score,
      percentile: Math.round(percentile * 10) / 10,
      meta: {
        grade: roster.grade,
        efficiency: roster.efficiency,
        totalPointsLeftOnBench: roster.totalPointsLeftOnBench,
        perfectWeeks: roster.perfectWeeks,
        insightfulStarts: roster.insightfulStarts,
        weeksGraded: roster.weeks.length,
      },
      computedAt: new Date(),
    };

    // Season scope
    await db
      .insert(schema.managerMetrics)
      .values({ ...metricBase, scope: `season:${season}` })
      .onConflictDoUpdate({
        target: [
          schema.managerMetrics.leagueId,
          schema.managerMetrics.managerId,
          schema.managerMetrics.metric,
          schema.managerMetrics.scope,
        ],
        set: {
          value: metricBase.value,
          percentile: metricBase.percentile,
          meta: metricBase.meta,
          computedAt: metricBase.computedAt,
        },
      });
  }

  console.log(
    `[lineupGrading] Graded ${results.length} rosters for league ${leagueId}`,
  );

  return results;
}
