import type { PlayerScore, PerformanceMetrics, PerformancePeriod } from '@/types/playerPerformance';
import type { TimelineEvent } from '@/lib/api/assets';

export function calculateMetrics(scores: PlayerScore[]): PerformanceMetrics {
  if (scores.length === 0) {
    return {
      ppg: 0,
      starterPct: 0,
      ppgStarter: 0,
      ppgBench: 0,
      gamesPlayed: 0,
      gamesStarted: 0
    };
  }

  const starterGames = scores.filter(s => s.isStarter);
  const benchGames = scores.filter(s => !s.isStarter);

  const totalPoints = scores.reduce((sum, s) => sum + Number(s.points), 0);
  const starterPoints = starterGames.reduce((sum, s) => sum + Number(s.points), 0);
  const benchPoints = benchGames.reduce((sum, s) => sum + Number(s.points), 0);

  return {
    ppg: totalPoints / scores.length,
    starterPct: (starterGames.length / scores.length) * 100,
    ppgStarter: starterGames.length > 0 ? starterPoints / starterGames.length : 0,
    ppgBench: benchGames.length > 0 ? benchPoints / benchGames.length : 0,
    gamesPlayed: scores.length,
    gamesStarted: starterGames.length
  };
}

export interface OwnershipPeriod {
  fromEventId: string;
  toEventId: string | null;
  leagueId: string;
  season: string;
  rosterId: number;
  ownerUserId: string;
  startWeek: number;
  endWeek: number | null;
}

export function extractOwnershipPeriods(events: TimelineEvent[]): OwnershipPeriod[] {
  const periods: OwnershipPeriod[] = [];

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const nextEvent = events[i + 1] || null;

    // Skip if not a roster-changing event
    if (!event.toRosterId || !event.toUser) continue;

    // Determine period boundaries
    const startWeek = event.week === 0 ? 1 : event.week + 1;

    // For endWeek, we need to be careful about same-week trades and season boundaries
    let endWeek: number | null = null;
    if (nextEvent) {
      // If next event is in same season and same week, this period gets no weeks
      if (nextEvent.season === event.season && nextEvent.week === event.week) {
        endWeek = event.week; // This will make startWeek > endWeek, indicating no games
      } else if (nextEvent.season === event.season) {
        endWeek = nextEvent.week; // Up to the week of next trade
      } else {
        endWeek = null; // Different season, goes to end of current season
      }
    }

    periods.push({
      fromEventId: event.id,
      toEventId: nextEvent?.id || null,
      leagueId: event.leagueId,
      season: event.season || '',
      rosterId: event.toRosterId,
      ownerUserId: event.toUser.id,
      startWeek,
      endWeek
    });
  }

  return periods;
}

export async function fillSeasonGaps(
  ownershipPeriods: OwnershipPeriod[],
  leagueFamily: string[],
  seasonMap: Map<string, string>,
  playerId: string
): Promise<OwnershipPeriod[]> {
  // Import repository function
  const { getPlayerActivityByLeague } = await import('@/repositories/playerScores');

  // Get all player activity across league family
  const playerActivity = await getPlayerActivityByLeague(leagueFamily, playerId);

  // Group activity by season and determine roster ownership
  const activityBySeason = new Map<string, { leagueId: string; rosterId: number; minWeek: number; maxWeek: number; weekCount: number }>();
  for (const activity of playerActivity) {
    const season = seasonMap.get(activity.leagueId);
    if (season) {
      activityBySeason.set(season, {
        leagueId: activity.leagueId,
        rosterId: activity.rosterId,
        minWeek: activity.minWeek,
        maxWeek: activity.maxWeek,
        weekCount: activity.weekCount
      });
    }
  }

  // Create a set of covered season/league combinations from existing ownership periods
  const coveredSeasons = new Set<string>();
  for (const period of ownershipPeriods) {
    coveredSeasons.add(`${period.season}-${period.leagueId}`);
  }

  // Add periods for uncovered seasons where player was active
  const allPeriods = [...ownershipPeriods];

  for (const [season, activity] of activityBySeason) {
    const seasonKey = `${season}-${activity.leagueId}`;

    if (!coveredSeasons.has(seasonKey)) {
      // Find the most recent ownership to determine user
      const lastKnownPeriod = ownershipPeriods
        .filter(p => p.rosterId === activity.rosterId)
        .sort((a, b) => (a.season || '').localeCompare(b.season || ''))
        .pop();

      // Create a continuation period for this season
      allPeriods.push({
        fromEventId: `continuation-${season}-${activity.leagueId}`,
        toEventId: null,
        leagueId: activity.leagueId,
        season,
        rosterId: activity.rosterId,
        ownerUserId: lastKnownPeriod?.ownerUserId || 'unknown',
        startWeek: activity.minWeek,
        endWeek: activity.maxWeek
      });
    }
  }

  // Sort periods chronologically
  return allPeriods.sort((a, b) => {
    const seasonA = a.season || '';
    const seasonB = b.season || '';
    if (seasonA !== seasonB) {
      return seasonA.localeCompare(seasonB);
    }
    return a.startWeek - b.startWeek;
  });
}

export async function getPlayerPerformancePeriods(
  timeline: TimelineEvent[],
  leagueFamily: string[],
  playerId: string
): Promise<PerformancePeriod[]> {
  // Import repository functions
  const { getLeagueSeasonMap } = await import('@/repositories/leagues');
  const { getPlayerScoresForPeriod } = await import('@/repositories/playerScores');
  const { getNFLState } = await import('@/repositories/state');

  // Get current NFL state to filter out future weeks
  const currentNFLState = await getNFLState();
  const currentWeek = currentNFLState ? { season: currentNFLState.season, week: currentNFLState.week } : undefined;

  // Get league->season mapping
  const seasonMap = await getLeagueSeasonMap(leagueFamily);

  // Extract ownership periods from timeline
  const ownershipPeriods = extractOwnershipPeriods(timeline);

  // Fill in gaps for seasons where player continued on same roster
  const allOwnershipPeriods = await fillSeasonGaps(ownershipPeriods, leagueFamily, seasonMap, playerId);

  const performancePeriods: PerformancePeriod[] = [];

  for (const period of allOwnershipPeriods) {
    // Skip if startWeek > endWeek (same week trade situation)
    if (period.endWeek !== null && period.startWeek > period.endWeek) {
      continue;
    }

    // Query scores for this roster/period
    const scores = await getPlayerScoresForPeriod({
      leagueId: period.leagueId,
      playerId,
      rosterId: period.rosterId,
      startWeek: period.startWeek,
      endWeek: period.endWeek,
      currentWeek,
      excludeByeWeek: true
    });

    // Calculate metrics using the scores data structure
    const metrics = calculateMetrics(
      scores.map(s => ({
        leagueId: s.leagueId,
        week: s.week,
        rosterId: s.rosterId,
        playerId: s.playerId,
        points: s.points,
        isStarter: s.isStarter
      }))
    );

    // Use season from mapping, or fall back to period season
    const season = seasonMap.get(period.leagueId) || period.season;

    // Determine if this is a continuation period (generated to fill season gap)
    const isContinuation = period.fromEventId.startsWith('continuation-');

    performancePeriods.push({
      fromEvent: period.fromEventId,
      toEvent: period.toEventId,
      leagueId: period.leagueId,
      season,
      rosterId: period.rosterId,
      ownerUserId: period.ownerUserId,
      startWeek: period.startWeek,
      endWeek: period.endWeek,
      metrics,
      isContinuation: isContinuation || undefined // only include if true
    });
  }

  return performancePeriods;
}