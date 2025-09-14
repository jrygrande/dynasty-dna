import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { sql } from 'drizzle-orm';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const leagueId = searchParams.get('leagueId') || searchParams.get('league_id');
    if (!leagueId) return NextResponse.json({ ok: false, error: 'leagueId required' }, { status: 400 });
    const db = await getDb();
    const counts = await db.execute(sql`SELECT 
      (SELECT count(*)::int FROM rosters WHERE league_id = ${leagueId}) as rosters,
      (SELECT count(*)::int FROM transactions WHERE league_id = ${leagueId}) as transactions,
      (SELECT count(*)::int FROM matchups WHERE league_id = ${leagueId}) as matchups
    `);
    const rowsObj: any = Array.isArray(counts) ? (counts as any)[0] : (counts as any).rows?.[0];
    const tx = await db.execute(sql`SELECT id, type, week FROM transactions WHERE league_id = ${leagueId} ORDER BY created_at DESC LIMIT 5;`);
    const txRows: any[] = Array.isArray(tx) ? (tx as any) : (tx as any).rows ?? [];
    return NextResponse.json({ ok: true, counts: rowsObj, recentTransactions: txRows });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'debug failed' }, { status: 500 });
  }
}

