import { NextRequest, NextResponse } from 'next/server';
import { seedNFLSeasonsRange } from '@/services/system';

export async function POST(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const from = Number(searchParams.get('from') || '2021');
    const to = Number(searchParams.get('to') || '2025');
    const maxWeek = Number(searchParams.get('maxWeek') || '18');
    const result = await seedNFLSeasonsRange(from, to, { maxWeek });
    return NextResponse.json({ ok: true, result: { from, to, maxWeek, ...result } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'seed failed' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return POST(req);
}

