import { NextRequest, NextResponse } from 'next/server';
import { getLeagueFamily } from '@/services/assets';
import { topPlayersByEventCount, topPicksByEventCount } from '@/repositories/assetEvents';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const leagueId = searchParams.get('leagueId') || searchParams.get('league_id');
    const limit = Number(searchParams.get('limit') || '5');
    if (!leagueId) {
      return NextResponse.json({ ok: false, error: 'leagueId required' }, { status: 400 });
    }
    const family = await getLeagueFamily(leagueId);
    const players = await topPlayersByEventCount(family, limit);
    const picks = await topPicksByEventCount(family, limit);
    return NextResponse.json({ ok: true, family, players, picks });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'samples failed' }, { status: 500 });
  }
}

