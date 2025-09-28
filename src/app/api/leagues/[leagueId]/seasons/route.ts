import { NextRequest, NextResponse } from 'next/server';
import { getAvailableSeasons } from '@/services/roster-history';

export async function GET(req: NextRequest, { params }: { params: { leagueId: string } }) {
  try {
    const leagueId = params.leagueId;

    if (!leagueId) {
      return NextResponse.json({ ok: false, error: 'League ID is required' }, { status: 400 });
    }

    console.log(`Fetching available seasons for league ${leagueId}`);

    const seasons = await getAvailableSeasons(leagueId);

    return NextResponse.json({
      ok: true,
      seasons
    });
  } catch (e: any) {
    console.error('Seasons API error:', e);
    return NextResponse.json({ ok: false, error: e?.message || 'Failed to fetch seasons' }, { status: 500 });
  }
}