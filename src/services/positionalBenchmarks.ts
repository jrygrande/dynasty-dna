import { getDb } from '@/db/index';
import { playerScores, players, leagues } from '@/db/schema';
import { and, eq, inArray, sql } from 'drizzle-orm';

export interface WeeklyBenchmarks {
  season: string;
  week: number;
  position: number; // continuous position for chart
  median: number;
  topDecile: number; // 90th percentile
  sampleSize: number; // number of starters included
}

export interface PositionalBenchmarks {
  position: string;
  benchmarks: WeeklyBenchmarks[];
}

/**
 * Calculate weekly positional benchmarks for a player across league family
 */
export async function calculatePositionalBenchmarks(
  leagueIds: string[],
  playerPosition: string,
  playerScoreWeeks: Array<{ season: string; week: number; position: number }>
): Promise<WeeklyBenchmarks[]> {
  if (!leagueIds.length || !playerPosition || !playerScoreWeeks.length) {
    return [];
  }

  const db = await getDb();
  const benchmarks: WeeklyBenchmarks[] = [];

  // Get all unique season-week combinations where the player has scores
  const weeklyData = new Map<string, { season: string; week: number; position: number }>();
  for (const score of playerScoreWeeks) {
    const key = `${score.season}-${score.week}`;
    weeklyData.set(key, score);
  }

  // For each week, calculate benchmarks
  for (const [key, weekData] of weeklyData) {
    try {
      // Query all starter scores for players of the same position in this week
      const starterScores = await db
        .select({
          points: playerScores.points,
        })
        .from(playerScores)
        .innerJoin(players, eq(playerScores.playerId, players.id))
        .where(
          and(
            inArray(playerScores.leagueId, leagueIds),
            eq(playerScores.week, weekData.week),
            eq(playerScores.isStarter, true),
            eq(players.position, playerPosition)
          )
        );

      if (starterScores.length === 0) {
        continue; // No starters found for this position this week
      }

      // Convert points to numbers and sort
      const scores = starterScores
        .map(s => parseFloat(s.points as string))
        .filter(p => !isNaN(p))
        .sort((a, b) => a - b);

      if (scores.length < 3) {
        continue; // Need at least 3 scores for meaningful benchmarks
      }

      // Calculate median
      const median = calculateMedian(scores);

      // Calculate top decile (90th percentile)
      const topDecile = calculatePercentile(scores, 90);

      benchmarks.push({
        season: weekData.season,
        week: weekData.week,
        position: weekData.position,
        median,
        topDecile,
        sampleSize: scores.length
      });

    } catch (error) {
      console.error(`Error calculating benchmarks for ${key}:`, error);
      continue;
    }
  }

  return benchmarks.sort((a, b) => a.position - b.position);
}

/**
 * Calculate median value from sorted array
 */
function calculateMedian(sortedScores: number[]): number {
  const length = sortedScores.length;
  if (length % 2 === 0) {
    // Even number of scores - average of two middle values
    const mid1 = sortedScores[length / 2 - 1];
    const mid2 = sortedScores[length / 2];
    return (mid1 + mid2) / 2;
  } else {
    // Odd number of scores - middle value
    return sortedScores[Math.floor(length / 2)];
  }
}

/**
 * Calculate percentile value from sorted array
 */
function calculatePercentile(sortedScores: number[], percentile: number): number {
  if (percentile < 0 || percentile > 100) {
    throw new Error('Percentile must be between 0 and 100');
  }

  const length = sortedScores.length;
  if (length === 1) {
    return sortedScores[0];
  }

  // Calculate index for percentile
  const index = (percentile / 100) * (length - 1);
  const lowerIndex = Math.floor(index);
  const upperIndex = Math.ceil(index);

  if (lowerIndex === upperIndex) {
    return sortedScores[lowerIndex];
  }

  // Interpolate between the two values
  const lowerValue = sortedScores[lowerIndex];
  const upperValue = sortedScores[upperIndex];
  const weight = index - lowerIndex;

  return lowerValue + (upperValue - lowerValue) * weight;
}

/**
 * Get season-week combinations from league family for benchmark calculation
 */
export async function getSeasonWeekCombinations(
  leagueIds: string[],
  playerPosition: string
): Promise<Array<{ season: string; week: number }>> {
  if (!leagueIds.length || !playerPosition) {
    return [];
  }

  const db = await getDb();

  try {
    const combinations = await db
      .selectDistinct({
        season: sql<string>`COALESCE(${leagues.season}, 'Unknown')`,
        week: playerScores.week,
      })
      .from(playerScores)
      .innerJoin(players, eq(playerScores.playerId, players.id))
      .leftJoin(leagues, eq(playerScores.leagueId, leagues.id))
      .where(
        and(
          inArray(playerScores.leagueId, leagueIds),
          eq(playerScores.isStarter, true),
          eq(players.position, playerPosition)
        )
      )
      .orderBy(sql`COALESCE(${leagues.season}, 'Unknown')`, playerScores.week);

    return combinations.filter(c => c.season !== 'Unknown');
  } catch (error) {
    console.error('Error getting season-week combinations:', error);
    return [];
  }
}