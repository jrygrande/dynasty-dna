import 'dotenv/config';
import { getDb } from '@/db/index';
import { transactions, drafts, draftPicks, rosters, users, leagues } from '@/db/schema';
import { saveEnrichedTransactions } from '@/repositories/enrichedTransactions';
import { processTransactionToEnriched, processDraftPickToEnriched } from '@/lib/utils/enrichedTransactions';
import { getPlayersByIds } from '@/repositories/players';
import { eq, inArray } from 'drizzle-orm';
import { batchFetchUsers } from '@/services/assets'; // Need to export this or duplicate logic

// Duplicate batchFetchUsers logic since it wasn't exported
async function fetchUsersMap(userIds: string[]): Promise<Map<string, { displayName: string }>> {
    if (!userIds.length) return new Map();
    const db = await getDb();
    const rows = await db.select().from(users).where(inArray(users.id, userIds));
    const map = new Map();
    for (const u of rows) {
        map.set(u.id, { displayName: u.displayName || u.username });
    }
    return map;
}

async function main() {
    console.log('Starting backfill of enriched transactions...');
    const db = await getDb();

    // Get all leagues
    const allLeagues = await db.select().from(leagues);
    console.log(`Found ${allLeagues.length} leagues.`);

    for (const league of allLeagues) {
        console.log(`Processing league ${league.name} (${league.id})...`);
        const leagueId = league.id;

        // 1. Build Roster Map
        const rosterRows = await db.select().from(rosters).where(eq(rosters.leagueId, leagueId));
        const rosterOwnerMap = new Map<number, string>();
        for (const r of rosterRows) rosterOwnerMap.set(r.rosterId, r.ownerId);

        // Fetch Users
        const userIds = Array.from(new Set(rosterRows.map(r => r.ownerId)));
        const usersMap = await fetchUsersMap(userIds);

        // Enriched Roster Map
        const enrichedRosterMap = new Map<number, { ownerId: string; displayName: string }>();
        for (const r of rosterRows) {
            const user = usersMap.get(r.ownerId);
            enrichedRosterMap.set(r.rosterId, {
                ownerId: r.ownerId,
                displayName: user?.displayName || 'Unknown'
            });
        }

        const enrichedTxs: any[] = [];

        // 2. Process Transactions
        const txs = await db.select().from(transactions).where(eq(transactions.leagueId, leagueId));
        for (const t of txs) {
            const enriched = processTransactionToEnriched(t, enrichedRosterMap, usersMap);
            if (enriched) enrichedTxs.push(enriched);
        }

        // 3. Process Draft Picks
        const leagueDrafts = await db.select().from(drafts).where(eq(drafts.leagueId, leagueId));

        // Pre-fetch draft players
        const allDraftPlayerIds = new Set<string>();
        for (const d of leagueDrafts) {
            const picks = await db.select().from(draftPicks).where(eq(draftPicks.draftId, d.id));
            for (const p of picks) {
                if (p.playerId) allDraftPlayerIds.add(p.playerId);
            }
        }
        const draftPlayers = await getPlayersByIds(Array.from(allDraftPlayerIds));
        const draftPlayerMap = new Map(draftPlayers.map(p => [p.id, p]));

        for (const d of leagueDrafts) {
            const picks = await db.select().from(draftPicks).where(eq(draftPicks.draftId, d.id));
            console.log(`Draft ${d.id}: Found ${picks.length} picks.`);
            if (picks.length > 0) {
                console.log('First pick sample:', JSON.stringify(picks[0], null, 2));
            }
            let draftSelectionsCount = 0;
            for (const p of picks) {
                if (p.playerId && p.rosterId) {
                    // Enriched Draft Selection
                    const ownerId = rosterOwnerMap.get(p.rosterId);
                    if (ownerId) {
                        // Create a specific map for this draft context if needed, or reuse league map
                        // The helper expects a map with owner info. enrichedRosterMap has it.
                        const enriched = processDraftPickToEnriched(
                            p,
                            d,
                            enrichedRosterMap,
                            draftPlayerMap
                        );
                        if (enriched) {
                            enrichedTxs.push(enriched);
                            draftSelectionsCount++;
                        }
                    } else {
                        console.log(`Pick ${p.pickNo}: Roster ${p.rosterId} has no owner?`);
                    }
                }
            }
            console.log(`Draft ${d.id}: Processed ${draftSelectionsCount} selections.`);
        }

        // Save
        if (enrichedTxs.length > 0) {
            await saveEnrichedTransactions(enrichedTxs);
            console.log(`Saved ${enrichedTxs.length} enriched transactions for league ${leagueId}`);
        }
    }

    console.log('Backfill complete.');
    process.exit(0);
}

main().catch(console.error);
