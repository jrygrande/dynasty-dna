import { NextRequest, NextResponse } from 'next/server';
import { syncNFLState } from '@/services/system';

export async function POST() {
  try {
    const result = await syncNFLState();
    return NextResponse.json({ ok: true, result });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'state sync failed' }, { status: 500 });
  }
}

export async function GET() {
  return POST();
}

