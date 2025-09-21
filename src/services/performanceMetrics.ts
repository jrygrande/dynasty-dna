import { getPlayerScoresForPeriod } from '@/repositories/playerScores';
import { getNFLState } from '@/repositories/state';
import type { PerformanceMetrics } from '@/lib/api/assets';

export interface PerformancePeriod {
  leagueId: string;
  playerId: string;
  rosterId: number;
  startWeek: number;
  endWeek: number | null; // null means end of season
  season: string;
}

export async function calculatePerformanceMetrics(
  period: PerformancePeriod
): Promise<PerformanceMetrics | null> {
  try {
    const currentNflState = await getNFLState();

    const scores = await getPlayerScoresForPeriod({
      leagueId: period.leagueId,
      playerId: period.playerId,
      rosterId: period.rosterId,
      startWeek: period.startWeek,
      endWeek: period.endWeek,
      currentWeek: currentNflState ? {
        season: currentNflState.season,
        week: currentNflState.week
      } : undefined,
      excludeByeWeek: true
    });

    if (scores.length === 0) {
      return null;
    }

    // Calculate metrics
    const totalWeeks = scores.length;
    const starterScores = scores.filter(score => score.isStarter);
    const starterWeeks = starterScores.length;

    const totalPoints = scores.reduce((sum, score) => sum + Number(score.points), 0);
    const starterPoints = starterScores.reduce((sum, score) => sum + Number(score.points), 0);

    const startingPercentage = totalWeeks > 0 ? (starterWeeks / totalWeeks) * 100 : 0;
    const ppg = totalWeeks > 0 ? totalPoints / totalWeeks : 0;
    const startingPpg = starterWeeks > 0 ? starterPoints / starterWeeks : 0;

    return {
      startingPercentage: Math.round(startingPercentage * 10) / 10, // Round to 1 decimal
      ppg: Math.round(ppg * 100) / 100, // Round to 2 decimals
      startingPpg: Math.round(startingPpg * 100) / 100, // Round to 2 decimals
      weekCount: totalWeeks,
      season: period.season
    };
  } catch (error) {
    console.error('Error calculating performance metrics:', error);
    return null;
  }
}

export async function calculatePerformanceBetweenEvents(
  leagueId: string,
  playerId: string,
  currentEvent: {
    toRosterId: number | null;
    season: string | null;
    week: number | null;
    eventTime: string | null;
  },
  nextEvent?: {
    season: string | null;
    week: number | null;
    eventTime: string | null;
  }
): Promise<PerformanceMetrics[]> {
  if (!currentEvent.toRosterId || !currentEvent.season) {
    return [];
  }

  // Determine the period boundaries
  let startWeek = currentEvent.week || 1;
  let endWeek: number | null = null;
  let endSeason = currentEvent.season;

  if (nextEvent) {
    if (nextEvent.season && nextEvent.season !== currentEvent.season) {
      // Period spans to end of current season
      endWeek = 17; // Regular season ends at week 17
    } else if (nextEvent.week) {
      endWeek = nextEvent.week - 1;
    }
  }

  // If this is a draft event (week 0), start from week 1
  if (startWeek === 0) {
    startWeek = 1;
  }

  const metrics: PerformanceMetrics[] = [];

  try {
    // Calculate metrics for the primary season
    const primaryMetrics = await calculatePerformanceMetrics({
      leagueId,
      playerId,
      rosterId: currentEvent.toRosterId,
      startWeek,
      endWeek,
      season: currentEvent.season
    });

    if (primaryMetrics) {
      metrics.push(primaryMetrics);
    }

    // If period spans multiple seasons and we have a next event in a different season
    if (nextEvent?.season && nextEvent.season !== currentEvent.season) {
      const nextSeasonMetrics = await calculatePerformanceMetrics({
        leagueId,
        playerId,
        rosterId: currentEvent.toRosterId,
        startWeek: 1,
        endWeek: nextEvent.week ? nextEvent.week - 1 : null,
        season: nextEvent.season
      });

      if (nextSeasonMetrics) {
        metrics.push(nextSeasonMetrics);
      }
    }
  } catch (error) {
    console.error('Error calculating performance between events:', error);
  }

  return metrics;
}