import { NextRequest, NextResponse } from 'next/server';
import { getLeagueFamily } from '@/services/assets';
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
    return NextResponse.json({ ok: true, events, family });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'timeline failed' }, { status: 500 });
  }
}

