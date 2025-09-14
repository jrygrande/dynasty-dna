import { NextRequest, NextResponse } from 'next/server';
import { getUser, discoverDynastyLeaguesForUser } from '@/services/discovery';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const username = searchParams.get('username') || undefined;
    const userId = searchParams.get('userId') || searchParams.get('user_id') || undefined;
    if (!username && !userId) {
      return NextResponse.json({ ok: false, error: 'username or userId required' }, { status: 400 });
    }
    const user = await getUser({ username, userId });
    const leagues = await discoverDynastyLeaguesForUser(user.user_id);
    return NextResponse.json({ ok: true, user: { id: user.user_id, username: user.username }, leagues });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'discover failed' }, { status: 500 });
  }
}

