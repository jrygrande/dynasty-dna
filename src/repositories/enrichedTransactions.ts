import { getDb } from '@/db/index';
import { enrichedTransactions } from '@/db/schema';
import { eq, inArray, and, sql, desc } from 'drizzle-orm';

export type EnrichedTransaction = typeof enrichedTransactions.$inferSelect;
export type NewEnrichedTransaction = typeof enrichedTransactions.$inferInsert;

export async function saveEnrichedTransactions(transactions: NewEnrichedTransaction[]) {
    if (transactions.length === 0) return;

    const db = await getDb();

    // Upsert transactions based on ID
    await db.insert(enrichedTransactions)
        .values(transactions)
        .onConflictDoUpdate({
            target: enrichedTransactions.id,
            set: {
                status: sql`excluded.status`,
                timestamp: sql`excluded.timestamp`,
                managers: sql`excluded.managers`,
                assets: sql`excluded.assets`,
                metadata: sql`excluded.metadata`,
            }
        });
}

export async function getEnrichedTransactions(leagueId: string) {
    const db = await getDb();
    return db.select()
        .from(enrichedTransactions)
        .where(eq(enrichedTransactions.leagueId, leagueId))
        .orderBy(desc(enrichedTransactions.timestamp));
}

export async function getEnrichedTransaction(id: string) {
    const db = await getDb();
    const rows = await db.select()
        .from(enrichedTransactions)
        .where(eq(enrichedTransactions.id, id));
    return rows[0] || null;
}

export async function getEnrichedTransactionsForAsset(leagueId: string, assetId: string) {
    const db = await getDb();

    // Use SQL to query the JSONB assets array
    // We want transactions where the assets array contains an object with the given id
    return db.select()
        .from(enrichedTransactions)
        .where(and(
            eq(enrichedTransactions.leagueId, leagueId),
            sql`EXISTS (
        SELECT 1 FROM jsonb_array_elements(${enrichedTransactions.assets}) as a 
        WHERE a->>'id' = ${assetId}
      )`
        ))
        .orderBy(desc(enrichedTransactions.timestamp));
}
