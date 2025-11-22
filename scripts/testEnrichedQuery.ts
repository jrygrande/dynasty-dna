import 'dotenv/config';
import { getEnrichedTransactionsForAsset } from '@/repositories/enrichedTransactions';

async function testQuery() {
    const leagueId = '926647116724891648';
    const playerId = '4866';

    console.log(`Querying enriched transactions for league ${leagueId}, player ${playerId}...`);

    const results = await getEnrichedTransactionsForAsset(leagueId, playerId);

    console.log(`Found ${results.length} enriched transactions`);
    console.log(JSON.stringify(results, null, 2));
}

testQuery().catch(console.error);
