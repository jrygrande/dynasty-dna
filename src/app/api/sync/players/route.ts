import { NextRequest, NextResponse } from 'next/server';
import { syncPlayers } from '@/services/system';

export async function POST() {
  try {
    const result = await syncPlayers();
    return NextResponse.json({ ok: true, result });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'players sync failed' }, { status: 500 });
  }
}

export async function GET() {
  return POST();
}

