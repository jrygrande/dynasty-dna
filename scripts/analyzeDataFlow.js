// Test to understand the data flow

// From inspectTx.ts, we know the enriched transaction has:
const enrichedTx = {
    managers: [
        { rosterId: 2, userId: "716637207938551808", displayName: "tendererbrick" },
        { rosterId: 3, userId: "716803583877656576", displayName: "jrygrande" }
    ],
    assets: [
        { id: "4866", kind: "player", toUserId: "716803583877656576", fromUserId: "716637207938551808", toRosterId: 3, fromRosterId: 2 },
        { id: "pick-2022-1-3", kind: "pick", name: "2022 Round 1 Pick", toUserId: "716637207938551808", fromUserId: "716803583877656576", toRosterId: 2, fromRosterId: 3 },
        // ... more picks
    ]
};

// In graph.ts, we build fromUser and toUser like this:
const userObjects = enrichedTx.managers.map(m => ({
    id: m.userId || `roster-${m.rosterId}`,
    username: null,
    displayName: m.displayName
}));

const fromUser = userObjects[0]; // { id: "716637207938551808", displayName: "tendererbrick" }
const toUser = userObjects[1];   // { id: "716803583877656576", displayName: "jrygrande" }
const fromRosterId = enrichedTx.managers[0].rosterId; // 2
const toRosterId = enrichedTx.managers[1].rosterId;   // 3

// Then groupAssetsByRecipient is called with:
// - assets: the enrichedTx.assets array
// - fromUser: { id: "716637207938551808" } (tendererbrick)
// - toUser: { id: "716803583877656576" } (jrygrande)
// - fromRosterId: 2
// - toRosterId: 3

// The function creates rosterToUserId map:
// rosterToUserId.set(2, "716637207938551808") // fromRosterId -> fromUser.id
// rosterToUserId.set(3, "716803583877656576") // toRosterId -> toUser.id

// For the player asset (Saquon):
// - toRosterId: 3
// - rosterToUserId.has(3) = true
// - recipientUserId = "716803583877656576" (jrygrande) ✓

// For the pick assets:
// - toRosterId: 2
// - rosterToUserId.has(2) = true
// - recipientUserId = "716637207938551808" (tendererbrick) ✓

// SO THE LOGIC SHOULD WORK!

// The issue must be that the picks don't have toRosterId set correctly in the mock event's assetsInTransaction
// Let me check what we're setting in graph.ts...

console.log('The issue is likely in how we map assets in graph.ts line 169-182');
console.log('We need to ensure toRosterId and fromRosterId are set on each asset in assetsInTransaction');
