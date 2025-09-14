import { NextRequest, NextResponse } from 'next/server';
import { getLeagueFamily } from '@/services/assets';
import { getPlayerTimeline } from '@/repositories/assetEvents';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const leagueId = searchParams.get('leagueId') || searchParams.get('league_id');
    const playerId = searchParams.get('playerId') || searchParams.get('player_id');
    if (!leagueId || !playerId) {
      return NextResponse.json({ ok: false, error: 'leagueId and playerId required' }, { status: 400 });
    }
    const family = await getLeagueFamily(leagueId);
    const events = await getPlayerTimeline(family, playerId);
    return NextResponse.json({ ok: true, events, family });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'timeline failed' }, { status: 500 });
  }
}

