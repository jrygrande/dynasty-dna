import {
  assetNodeId,
  managerNodeId,
  pickKey,
  buildGraphFromEvents,
  applyGraphFilters,
  focusSubgraph,
  computeHeaderStats,
} from "@/lib/assetGraph";
import type {
  BuildGraphInput,
  GraphFilters,
  GraphFocus,
} from "@/lib/assetGraph";
import type { EnrichedTransaction } from "@/lib/transactionEnrichment";

// ---------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------

type AssetEvent = BuildGraphInput["assetEvents"][number];

function mkEvent(partial: Partial<AssetEvent> & {
  id: string;
  leagueId: string;
  eventType: string;
  assetKind: string;
}): AssetEvent {
  return {
    id: partial.id,
    leagueId: partial.leagueId,
    season: partial.season ?? "2024",
    week: partial.week ?? 1,
    eventType: partial.eventType,
    assetKind: partial.assetKind,
    playerId: partial.playerId ?? null,
    pickSeason: partial.pickSeason ?? null,
    pickRound: partial.pickRound ?? null,
    pickOriginalRosterId: partial.pickOriginalRosterId ?? null,
    fromRosterId: partial.fromRosterId ?? null,
    toRosterId: partial.toRosterId ?? null,
    fromUserId: partial.fromUserId ?? null,
    toUserId: partial.toUserId ?? null,
    transactionId: partial.transactionId ?? null,
    createdAt: partial.createdAt ?? null,
    details: partial.details ?? null,
  };
}

function basicPlayers(): BuildGraphInput["players"] {
  return new Map([
    ["p1", { name: "Player One", position: "WR", team: "NE" }],
    ["p2", { name: "Player Two", position: "RB", team: "DAL" }],
    ["p3", { name: "Player Three", position: "QB", team: "KC" }],
    ["p4", { name: "Draftee", position: "RB", team: "SF" }],
  ]);
}

function basicManagers(): BuildGraphInput["managers"] {
  return new Map([
    ["uA", { displayName: "Alice", avatar: null, seasons: ["2024"] }],
    ["uB", { displayName: "Bob", avatar: null, seasons: ["2024"] }],
    ["uC", { displayName: "Charlie", avatar: null, seasons: ["2024"] }],
  ]);
}

function basicRosterToUser(leagueId = "L1"): BuildGraphInput["rosterToUser"] {
  return new Map([
    [`${leagueId}:1`, "uA"],
    [`${leagueId}:2`, "uB"],
    [`${leagueId}:3`, "uC"],
  ]);
}

// ---------------------------------------------------------------------
// Id helpers (existing)
// ---------------------------------------------------------------------

describe("assetGraph id helpers", () => {
  describe("assetNodeId", () => {
    it("formats a player asset ref", () => {
      expect(assetNodeId({ kind: "player", playerId: "4046" })).toBe("player:4046");
    });

    it("formats a pick asset ref using the league-scoped tuple", () => {
      expect(
        assetNodeId({
          kind: "pick",
          leagueId: "league-1",
          pickSeason: "2025",
          pickRound: 1,
          pickOriginalRosterId: 2,
        }),
      ).toBe("pick:league-1:2025:1:2");
    });
  });

  describe("managerNodeId", () => {
    it("prefixes the manager userId", () => {
      expect(managerNodeId("u-123")).toBe("manager:u-123");
    });
  });

  describe("pickKey", () => {
    it("flattens the league-scoped pick tuple without the 'pick:' prefix", () => {
      expect(
        pickKey({
          kind: "pick",
          leagueId: "league-1",
          pickSeason: "2025",
          pickRound: 1,
          pickOriginalRosterId: 2,
        }),
      ).toBe("league-1:2025:1:2");
    });
  });
});

// ---------------------------------------------------------------------
// buildGraphFromEvents
// ---------------------------------------------------------------------

