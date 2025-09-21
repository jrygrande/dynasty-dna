import { NextRequest, NextResponse } from 'next/server';
import { Sleeper } from '@/lib/sleeper';
import { upsertPlayerScoresBulk } from '@/repositories/playerScores';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { leagueId, week } = body;

    if (!leagueId) {
      return NextResponse.json({ ok: false, error: 'leagueId is required' }, { status: 400 });
    }

    if (week !== undefined && (typeof week !== 'number' || week < 1 || week > 18)) {
      return NextResponse.json({ ok: false, error: 'week must be a number between 1 and 18' }, { status: 400 });
    }

    let weekList: number[] = [];
    if (week !== undefined) {
      weekList = [week];
    } else {
      // If no week specified, sync all available weeks
      const state = await Sleeper.getState();
      const currentWeek = Number(state.week ?? 18);
      weekList = Array.from({ length: Math.min(Math.max(currentWeek, 18), 18) }, (_, i) => i + 1);
    }

    let totalPlayerScores = 0;

    for (const weekNum of weekList) {
      const matchups = await Sleeper.getLeagueMatchups(leagueId, weekNum);

      const playerScoreRows: Array<{
        leagueId: string;
        week: number;
        rosterId: number;
        playerId: string;
        points: number;
        isStarter: boolean;
      }> = [];

      for (const m of matchups) {
        const rosterId = Number(m.roster_id);
        const starters = Array.isArray(m.starters) ? m.starters : [];
        const startersPoints = Array.isArray(m.starters_points) ? m.starters_points : [];
        const playersPoints = m.players_points && typeof m.players_points === 'object' ? m.players_points : {};

        // Add starter scores
        starters.forEach((playerId: string, index: number) => {
          if (playerId && startersPoints[index] !== undefined) {
            playerScoreRows.push({
              leagueId,
              week: weekNum,
              rosterId,
              playerId: String(playerId),
              points: Number(startersPoints[index]) || 0,
              isStarter: true,
            });
          }
        });

        // Add bench player scores
        Object.entries(playersPoints).forEach(([playerId, points]) => {
          if (playerId && !starters.includes(playerId)) {
            playerScoreRows.push({
              leagueId,
              week: weekNum,
              rosterId,
              playerId: String(playerId),
              points: Number(points) || 0,
              isStarter: false,
            });
          }
        });
      }

      if (playerScoreRows.length > 0) {
        totalPlayerScores += await upsertPlayerScoresBulk(playerScoreRows);
      }
    }

    return NextResponse.json({
      ok: true,
      result: {
        leagueId,
        weeks: weekList,
        playerScores: totalPlayerScores
      }
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'player scores sync failed' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}