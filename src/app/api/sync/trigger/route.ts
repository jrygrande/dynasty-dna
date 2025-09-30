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
      // Check if sync is stuck (> 5 minutes)
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      if (syncInfo.lastSyncAt && syncInfo.lastSyncAt < fiveMinutesAgo) {
        // Sync is stuck, reset and allow new sync
        console.warn(`Sync stuck for league ${leagueId}, resetting status`);
        await updateLeagueSyncStatus(leagueId, 'failed');
      } else {
        // Sync is already in progress, don't start another
        return NextResponse.json({
          ok: true,
          message: 'Sync already in progress',
          alreadyRunning: true
        });
      }
    }

    // Trigger background sync by calling the league sync endpoint
    // Use the internal API URL
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : process.env.NEXTAUTH_URL || 'http://localhost:3000';

    const syncUrl = `${baseUrl}/api/sync/league?leagueId=${leagueId}&background=true&incremental=true`;

    // Fire-and-forget: don't await the response
    fetch(syncUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    }).catch(error => {
      console.error(`Failed to trigger sync for league ${leagueId}:`, error);
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