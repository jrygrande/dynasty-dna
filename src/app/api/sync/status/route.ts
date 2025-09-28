import { NextRequest, NextResponse } from 'next/server';
import { getLeagueSyncInfo, isLeagueDataStale } from '@/repositories/leagues';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const leagueId = searchParams.get('leagueId');

    if (!leagueId) {
      return NextResponse.json({ ok: false, error: 'leagueId required' }, { status: 400 });
    }

    // Get sync info from database
    const syncInfo = await getLeagueSyncInfo(leagueId);

    if (!syncInfo) {
      return NextResponse.json({
        ok: true,
        lastSyncAt: null,
        syncStatus: 'idle',
        isStale: true,
        checkedAt: new Date().toISOString(),
      });
    }

    // Determine staleness based on current time and season
    const now = new Date();
    const currentHour = now.getHours();
    const currentDay = now.getDay(); // 0 = Sunday, 1 = Monday, etc.
    const thresholdHours = getDataStalenessThreshold(currentDay, currentHour);

    const isStale = await isLeagueDataStale(leagueId, thresholdHours);

    return NextResponse.json({
      ok: true,
      lastSyncAt: syncInfo.lastSyncAt?.toISOString() || null,
      syncStatus: syncInfo.syncStatus || 'idle',
      syncVersion: syncInfo.syncVersion,
      isStale,
      thresholdHours,
      checkedAt: now.toISOString(),
    });
  } catch (error: any) {
    console.error('Sync status check error:', error);
    return NextResponse.json(
      { ok: false, error: error?.message || 'Failed to check sync status' },
      { status: 500 }
    );
  }
}

function getDataStalenessThreshold(dayOfWeek: number, hour: number): number {
  // Determine if we're in NFL season (roughly September through January)
  const now = new Date();
  const month = now.getMonth(); // 0-11
  const isNFLSeason = month >= 8 || month <= 0; // Sep-Jan

  if (!isNFLSeason) {
    // Off-season: 24 hour threshold
    return 24;
  }

  // During NFL season, use dynamic thresholds
  const isSunday = dayOfWeek === 0;
  const isMonday = dayOfWeek === 1;
  const isThursday = dayOfWeek === 4;

  // Game days with more frequent updates
  if (isSunday || isMonday || isThursday) {
    // During game hours (12pm-11pm ET), use 1 hour threshold
    if (hour >= 12 && hour <= 23) {
      return 1;
    }
    // Other times on game days, use 3 hour threshold
    return 3;
  }

  // Non-game days during season: 6 hour threshold
  return 6;
}