import { NextRequest, NextResponse } from 'next/server';
import { syncLeague } from '@/services/sync';

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get('content-type') || '';
    let leagueId: string | undefined;
    let background = false;
    let incremental = false;
    let expectedVersion: number | undefined;

    if (contentType.includes('application/json')) {
      const body = await req.json().catch(() => ({}));
      leagueId = body.leagueId || body.league_id;
      background = body.background || false;
      incremental = body.incremental || false;
      expectedVersion = body.expectedVersion;
    }
    if (!leagueId) {
      const { searchParams } = new URL(req.url);
      leagueId = searchParams.get('leagueId') || searchParams.get('league_id') || undefined;
      background = searchParams.get('background') === 'true';
      incremental = searchParams.get('incremental') === 'true';
      const versionParam = searchParams.get('expectedVersion');
      expectedVersion = versionParam ? parseInt(versionParam) : undefined;
    }
    if (!leagueId) {
      return NextResponse.json({ ok: false, error: 'leagueId required' }, { status: 400 });
    }
    // Basic validation: Sleeper league IDs are numeric strings, typically > 6 chars
    const isValid = /^\d{6,}$/.test(String(leagueId));
    if (!isValid) {
      return NextResponse.json({ ok: false, error: `invalid leagueId: ${leagueId}` }, { status: 400 });
    }

    // Optimistic locking: verify sync version hasn't changed (prevents race conditions)
    if (expectedVersion !== undefined) {
      const { getLeagueSyncInfo } = await import('@/repositories/leagues');
      const syncInfo = await getLeagueSyncInfo(leagueId);
      if (syncInfo && syncInfo.syncVersion !== expectedVersion) {
        console.log(`[Sync] Version mismatch for league ${leagueId}: expected ${expectedVersion}, got ${syncInfo.syncVersion}`);
        return NextResponse.json({
          ok: false,
          error: 'Sync version mismatch - another sync may have started'
        }, { status: 409 });
      }
    }

    if (background) {
      // For background sync, return immediately and run sync asynchronously
      // Use setImmediate/Promise.resolve() to ensure sync runs in next tick
      Promise.resolve().then(async () => {
        try {
          await syncLeague(leagueId, { incremental });
          console.log(`Background sync completed for league ${leagueId}`);
        } catch (error) {
          console.error(`Background sync failed for league ${leagueId}:`, error);
        }
      });
      return NextResponse.json({ ok: true, message: 'Background sync initiated' });
    } else {
      const result = await syncLeague(leagueId, { incremental });
      return NextResponse.json({ ok: true, result });
    }
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'sync failed' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  // Convenience wrapper to allow triggering from the browser
  return POST(req);
}

export async function OPTIONS() {
  return NextResponse.json({}, { status: 200 });
}
