import { NextRequest, NextResponse } from 'next/server';
import { syncLeague } from '@/services/sync';

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get('content-type') || '';
    let leagueId: string | undefined;
    if (contentType.includes('application/json')) {
      const body = await req.json().catch(() => ({}));
      leagueId = body.leagueId || body.league_id;
    }
    if (!leagueId) {
      const { searchParams } = new URL(req.url);
      leagueId = searchParams.get('leagueId') || searchParams.get('league_id') || undefined;
    }
    if (!leagueId) {
      return NextResponse.json({ ok: false, error: 'leagueId required' }, { status: 400 });
    }
    // Basic validation: Sleeper league IDs are numeric strings, typically > 6 chars
    const isValid = /^\d{6,}$/.test(String(leagueId));
    if (!isValid) {
      return NextResponse.json({ ok: false, error: `invalid leagueId: ${leagueId}` }, { status: 400 });
    }

    const result = await syncLeague(leagueId);
    return NextResponse.json({ ok: true, result });
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
