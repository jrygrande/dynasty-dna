import { NextResponse } from 'next/server';
import { getDb } from '@/db/index';

export async function GET() {
  let dbStatus: 'ok' | 'not_configured' | 'error' = 'not_configured';
  const details: Record<string, any> = {};
  try {
    await getDb();
    dbStatus = 'ok';
  } catch (e: any) {
    dbStatus = 'error';
    if (process.env.NODE_ENV !== 'production') {
      details.error = e?.message || String(e);
    }
  }
  return NextResponse.json({ ok: true, status: 'healthy', db: dbStatus, details, ts: new Date().toISOString() });
}