describe("buildGraphFromEvents — 2-team trade", () => {
  it("emits 4 edges (trade_out + trade_in x 2) for a 2-player swap", () => {
    // Alice (roster 1) ships p1 to Bob (roster 2). Bob ships p2 to Alice. Same txn tx-1.
    const input: BuildGraphInput = {
      assetEvents: [
        mkEvent({
          id: "e1",
          leagueId: "L1",
          eventType: "trade",
          assetKind: "player",
          playerId: "p1",
          fromRosterId: 1,
          toRosterId: 2,
          transactionId: "tx-1",
        }),
        mkEvent({
          id: "e2",
          leagueId: "L1",
          eventType: "trade",
          assetKind: "player",
          playerId: "p2",
          fromRosterId: 2,
          toRosterId: 1,
          transactionId: "tx-1",
        }),
      ],
      enrichedTransactions: {
        "tx-1": {
          id: "tx-1",
          type: "trade",
          week: 1,
          season: "2024",
          createdAt: null,
          managers: [],
          adds: [
            { playerId: "p1", playerName: "p1", rosterId: 2, managerName: "Bob" },
            { playerId: "p2", playerName: "p2", rosterId: 1, managerName: "Alice" },
          ],
          drops: [],
          draftPicks: [],
          settings: null,
        } satisfies EnrichedTransaction,
      },
      players: basicPlayers(),
      managers: basicManagers(),
      draftResolutions: new Map(),
      rosterToUser: basicRosterToUser(),
    };

    const g = buildGraphFromEvents(input);
    expect(g.edges).toHaveLength(4);

    const kinds = g.edges.map((e) => e.kind).sort();
    expect(kinds).toEqual(["trade_in", "trade_in", "trade_out", "trade_out"]);

    // All edges share the txn-1 groupKey.
    expect(new Set(g.edges.map((e) => e.groupKey)).size).toBe(1);
    expect(g.edges[0].groupKey).toBe("tx-1");

    // Nodes: 2 managers + 2 players (deduped).
    expect(g.nodes.filter((n) => n.kind === "manager")).toHaveLength(2);
    expect(g.nodes.filter((n) => n.kind === "player")).toHaveLength(2);

    // Stats
    expect(g.stats.totalTrades).toBe(1);
    expect(g.stats.totalEdges).toBe(4);
    expect(g.stats.totalNodes).toBe(4);
    expect(g.stats.multiHopChains).toBe(0); // 2 adds only
    expect(g.stats.picksTraded).toBe(0);
  });
});

describe("buildGraphFromEvents — 3-way trade", () => {
  it("emits 6 edges that all share groupKey", () => {
    // Alice -> Bob -> Charlie -> Alice: 3 player events, all txn tx-3way.
    const input: BuildGraphInput = {
      assetEvents: [
        mkEvent({
          id: "e1",
          leagueId: "L1",
          eventType: "trade",
          assetKind: "player",
          playerId: "p1",
          fromRosterId: 1,
          toRosterId: 2,
          transactionId: "tx-3way",
        }),
        mkEvent({
          id: "e2",
          leagueId: "L1",
          eventType: "trade",
          assetKind: "player",
          playerId: "p2",
          fromRosterId: 2,
          toRosterId: 3,
          transactionId: "tx-3way",
        }),
        mkEvent({
          id: "e3",
          leagueId: "L1",
          eventType: "trade",
          assetKind: "player",
          playerId: "p3",
          fromRosterId: 3,
          toRosterId: 1,
          transactionId: "tx-3way",
        }),
      ],
      enrichedTransactions: {
        "tx-3way": {
          id: "tx-3way",
          type: "trade",
          week: 1,
          season: "2024",
          createdAt: null,
          managers: [],
          adds: [
            { playerId: "p1", playerName: "p1", rosterId: 2, managerName: "Bob" },
            { playerId: "p2", playerName: "p2", rosterId: 3, managerName: "Charlie" },
            { playerId: "p3", playerName: "p3", rosterId: 1, managerName: "Alice" },
          ],
          drops: [],
          draftPicks: [],
          settings: null,
        } satisfies EnrichedTransaction,
      },
      players: basicPlayers(),
      managers: basicManagers(),
      draftResolutions: new Map(),
      rosterToUser: basicRosterToUser(),
    };

    const g = buildGraphFromEvents(input);
    expect(g.edges).toHaveLength(6);
    expect(new Set(g.edges.map((e) => e.groupKey))).toEqual(new Set(["tx-3way"]));

    // Multi-hop: 3 adds + 0 picks = 3 legs — counts as multi-hop.
    expect(g.stats.multiHopChains).toBe(1);
    expect(g.stats.totalTrades).toBe(1);
  });
});

