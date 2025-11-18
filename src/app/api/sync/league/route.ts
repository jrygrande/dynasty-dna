import { NextRequest, NextResponse } from 'next/server';
import { syncLeague } from '@/services/sync';

const KEEP_ALIVE_INTERVAL_MS = 15000;

// Ensure the handler runs in the Node.js runtime where streaming responses are supported.
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const { leagueId, incremental, expectedVersion } = await parseRequest(req);

    if (!leagueId) {
      return NextResponse.json({ ok: false, error: 'leagueId required' }, { status: 400 });
    }

    // Basic validation: Sleeper league IDs are numeric strings, typically > 6 chars
    if (!/^\d{6,}$/.test(String(leagueId))) {
      return NextResponse.json({ ok: false, error: `invalid leagueId: ${leagueId}` }, { status: 400 });
    }

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

    return streamSyncResponse(async () => {
      const result = await syncLeague(leagueId, { incremental });
      return { ok: true, result } as const;
    });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || 'sync failed' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  // Convenience wrapper to allow triggering from the browser
  return POST(req);
}

export async function OPTIONS() {
  return NextResponse.json({}, { status: 200 });
}

async function parseRequest(req: NextRequest) {
  const contentType = req.headers.get('content-type') || '';
  let leagueId: string | undefined;
  let incremental = false;
  let expectedVersion: number | undefined;

  if (contentType.includes('application/json')) {
    const body = await req.json().catch(() => ({}));
    leagueId = body.leagueId || body.league_id;
    incremental = body.incremental || false;
    expectedVersion = body.expectedVersion;
  }

  if (!leagueId) {
    const { searchParams } = new URL(req.url);
    leagueId = searchParams.get('leagueId') || searchParams.get('league_id') || undefined;
    incremental = searchParams.get('incremental') === 'true';
    const versionParam = searchParams.get('expectedVersion');
    expectedVersion = versionParam ? parseInt(versionParam) : undefined;
  }

  return { leagueId, incremental, expectedVersion };
}

function streamSyncResponse(task: () => Promise<{ ok: true; result: any }>) {
  const encoder = new TextEncoder();
  let keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      keepAliveTimer = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(' '));
        } catch (error) {
          console.error('[Sync] Keep-alive enqueue failed:', error);
        }
      }, KEEP_ALIVE_INTERVAL_MS);

      try {
        const payload = await task();
        if (keepAliveTimer) clearInterval(keepAliveTimer);
        controller.enqueue(encoder.encode(JSON.stringify(payload)));
      } catch (error: any) {
        if (keepAliveTimer) clearInterval(keepAliveTimer);
        const message = error?.message || 'sync failed';
        controller.enqueue(encoder.encode(JSON.stringify({ ok: false, error: message })));
      } finally {
        controller.close();
      }
    },
    cancel() {
      if (keepAliveTimer) {
        clearInterval(keepAliveTimer);
        keepAliveTimer = null;
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}
