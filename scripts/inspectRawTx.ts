import 'dotenv/config';
import { getDb } from '@/db/index';
import { transactions } from '@/db/schema';
import { eq } from 'drizzle-orm';

async function inspectRawTransaction() {
    const txId = '746403067540529152';
    console.log(`Fetching raw transaction ${txId}...`);

    const db = await getDb();
    const rows = await db.select()
        .from(transactions)
        .where(eq(transactions.id, txId));

    if (rows.length === 0) {
        console.log('Transaction not found');
        return;
    }

    const tx = rows[0];
    console.log('Transaction ID:', tx.id);
    console.log('Type:', tx.type);
    console.log('Status:', tx.status);
    console.log('Roster IDs:', tx.rosterIds);
    console.log('Creator:', tx.creator);
    console.log('Payload:', JSON.stringify(tx.payload, null, 2));
}

inspectRawTransaction().catch(console.error);
