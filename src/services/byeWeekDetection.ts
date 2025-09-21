import { getDb } from '@/db/index';
import { playerScores } from '@/db/schema';
import { eq, and, gte, lte } from 'drizzle-orm';

// Interface for bye week detection strategies
export interface ByeWeekDetector {
  detectByeWeek(leagueId: string, playerId: string, season: string): Promise<number | null>;
}

// Heuristic-based bye week detector
// Finds first occurrence in weeks 4-14 where player scores 0 points and is on bench
export class HeuristicByeWeekDetector implements ByeWeekDetector {
  private cache = new Map<string, number | null>();

  async detectByeWeek(leagueId: string, playerId: string, season: string): Promise<number | null> {
    const cacheKey = `${leagueId}-${playerId}-${season}`;

    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    try {
      const db = await getDb();

      // Get all scores for this player in the bye week range (weeks 4-14)
      const scores = await db
        .select()
        .from(playerScores)
        .where(
          and(
            eq(playerScores.leagueId, leagueId),
            eq(playerScores.playerId, playerId),
            gte(playerScores.week, 4),
            lte(playerScores.week, 14)
          )
        )
        .orderBy(playerScores.week);

      // Find first occurrence where player scored 0 points and was on bench
      for (const score of scores) {
        if (Number(score.points) === 0 && !score.isStarter) {
          const byeWeek = score.week;
          this.cache.set(cacheKey, byeWeek);
          return byeWeek;
        }
      }

      // No bye week detected
      this.cache.set(cacheKey, null);
      return null;
    } catch (error) {
      console.warn(`Failed to detect bye week for ${playerId} in ${season}:`, error);
      this.cache.set(cacheKey, null);
      return null;
    }
  }

  // Clear cache (useful when switching strategies)
  clearCache() {
    this.cache.clear();
  }
}

// Future: API-based bye week detector
export class ApiByeWeekDetector implements ByeWeekDetector {
  async detectByeWeek(leagueId: string, playerId: string, season: string): Promise<number | null> {
    // TODO: Implement when API data source is available
    throw new Error('ApiByeWeekDetector not yet implemented');
  }
}

// Registry to manage which detector to use
let currentDetector: ByeWeekDetector = new HeuristicByeWeekDetector();

export function getByeWeekDetector(): ByeWeekDetector {
  return currentDetector;
}

export function setByeWeekDetector(detector: ByeWeekDetector) {
  currentDetector = detector;
}

// Convenience function for detecting bye weeks
export async function detectByeWeek(leagueId: string, playerId: string, season: string): Promise<number | null> {
  return await getByeWeekDetector().detectByeWeek(leagueId, playerId, season);
}