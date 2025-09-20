import { NextRequest, NextResponse } from 'next/server';
import { getLeagueFamily, buildTimelineFromEvents, getPlayerInfo } from '@/services/assets';
import { getPlayerTimeline } from '@/repositories/assetEvents';

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

    // Always return success, even if no events found
    return NextResponse.json({
      ok: true,
      events: events || [],
      family,
      player,
      timeline: timeline || []
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'timeline failed' }, { status: 500 });
  }
}

