import {
  assetNodeId,
  managerNodeId,
  pickKey,
  buildGraphFromEvents,
} from "@/lib/assetGraph";
import type { BuildGraphInput } from "@/lib/assetGraph";

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

describe("assetGraph transform stubs", () => {
  it("exports buildGraphFromEvents and throws until Module A fills in the body", () => {
    expect(typeof buildGraphFromEvents).toBe("function");
    const input: BuildGraphInput = {
      assetEvents: [],
      enrichedTransactions: {},
      players: new Map(),
      managers: new Map(),
      draftResolutions: new Map(),
      rosterToUser: new Map(),
    };
    expect(() => buildGraphFromEvents(input)).toThrow(/not implemented/);
  });
});
