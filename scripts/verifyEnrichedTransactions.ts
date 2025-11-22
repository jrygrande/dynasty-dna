import 'dotenv/config';
import { getDb } from '@/db/index';
import { enrichedTransactions } from '@/db/schema';
import { eq, like, or } from 'drizzle-orm';

async function main() {
    console.log('Verifying enriched transactions...');
    const db = await getDb();

    // 1. Verify Saquon Barkley Trade
    // Transaction ID: 746403067540529152 (from previous debugging)
    const saquonTrade = await db.select().from(enrichedTransactions).where(eq(enrichedTransactions.id, '746403067540529152'));

    if (saquonTrade.length > 0) {
        console.log('\n✅ Found Saquon Barkley Trade:');
        const t = saquonTrade[0];
        console.log(`ID: ${t.id}`);
        console.log(`Type: ${t.type}`);
        console.log('Managers:', JSON.stringify(t.managers, null, 2));
        console.log('Assets:', JSON.stringify(t.assets, null, 2));
    } else {
        console.error('\n❌ Saquon Barkley Trade NOT FOUND!');
    }

    // 2. Verify a Draft Selection
    // Look for any draft selection
    const draftSelections = await db.select().from(enrichedTransactions).where(eq(enrichedTransactions.type, 'draft_selection')).limit(1);

    if (draftSelections.length > 0) {
        console.log('\n✅ Found Draft Selection:');
        const t = draftSelections[0];
        console.log(`ID: ${t.id}`);
        console.log(`Type: ${t.type}`);
        console.log('Managers:', JSON.stringify(t.managers, null, 2));
        console.log('Assets:', JSON.stringify(t.assets, null, 2));
    } else {
        console.error('\n❌ No Draft Selections found!');
    }

    process.exit(0);
}

main().catch(console.error);
