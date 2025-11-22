import { NextRequest, NextResponse } from 'next/server';
import { getLeagueFamily, buildTimelineFromEvents } from '@/services/assets';
import { getPickTimeline } from '@/repositories/assetEvents';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const leagueId = searchParams.get('leagueId') || searchParams.get('league_id');
    const season = searchParams.get('season');
    const roundStr = searchParams.get('round');
    const originalRosterIdStr = searchParams.get('originalRosterId') || searchParams.get('original_roster_id');
    if (!leagueId || !season || !roundStr || !originalRosterIdStr) {
      return NextResponse.json({ ok: false, error: 'leagueId, season, round, originalRosterId required' }, { status: 400 });
    }
    const round = Number(roundStr);
    const originalRosterId = Number(originalRosterIdStr);
    const family = await getLeagueFamily(leagueId);
    const events = await getPickTimeline(family, season, round, originalRosterId);
    const timeline = await buildTimelineFromEvents(events);

    // Check if the pick was selected and enhance with realized player info
    const { getPlayerInfo } = await import('@/services/assets');

    for (const event of timeline) {
      if (event.eventType === 'pick_selected' && event.details) {
        const details = event.details as any;
        // If we have a playerId in the details, fetch player information
        if (details.playerId) {
          try {
            const playerInfo = await getPlayerInfo(details.playerId);

            // Add realized player to the event details
            event.details = {
              ...details,
              realizedPlayer: {
                id: playerInfo.id,
                name: playerInfo.name,
                position: playerInfo.position,
                team: playerInfo.team
              }
            };
          } catch (error) {
            console.error(`Failed to fetch realized player info:`, error);
            // Continue without realized player if fetch fails
          }
        }
      }
    }

    // Create a synthetic player object for the pick
    const pickPlayer = {
      id: `pick-${season}-${round}-${originalRosterId}`,
      name: `${season} Round ${round} Pick`,
      position: null,
      team: null,
      status: null,
    };

    // Fetch enriched transactions
    const { getEnrichedTransactionsForAsset } = await import('@/repositories/enrichedTransactions');
    const pickAssetId = `pick-${season}-${round}-${originalRosterId}`;
    const enrichedTransactions = await getEnrichedTransactionsForAsset(leagueId, pickAssetId);

    return NextResponse.json({
      ok: true,
      events,
      family,
      player: pickPlayer,
      timeline,
      enrichedTransactions: enrichedTransactions || []
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'timeline failed' }, { status: 500 });
  }
}

