import 'dotenv/config';
import { getEnrichedTransaction } from '@/repositories/enrichedTransactions';

async function inspectTransaction() {
    // Saquon trade ID from previous verification: 746403067540529152
    const txId = '746403067540529152';
    console.log(`Fetching transaction ${txId}...`);

    const tx = await getEnrichedTransaction(txId);

    if (!tx) {
        console.log('Transaction not found');
        return;
    }

    console.log('Transaction Type:', tx.type);
    console.log('Managers:', JSON.stringify(tx.managers, null, 2));
    console.log('Assets:', JSON.stringify(tx.assets, null, 2));
}

inspectTransaction().catch(console.error);
