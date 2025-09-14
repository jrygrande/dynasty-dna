import { getDb } from '@/db/index';
import { sql } from 'drizzle-orm';

export type JobRun = {
  id: string;
  type: string;
  ref?: string | null;
  status: 'running' | 'completed' | 'error';
  total?: number | null;
  done?: number | null;
  error?: string | null;
  started_at?: string;
  finished_at?: string | null;
};

export async function createJob(type: string, ref?: string | null, total?: number | null): Promise<string> {
  const db = await getDb();
  const res = await db.execute(sql`INSERT INTO job_runs (type, ref, status, total, done)
    VALUES (${type}, ${ref ?? null}, 'running', ${total ?? null}, 0) RETURNING id;`);
  const row: any = Array.isArray(res) ? (res as any)[0] : (res as any).rows?.[0];
  return row?.id ?? row?.ID ?? row?.id?.toString?.() ?? '';
}

export async function updateJobProgress(id: string, done: number) {
  const db = await getDb();
  await db.execute(sql`UPDATE job_runs SET done = ${done} WHERE id = ${id};`);
}

export async function completeJob(id: string) {
  const db = await getDb();
  await db.execute(sql`UPDATE job_runs SET status = 'completed', finished_at = now() WHERE id = ${id};`);
}

export async function failJob(id: string, message: string) {
  const db = await getDb();
  await db.execute(sql`UPDATE job_runs SET status = 'error', error = ${message}, finished_at = now() WHERE id = ${id};`);
}

