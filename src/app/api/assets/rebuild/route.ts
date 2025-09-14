import { NextRequest, NextResponse } from 'next/server';
import { rebuildAssetEventsForLeagueFamily } from '@/services/assets';

export async function POST(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    let leagueId = searchParams.get('leagueId') || searchParams.get('league_id');
    if (!leagueId) {
      const body = await req.json().catch(() => ({}));
      leagueId = body.leagueId || body.league_id;
    }
    if (!leagueId) {
      return NextResponse.json({ ok: false, error: 'leagueId required' }, { status: 400 });
    }
    const result = await rebuildAssetEventsForLeagueFamily(leagueId);
    return NextResponse.json({ ok: true, result });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'rebuild failed' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  // convenience GET
  return POST(req);
}

