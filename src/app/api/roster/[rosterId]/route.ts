import { NextRequest, NextResponse } from 'next/server';
import { getCurrentRosterAssets } from '@/services/roster';

export async function GET(req: NextRequest, { params }: { params: { rosterId: string } }) {
  try {
    const { searchParams } = new URL(req.url);
    const leagueId = searchParams.get('leagueId');
    const season = searchParams.get('season'); // Optional season filter
    const rosterId = parseInt(params.rosterId);

    if (!leagueId) {
      return NextResponse.json({ ok: false, error: 'leagueId query parameter is required' }, { status: 400 });
    }

    if (isNaN(rosterId)) {
      return NextResponse.json({ ok: false, error: 'rosterId must be a valid number' }, { status: 400 });
    }

    console.log(`Fetching roster ${rosterId} for league ${leagueId}${season ? ` (season: ${season})` : ''}`);

    const rosterData = await getCurrentRosterAssets(leagueId, rosterId, { season: season || undefined });

    return NextResponse.json({
      ok: true,
      ...rosterData
    });
  } catch (e: any) {
    console.error('Roster API error:', e);
    return NextResponse.json({ ok: false, error: e?.message || 'Failed to fetch roster' }, { status: 500 });
  }
}