import { NextRequest, NextResponse } from 'next/server';
import { getLeagueFamily, buildTimelineFromEvents, getPlayerInfo } from '@/services/assets';
import { getPlayerTimeline } from '@/repositories/assetEvents';
import { getPlayerPerformancePeriods } from '@/services/playerPerformance';
import type { PerformanceMetrics } from '@/lib/api/assets';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const leagueId = searchParams.get('leagueId') || searchParams.get('league_id');
    const playerId = searchParams.get('playerId') || searchParams.get('player_id');
    if (!leagueId || !playerId) {
      return NextResponse.json({ ok: false, error: 'leagueId and playerId required' }, { status: 400 });
    }

    console.log(`Fetching timeline for player ${playerId} in league ${leagueId}`);
    const family = await getLeagueFamily(leagueId);
    console.log(`League family: ${family.length} leagues`);

    const events = await getPlayerTimeline(family, playerId);
    console.log(`Found ${events.length} events for player ${playerId}`);

    const timeline = await buildTimelineFromEvents(events);
    const player = await getPlayerInfo(playerId);

    // Get performance data for each period between transactions
    const performance = await getPlayerPerformancePeriods(timeline, family, playerId);

    // Attach performance metrics to timeline events
    const timelineWithPerformance = timeline.map((event, index) => {
      // Find performance periods that correspond to this event
      const eventPerformancePeriods = performance.filter(p => p.fromEvent === event.id);

      if (eventPerformancePeriods.length > 0) {
        const performanceMetrics: PerformanceMetrics[] = [];

        eventPerformancePeriods.forEach(period => {
          // If period has bySeasons data (spans multiple seasons), use that
          if (period.bySeasons && period.bySeasons.length > 0) {
            period.bySeasons.forEach(seasonData => {
              performanceMetrics.push({
                startingPercentage: Math.round(seasonData.metrics.starterPct * 10) / 10,
                ppg: Math.round(seasonData.metrics.ppg * 100) / 100,
                startingPpg: Math.round(seasonData.metrics.ppgStarter * 100) / 100,
                weekCount: seasonData.metrics.gamesPlayed,
                season: seasonData.season
              });
            });
          } else {
            // Single season period
            performanceMetrics.push({
              startingPercentage: Math.round(period.metrics.starterPct * 10) / 10,
              ppg: Math.round(period.metrics.ppg * 100) / 100,
              startingPpg: Math.round(period.metrics.ppgStarter * 100) / 100,
              weekCount: period.metrics.gamesPlayed,
              season: period.season
            });
          }
        });

        return {
          ...event,
          performanceMetrics: performanceMetrics.length > 0 ? performanceMetrics : undefined
        };
      }

      return event;
    });

    // Always return success, even if no events found
    return NextResponse.json({
      ok: true,
      events: events || [],
      family,
      player,
      timeline: timelineWithPerformance || [],
      performance: performance || []
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'timeline failed' }, { status: 500 });
  }
}

