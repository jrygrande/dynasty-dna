import { NextRequest, NextResponse } from 'next/server';
import { syncUser } from '@/services/sync';

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get('content-type') || '';
    let username: string | undefined;
    let userId: string | undefined;
    if (contentType.includes('application/json')) {
      const body = await req.json().catch(() => ({}));
      username = body.username;
      userId = body.userId || body.user_id;
    }
    if (!username && !userId) {
      const { searchParams } = new URL(req.url);
      username = searchParams.get('username') || undefined;
      userId = searchParams.get('userId') || searchParams.get('user_id') || undefined;
    }
    if (!username && !userId) {
      return NextResponse.json({ ok: false, error: 'username or userId required' }, { status: 400 });
    }
    const result = await syncUser({ username, userId });
    return NextResponse.json({ ok: true, result });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'sync failed' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  // Allow GET for convenience in the browser
  return POST(req);
}

export async function OPTIONS() {
  return NextResponse.json({}, { status: 200 });
}
