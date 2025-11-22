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

    // Enhance draft_selected events with pick provenance
    const { getPickTimeline } = await import('@/repositories/assetEvents');

    for (const event of timeline) {
      if (event.eventType === 'draft_selected' && event.details) {
        const details = event.details as any;
        // Extract pick information from the draft event
        if (details.round && event.season) {
          // Find the original roster ID for this pick from the toRosterId
          const originalRosterId = event.toRosterId;

          if (originalRosterId) {
            try {
              // Fetch the pick timeline to see if it was traded
              const pickEvents = await getPickTimeline(
                family,
                event.season,
                details.round,
                originalRosterId
              );

              // Check if the pick had any trade events before selection
              const pickTrades = pickEvents.filter(e => e.eventType === 'pick_trade');

              // Add pick provenance to the event details
              event.details = {
                ...details,
                pickAsset: {
                  season: event.season,
                  round: details.round,
                  originalRosterId: originalRosterId,
                  hadTrades: pickTrades.length > 0,
                  tradeCount: pickTrades.length
                }
              };
            } catch (error) {
              console.error(`Failed to fetch pick provenance for draft event:`, error);
              // Continue without pick provenance if fetch fails
            }
          }
        }
      }
    }

    // Create a comprehensive timeline that includes both transaction events and continuation periods
    const allTimelineEvents = [...timeline];

    // Add virtual events for continuation periods that don't have corresponding timeline events
    const continuationPeriods = performance.filter(p => p.fromEvent.startsWith('continuation-'));

    for (const period of continuationPeriods) {
      // Create a virtual "season continuation" event
      const virtualEvent = {
        id: period.fromEvent,
        leagueId: period.leagueId,
        season: period.season,
        week: 1, // Start of season
        eventTime: `${period.season}-01-01T00:00:00.000Z`, // Approximate start of season
        eventType: 'season_continuation',
        fromRosterId: null,
        toRosterId: period.rosterId,
        fromUser: null,
        toUser: null, // We don't have user info for continuation periods
        details: { isContinuation: true },
        transactionId: null,
        assetsInTransaction: []
      };

      allTimelineEvents.push(virtualEvent);
    }

    // Sort all events chronologically
    allTimelineEvents.sort((a, b) => {
      const seasonA = parseInt(a.season || '0');
      const seasonB = parseInt(b.season || '0');
      if (seasonA !== seasonB) return seasonA - seasonB;

      const weekA = a.week || 0;
      const weekB = b.week || 0;
      return weekA - weekB;
    });

    // Attach performance metrics to all timeline events
    const timelineWithPerformance = allTimelineEvents.map((event, index) => {
      // Find performance periods that correspond to this event
      const eventPerformancePeriods = performance.filter(p => p.fromEvent === event.id);

      if (eventPerformancePeriods.length > 0) {
        const performanceMetrics: PerformanceMetrics[] = [];

        eventPerformancePeriods.forEach(period => {
          // If period has bySeasons data (spans multiple seasons), use that
          if (period.bySeasons && period.bySeasons.length > 0) {
            period.bySeasons.forEach((seasonData: any) => {
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

    // Fetch enriched transactions from ALL leagues in the family
    const { getEnrichedTransactionsForAsset } = await import('@/repositories/enrichedTransactions');
    const enrichedTransactionsPromises = family.map(fam =>
      getEnrichedTransactionsForAsset(fam, playerId)
    );
    const enrichedTransactionsArrays = await Promise.all(enrichedTransactionsPromises);
    const enrichedTransactions = enrichedTransactionsArrays.flat();

    // Always return success, even if no events found
    return NextResponse.json({
      ok: true,
      events: events || [],
      family,
      player,
      timeline: timelineWithPerformance || [],
      performance: performance || [],
      enrichedTransactions: enrichedTransactions || []
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'timeline failed' }, { status: 500 });
  }
}