describe("buildGraphFromEvents — pick traded then drafted", () => {
  it("creates pick node + pick_trade edges + draft_selected_pick edge", () => {
    const input: BuildGraphInput = {
      assetEvents: [
        // Alice trades 2025 R1 pick (original roster 1) to Bob.
        mkEvent({
          id: "ep1",
          leagueId: "L1",
          eventType: "pick_trade",
          assetKind: "pick",
          pickSeason: "2025",
          pickRound: 1,
          pickOriginalRosterId: 1,
          fromRosterId: 1,
          toRosterId: 2,
          transactionId: "tx-pick-1",
        }),
        // Bob drafts p4 with that pick.
        mkEvent({
          id: "ed1",
          leagueId: "L1",
          season: "2025",
          eventType: "draft_selected",
          assetKind: "player",
          playerId: "p4",
          pickSeason: "2025",
          pickRound: 1,
          pickOriginalRosterId: 1,
          toRosterId: 2,
        }),
      ],
      enrichedTransactions: {
        "tx-pick-1": {
          id: "tx-pick-1",
          type: "trade",
          week: 1,
          season: "2024",
          createdAt: null,
          managers: [],
          adds: [],
          drops: [],
          draftPicks: [
            {
              season: "2025",
              round: 1,
              originalRosterId: 1,
              originalOwnerName: "Alice",
              fromRosterId: 1,
              toRosterId: 2,
              from: "Alice",
              to: "Bob",
            },
          ],
          settings: null,
        } satisfies EnrichedTransaction,
      },
      players: basicPlayers(),
      managers: basicManagers(),
      draftResolutions: new Map([
        [`L1:2025:1:1`, { playerId: "p4", playerName: "Draftee" }],
      ]),
      rosterToUser: basicRosterToUser(),
    };

    const g = buildGraphFromEvents(input);

    // Pick node exists.
    const pickNode = g.nodes.find((n) => n.kind === "pick");
    expect(pickNode).toBeDefined();
    if (pickNode && pickNode.kind === "pick") {
      expect(pickNode.pickOriginalOwnerUserId).toBe("uA");
      expect(pickNode.pickOriginalOwnerName).toBe("Alice");
      expect(pickNode.resolvedPlayerId).toBe("p4");
      expect(pickNode.resolvedPlayerName).toBe("Draftee");
    }

    // Both pick_trade edges.
    expect(g.edges.filter((e) => e.kind === "pick_trade_out")).toHaveLength(1);
    expect(g.edges.filter((e) => e.kind === "pick_trade_in")).toHaveLength(1);

    // draft_selected_pick edge.
    const draftPickEdge = g.edges.find((e) => e.kind === "draft_selected_pick");
    expect(draftPickEdge).toBeDefined();
    expect(draftPickEdge?.target).toBe(assetNodeId({ kind: "player", playerId: "p4" }));
    expect(draftPickEdge?.source).toBe(
      assetNodeId({
        kind: "pick",
        leagueId: "L1",
        pickSeason: "2025",
        pickRound: 1,
        pickOriginalRosterId: 1,
      }),
    );

    // draft_selected_mgr edge also exists.
    expect(g.edges.filter((e) => e.kind === "draft_selected_mgr")).toHaveLength(1);

    // picksTraded stat
    expect(g.stats.picksTraded).toBe(1);
  });
});

describe("buildGraphFromEvents — pick future (never drafted)", () => {
  it("creates pick node but NO draft_selected_pick edge", () => {
    const input: BuildGraphInput = {
      assetEvents: [
        mkEvent({
          id: "ep1",
          leagueId: "L1",
          eventType: "pick_trade",
          assetKind: "pick",
          pickSeason: "2030",
          pickRound: 2,
          pickOriginalRosterId: 1,
          fromRosterId: 1,
          toRosterId: 2,
          transactionId: "tx-future-pick",
        }),
      ],
      enrichedTransactions: {},
      players: basicPlayers(),
      managers: basicManagers(),
      draftResolutions: new Map(), // no resolution for future pick
      rosterToUser: basicRosterToUser(),
    };

    const g = buildGraphFromEvents(input);

    // Pick node present.
    const pickNode = g.nodes.find((n) => n.kind === "pick");
    expect(pickNode).toBeDefined();
    if (pickNode && pickNode.kind === "pick") {
      expect(pickNode.resolvedPlayerId).toBeUndefined();
      expect(pickNode.resolvedPlayerName).toBeUndefined();
    }

    // No draft_selected_pick edge.
    expect(g.edges.filter((e) => e.kind === "draft_selected_pick")).toHaveLength(0);
    // Two pick_trade edges still rendered.
    expect(g.edges.filter((e) => e.kind.startsWith("pick_trade"))).toHaveLength(2);
  });
});

