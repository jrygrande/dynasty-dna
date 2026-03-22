import { getDb, schema } from "@/db";
import { sql } from "drizzle-orm";

export const BATCH_SIZE = 200;

/**
 * Batch-insert helper: chunks an array and inserts each chunk.
 * The onConflict callback receives the insert query builder and must return it
 * (with .onConflictDoUpdate/DoNothing/etc applied).
 */
export async function batchInsert<T extends Record<string, unknown>>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: any,
  values: T[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onConflict: (query: any) => any,
  chunkSize = BATCH_SIZE
): Promise<void> {
  if (values.length === 0) return;
  const db = getDb();
  for (let i = 0; i < values.length; i += chunkSize) {
    const chunk = values.slice(i, i + chunkSize);
    const query = db.insert(table).values(chunk);
    await onConflict(query);
  }
}

/**
 * Batch upsert into managerMetrics. Shared by draftGrading, lineupGrading, and managerGrades.
 */
export async function batchUpsertManagerMetrics(
  values: Array<typeof schema.managerMetrics.$inferInsert>
): Promise<void> {
  if (values.length === 0) return;
  const db = getDb();
  for (let i = 0; i < values.length; i += BATCH_SIZE) {
    await db
      .insert(schema.managerMetrics)
      .values(values.slice(i, i + BATCH_SIZE))
      .onConflictDoUpdate({
        target: [
          schema.managerMetrics.leagueId,
          schema.managerMetrics.managerId,
          schema.managerMetrics.metric,
          schema.managerMetrics.scope,
        ],
        set: {
          value: sql`excluded.value`,
          percentile: sql`excluded.percentile`,
          meta: sql`excluded.meta`,
          computedAt: sql`excluded.computed_at`,
        },
      });
  }
}
