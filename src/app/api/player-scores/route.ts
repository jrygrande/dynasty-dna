import { NextRequest, NextResponse } from 'next/server';
import { getPlayerScores } from '@/repositories/playerScores';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const leagueId = searchParams.get('leagueId');
    const week = searchParams.get('week');
    const playerId = searchParams.get('playerId');
    const rosterId = searchParams.get('rosterId');

    if (!leagueId) {
      return NextResponse.json({ ok: false, error: 'leagueId is required' }, { status: 400 });
    }

    const opts: {
      leagueId: string;
      week?: number;
      playerId?: string;
      rosterId?: number;
    } = { leagueId };

    if (week !== null) {
      const weekNum = Number(week);
      if (!isNaN(weekNum) && weekNum >= 1 && weekNum <= 18) {
        opts.week = weekNum;
      }
    }

    if (playerId) {
      opts.playerId = playerId;
    }

    if (rosterId !== null) {
      const rosterNum = Number(rosterId);
      if (!isNaN(rosterNum)) {
        opts.rosterId = rosterNum;
      }
    }

    const scores = await getPlayerScores(opts);

    return NextResponse.json({
      ok: true,
      data: scores,
      count: scores.length
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'failed to fetch player scores' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { leagueId, week, playerId, rosterId } = body;

    if (!leagueId) {
      return NextResponse.json({ ok: false, error: 'leagueId is required' }, { status: 400 });
    }

    const opts: {
      leagueId: string;
      week?: number;
      playerId?: string;
      rosterId?: number;
    } = { leagueId };

    if (week !== undefined) {
      if (typeof week !== 'number' || week < 1 || week > 18) {
        return NextResponse.json({ ok: false, error: 'week must be a number between 1 and 18' }, { status: 400 });
      }
      opts.week = week;
    }

    if (playerId) {
      opts.playerId = playerId;
    }

    if (rosterId !== undefined) {
      if (typeof rosterId !== 'number') {
        return NextResponse.json({ ok: false, error: 'rosterId must be a number' }, { status: 400 });
      }
      opts.rosterId = rosterId;
    }

    const scores = await getPlayerScores(opts);

    return NextResponse.json({
      ok: true,
      data: scores,
      count: scores.length
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'failed to fetch player scores' }, { status: 500 });
  }
}