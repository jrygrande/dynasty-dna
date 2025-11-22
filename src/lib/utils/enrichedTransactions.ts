import { EnrichedTransaction } from '@/repositories/enrichedTransactions';

export interface TransactionManager {
    rosterId: number;
    userId: string;
    displayName: string;
    side: 'proposer' | 'consenter' | 'selector' | null;
}

export interface TransactionAsset {
    kind: 'player' | 'pick';
    id: string;
    name: string;
    fromRosterId: number | null;
    toRosterId: number | null;
    fromUserId: string | null;
    toUserId: string | null;
}

/**
 * Transform a raw Sleeper transaction into an EnrichedTransaction
 */
export function processTransactionToEnriched(
    transaction: any,
    rosterMap: Map<number, { ownerId: string; displayName: string }>,
    usersMap: Map<string, { displayName: string }>
): EnrichedTransaction | null {
    const payload = transaction.payload || {};
    const type = transaction.type;
    const status = transaction.status || 'complete';

    // Skip incomplete transactions if needed, but usually we want history

    const managers: TransactionManager[] = [];
    const assets: TransactionAsset[] = [];

    // 1. Identify Managers
    // For trades, we have roster_ids in the payload
    if (type === 'trade') {
        const rosterIds = payload.roster_ids || [];
        for (const rid of rosterIds) {
            const roster = rosterMap.get(rid);
            if (roster) {
                managers.push({
                    rosterId: rid,
                    userId: roster.ownerId,
                    displayName: roster.displayName,
                    side: rid === payload.creator ? 'proposer' : 'consenter'
                });
            }
        }
    } else if (type === 'waiver' || type === 'free_agent') {
        // For waivers/FA, usually one roster involved
        const rid = payload.roster_ids?.[0];
        if (rid) {
            const roster = rosterMap.get(rid);
            if (roster) {
                managers.push({
                    rosterId: rid,
                    userId: roster.ownerId,
                    displayName: roster.displayName,
                    side: 'proposer'
                });
            }
        }
    }

    // 2. Process Adds (Players)
    const adds = payload.adds || {};
    for (const [playerId, rosterIdRaw] of Object.entries(adds)) {
        const toRosterId = Number(rosterIdRaw);
        const roster = rosterMap.get(toRosterId);

        // Find if this player was dropped in the same transaction (trade)
        const drops = payload.drops || {};
        const fromRosterIdRaw = drops[playerId];
        const fromRosterId = fromRosterIdRaw ? Number(fromRosterIdRaw) : null;
        const fromRoster = fromRosterId ? rosterMap.get(fromRosterId) : null;

        assets.push({
            kind: 'player',
            id: playerId,
            name: '', // Needs to be filled by caller with player map
            fromRosterId: fromRosterId,
            toRosterId: toRosterId,
            fromUserId: fromRoster?.ownerId || null,
            toUserId: roster?.ownerId || null,
        });
    }

    // 3. Process Drops (Players not in adds - i.e. dropped to waivers)
    const drops = payload.drops || {};
    for (const [playerId, rosterIdRaw] of Object.entries(drops)) {
        // If already processed in adds (trade), skip
        if (adds[playerId]) continue;

        const fromRosterId = Number(rosterIdRaw);
        const roster = rosterMap.get(fromRosterId);

        assets.push({
            kind: 'player',
            id: playerId,
            name: '', // Needs to be filled by caller
            fromRosterId: fromRosterId,
            toRosterId: null, // Dropped to waivers/FA
            fromUserId: roster?.ownerId || null,
            toUserId: null,
        });
    }

    // 4. Process Draft Picks (Trades)
    const draftPicks = payload.draft_picks || [];
    for (const pick of draftPicks) {
        const season = pick.season;
        const round = pick.round;
        const originalRosterId = Number(pick.roster_id || pick.roster); // Original owner

        // Determine movement
        const fromOwnerId = pick.previous_owner_id;
        const toOwnerId = pick.owner_id;

        // Map owner IDs (which could be roster IDs or user IDs) to Roster IDs if possible
        // Sleeper is inconsistent here. In `draft_picks` array, these are usually Roster IDs.
        const fromRosterId = Number(fromOwnerId);
        const toRosterId = Number(toOwnerId);

        const fromRoster = rosterMap.get(fromRosterId);
        const toRoster = rosterMap.get(toRosterId);

        assets.push({
            kind: 'pick',
            id: `pick-${season}-${round}-${originalRosterId}`,
            name: `${season} Round ${round} Pick`, // Can be refined
            fromRosterId: fromRosterId,
            toRosterId: toRosterId,
            fromUserId: fromRoster?.ownerId || null,
            toUserId: toRoster?.ownerId || null,
        });
    }

    // 5. FAAB
    const faab = payload.faab_bid;
    if (faab) {
        // Could add FAAB as an asset or metadata
    }

    // Helper to safely parse timestamp
    const getTimestamp = () => {
        if (payload.status_updated) return new Date(payload.status_updated);
        if (payload.created) return new Date(payload.created);
        if (transaction.createdAt) return new Date(transaction.createdAt);
        return new Date();
    };

    return {
        id: transaction.id,
        leagueId: transaction.leagueId,
        type: type,
        status: status,
        timestamp: getTimestamp(),
        managers: managers,
        assets: assets,
        metadata: { faab: faab },
        createdAt: new Date(),
    };
}

/**
 * Transform a draft pick selection into an EnrichedTransaction
 */
export function processDraftPickToEnriched(
    pick: any,
    draft: any,
    rosterMap: Map<number, { ownerId: string; displayName: string }>,
    playerMap: Map<string, { name: string }>
): EnrichedTransaction | null {
    if (!pick.playerId) return null; // Only interested in selections

    const rosterId = pick.rosterId;
    const roster = rosterMap.get(rosterId);

    if (!roster) return null;

    const managers: TransactionManager[] = [{
        rosterId: rosterId,
        userId: roster.ownerId,
        displayName: roster.displayName,
        side: 'selector'
    }];

    const assets: TransactionAsset[] = [];

    // 1. The Pick (Outgoing)
    // The manager "spends" the pick
    assets.push({
        kind: 'pick',
        id: `pick-${draft.season}-${pick.round}-${pick.rosterId}`, // ID logic might need refinement to match trade pick IDs
        name: `${draft.season} Round ${pick.round} Pick`,
        fromRosterId: rosterId,
        toRosterId: null, // Consumed
        fromUserId: roster.ownerId,
        toUserId: null,
    });

    // 2. The Player (Incoming)
    // The manager receives the player
    const player = playerMap.get(pick.playerId);
    assets.push({
        kind: 'player',
        id: pick.playerId,
        name: player?.name || 'Unknown Player',
        fromRosterId: null, // From pool
        toRosterId: rosterId,
        fromUserId: null,
        toUserId: roster.ownerId,
    });

    // Synthetic ID for draft selection
    const id = `draft-${draft.id}-pick-${pick.pickNo}`;

    return {
        id: id,
        leagueId: draft.leagueId,
        type: 'draft_selection',
        status: 'complete',
        timestamp: new Date(draft.startTime || Date.now()), // Approximation
        managers: managers,
        assets: assets,
        metadata: {
            draftId: draft.id,
            pickNo: pick.pickNo,
            round: pick.round
        },
        createdAt: new Date(),
    };
}
