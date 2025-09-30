import { NextRequest, NextResponse } from 'next/server';
import { getLeagueSyncInfo, updateLeagueSyncStatus } from '@/repositories/leagues';

export async function POST(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const leagueId = searchParams.get('leagueId');

    if (!leagueId) {
      return NextResponse.json({ ok: false, error: 'leagueId required' }, { status: 400 });
    }

    // Get current sync status
    const syncInfo = await getLeagueSyncInfo(leagueId);

    if (!syncInfo) {
      return NextResponse.json({
        ok: false,
        error: 'League not found'
      }, { status: 404 });
    }

    // Reset stuck sync
    if (syncInfo.syncStatus === 'syncing') {
      await updateLeagueSyncStatus(leagueId, 'failed');
      return NextResponse.json({
        ok: true,
        message: 'Stuck sync reset to failed status',
        leagueId,
        previousStatus: 'syncing'
      });
    }

    return NextResponse.json({
      ok: true,
      message: 'No stuck sync found',
      leagueId,
      currentStatus: syncInfo.syncStatus
    });
  } catch (error: any) {
    console.error('Reset stuck sync error:', error);
    return NextResponse.json(
      { ok: false, error: error?.message || 'Failed to reset stuck sync' },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  return POST(req);
}