import { NextRequest, NextResponse } from 'next/server';
import { getLeagueSyncInfo, updateLeagueSyncStatus } from '@/repositories/leagues';

export async function POST(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const leagueId = searchParams.get('leagueId');

    if (!leagueId) {
      return NextResponse.json({ ok: false, error: 'leagueId required' }, { status: 400 });
    }

    // Check current sync status
    const syncInfo = await getLeagueSyncInfo(leagueId);

    // Prevent duplicate syncs
    if (syncInfo?.syncStatus === 'syncing') {
      // Check if sync is stuck (> 5 minutes since it STARTED)
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      const isStuck = syncInfo.syncStartedAt && syncInfo.syncStartedAt < fiveMinutesAgo;

      if (isStuck) {
        // Sync is stuck, reset and allow new sync
        console.warn(`[Sync] Stuck sync detected for league ${leagueId}, started at ${syncInfo.syncStartedAt?.toISOString() || 'unknown'}`);
        await updateLeagueSyncStatus(leagueId, 'failed');
      } else {
        // Sync is already in progress and not stuck, don't start another
        const startedAgo = syncInfo.syncStartedAt
          ? Math.floor((Date.now() - syncInfo.syncStartedAt.getTime()) / 1000)
          : 0;
        console.log(`[Sync] Sync already in progress for league ${leagueId} (started ${startedAgo}s ago)`);
        return NextResponse.json({
          ok: true,
          message: 'Sync already in progress',
          alreadyRunning: true,
          startedAt: syncInfo.syncStartedAt?.toISOString()
        });
      }
    }

    console.log(`[Sync] Triggering sync for league ${leagueId}`);

    // Get current sync version for optimistic locking
    const currentVersion = syncInfo?.syncVersion || 1;

    // Trigger background sync by calling the league sync endpoint
    // Use request URL to get base URL (works in all environments)
    const baseUrl = new URL(req.url).origin;
    const syncUrl = `${baseUrl}/api/sync/league?leagueId=${leagueId}&background=true&incremental=true&expectedVersion=${currentVersion}`;

    // Fire-and-forget: don't await the response
    fetch(syncUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    }).catch(error => {
      console.error(`[Sync] Failed to trigger sync for league ${leagueId}:`, error);
    });

    return NextResponse.json({
      ok: true,
      message: 'Sync triggered successfully',
      leagueId
    });
  } catch (error: any) {
    console.error('Trigger sync error:', error);
    return NextResponse.json(
      { ok: false, error: error?.message || 'Failed to trigger sync' },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  return POST(req);
}