describe("buildGraphFromEvents — null pickOriginalRosterId invariant", () => {
  it("warns and skips without crashing", () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const input: BuildGraphInput = {
        assetEvents: [
          mkEvent({
            id: "e-bad",
            leagueId: "L1",
            eventType: "pick_trade",
            assetKind: "pick",
            pickSeason: "2025",
            pickRound: 1,
            pickOriginalRosterId: null, // INVARIANT violation
            fromRosterId: 1,
            toRosterId: 2,
            transactionId: "tx-bad",
          }),
        ],
        enrichedTransactions: {},
        players: basicPlayers(),
        managers: basicManagers(),
        draftResolutions: new Map(),
        rosterToUser: basicRosterToUser(),
      };

      const g = buildGraphFromEvents(input);
      expect(g.edges).toHaveLength(0);
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe("buildGraphFromEvents — multi-hop stat", () => {
  it("counts txn with 3 adds + 1 pick (4 legs) as multi-hop", () => {
    const input: BuildGraphInput = {
      assetEvents: [
        // 3 adds + 1 pick = 4 legs.
        mkEvent({
          id: "e1",
          leagueId: "L1",
          eventType: "trade",
          assetKind: "player",
          playerId: "p1",
          fromRosterId: 1,
          toRosterId: 2,
          transactionId: "tx-big",
        }),
        mkEvent({
          id: "e2",
          leagueId: "L1",
          eventType: "trade",
          assetKind: "player",
          playerId: "p2",
          fromRosterId: 2,
          toRosterId: 1,
          transactionId: "tx-big",
        }),
        mkEvent({
          id: "e3",
          leagueId: "L1",
          eventType: "trade",
          assetKind: "player",
          playerId: "p3",
          fromRosterId: 1,
          toRosterId: 2,
          transactionId: "tx-big",
        }),
        mkEvent({
          id: "e4",
          leagueId: "L1",
          eventType: "pick_trade",
          assetKind: "pick",
          pickSeason: "2025",
          pickRound: 1,
          pickOriginalRosterId: 2,
          fromRosterId: 2,
          toRosterId: 1,
          transactionId: "tx-big",
        }),
      ],
      enrichedTransactions: {
        "tx-big": {
          id: "tx-big",
          type: "trade",
          week: 1,
          season: "2024",
          createdAt: null,
          managers: [],
          adds: [
            { playerId: "p1", playerName: "p1", rosterId: 2, managerName: "Bob" },
            { playerId: "p2", playerName: "p2", rosterId: 1, managerName: "Alice" },
            { playerId: "p3", playerName: "p3", rosterId: 2, managerName: "Bob" },
          ],
          drops: [],
          draftPicks: [
            {
              season: "2025",
              round: 1,
              originalRosterId: 2,
              originalOwnerName: "Bob",
              fromRosterId: 2,
              toRosterId: 1,
              from: "Bob",
              to: "Alice",
            },
          ],
          settings: null,
        } satisfies EnrichedTransaction,
      },
      players: basicPlayers(),
      managers: basicManagers(),
      draftResolutions: new Map(),
      rosterToUser: basicRosterToUser(),
    };

    const g = buildGraphFromEvents(input);
    expect(g.stats.multiHopChains).toBe(1);
    expect(g.stats.totalTrades).toBe(1);
  });
});

// ---------------------------------------------------------------------
// focusSubgraph
// ---------------------------------------------------------------------

describe("focusSubgraph", () => {
  function twoTeamTrade(): ReturnType<typeof buildGraphFromEvents> {
    return buildGraphFromEvents({
      assetEvents: [
        mkEvent({
          id: "e1",
          leagueId: "L1",
          eventType: "trade",
          assetKind: "player",
          playerId: "p1",
          fromRosterId: 1,
          toRosterId: 2,
          transactionId: "tx-1",
        }),
        mkEvent({
          id: "e2",
          leagueId: "L1",
          eventType: "trade",
          assetKind: "player",
          playerId: "p2",
          fromRosterId: 2,
          toRosterId: 1,
          transactionId: "tx-1",
        }),
      ],
      enrichedTransactions: {
        "tx-1": {
          id: "tx-1",
          type: "trade",
          week: 1,
          season: "2024",
          createdAt: null,
          managers: [],
          adds: [],
          drops: [],
          draftPicks: [],
          settings: null,
        },
      },
      players: basicPlayers(),
      managers: basicManagers(),
      draftResolutions: new Map(),
      rosterToUser: basicRosterToUser(),
    });
  }

  it("at hops=1 around a player returns that player + its direct manager neighbors only", () => {
    const g = twoTeamTrade();
    const focus: GraphFocus = { kind: "player", playerId: "p1" };
    const sub = focusSubgraph(g, focus, 1);

    // Player p1 + 2 managers (Alice+Bob, since p1 was moved between them).
    expect(sub.nodes).toHaveLength(3);
    expect(sub.nodes.some((n) => n.id === assetNodeId({ kind: "player", playerId: "p1" }))).toBe(true);
    expect(sub.nodes.some((n) => n.id === managerNodeId("uA"))).toBe(true);
    expect(sub.nodes.some((n) => n.id === managerNodeId("uB"))).toBe(true);

    // Only edges incident to p1 (trade_out: Alice->p1, trade_in: p1->Bob) = 2.
    expect(sub.edges).toHaveLength(2);
  });

  it("at hops=0 returns just the focus node", () => {
    const g = twoTeamTrade();
    const sub = focusSubgraph(g, { kind: "player", playerId: "p1" }, 0);
    expect(sub.nodes).toHaveLength(1);
    expect(sub.edges).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------
// applyGraphFilters
// ---------------------------------------------------------------------

describe("applyGraphFilters", () => {
  function twoTeamTrade(): ReturnType<typeof buildGraphFromEvents> {
    return buildGraphFromEvents({
      assetEvents: [
        mkEvent({
          id: "e1",
          leagueId: "L1",
          eventType: "trade",
          assetKind: "player",
          playerId: "p1",
          fromRosterId: 1,
          toRosterId: 2,
          transactionId: "tx-1",
        }),
        mkEvent({
          id: "e2",
          leagueId: "L1",
          eventType: "trade",
          assetKind: "player",
          playerId: "p2",
          fromRosterId: 2,
          toRosterId: 1,
          transactionId: "tx-1",
        }),
      ],
      enrichedTransactions: {
        "tx-1": {
          id: "tx-1",
          type: "trade",
          week: 1,
          season: "2024",
          createdAt: null,
          managers: [],
          adds: [],
          drops: [],
          draftPicks: [],
          settings: null,
        },
      },
      players: basicPlayers(),
      managers: basicManagers(),
      draftResolutions: new Map(),
      rosterToUser: basicRosterToUser(),
    });
  }

  it("with eventTypes=['trade_in'] keeps only trade_in edges", () => {
    const g = twoTeamTrade();
    const filters: GraphFilters = {
      seasons: [],
      managers: [],
      eventTypes: ["trade_in"],
      focus: null,
      focusHops: 2,
      layout: "band",
    };
    const filtered = applyGraphFilters(g, filters);
    expect(filtered.edges).toHaveLength(2);
    expect(filtered.edges.every((e) => e.kind === "trade_in")).toBe(true);
  });

  it("keeps manager nodes even if isolated after filter", () => {
    const g = twoTeamTrade();
    const filters: GraphFilters = {
      seasons: ["3000"], // no matching events
      managers: [],
      eventTypes: [],
      focus: null,
      focusHops: 2,
      layout: "band",
    };
    const filtered = applyGraphFilters(g, filters);
    expect(filtered.edges).toHaveLength(0);
    // Both managers still present.
    expect(filtered.nodes.filter((n) => n.kind === "manager")).toHaveLength(2);
    // Players gone.
    expect(filtered.nodes.filter((n) => n.kind === "player")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------
// computeHeaderStats
// ---------------------------------------------------------------------

describe("computeHeaderStats", () => {
  it("returns trades/multiHopChains/picksTraded from graph.stats", () => {
    const input: BuildGraphInput = {
      assetEvents: [
        mkEvent({
          id: "e1",
          leagueId: "L1",
          eventType: "trade",
          assetKind: "player",
          playerId: "p1",
          fromRosterId: 1,
          toRosterId: 2,
          transactionId: "tx-1",
        }),
      ],
      enrichedTransactions: {
        "tx-1": {
          id: "tx-1",
          type: "trade",
          week: 1,
          season: "2024",
          createdAt: null,
          managers: [],
          adds: [],
          drops: [],
          draftPicks: [],
          settings: null,
        },
      },
      players: basicPlayers(),
      managers: basicManagers(),
      draftResolutions: new Map(),
      rosterToUser: basicRosterToUser(),
    };
    const g = buildGraphFromEvents(input);
    const hs = computeHeaderStats(g);
    expect(hs.trades).toBe(1);
    expect(hs.multiHopChains).toBe(0);
    expect(hs.picksTraded).toBe(0);
  });
});
