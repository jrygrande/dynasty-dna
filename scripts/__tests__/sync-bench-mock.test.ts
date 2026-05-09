/**
 * @jest-environment node
 *
 * Unit tests for the synthetic Sleeper mock used by the sync benchmark.
 * Exercises the mock without involving the DB or sync code.
 */

import {
  installSleeperMock,
  getMockStats,
  resetMockStats,
} from "../sync-bench-mock";
import { Sleeper } from "@/lib/sleeper";

describe("sync-bench-mock", () => {
  let uninstall: (() => void) | null = null;

  afterEach(() => {
    if (uninstall) uninstall();
    uninstall = null;
    resetMockStats();
  });

  it("builds an N-season chain via previous_league_id", () => {
    const result = installSleeperMock({ seasons: 5, latencyMs: 0 });
    uninstall = result.uninstall;

    expect(result.chain).toHaveLength(5);
    expect(result.leagueIds).toHaveLength(5);

    // Chain is oldest -> newest. Oldest has no previous_league_id; each
    // subsequent season's previous_league_id points to the previous one.
    expect(result.chain[0].previous_league_id).toBeNull();
    for (let i = 1; i < result.chain.length; i++) {
      expect(result.chain[i].previous_league_id).toBe(result.chain[i - 1].league_id);
    }

    // Default: every season is "complete" (CI baseline assumes a cold sync of
    // a finished family, which exercises the parallelizable branch).
    expect(result.chain.every((c) => c.status === "complete")).toBe(true);
  });

  it("supports an in-progress tail season", () => {
    const result = installSleeperMock({ seasons: 3, inProgressTail: true, latencyMs: 0 });
    uninstall = result.uninstall;

    expect(result.chain[0].status).toBe("complete");
    expect(result.chain[1].status).toBe("complete");
    expect(result.chain[2].status).toBe("in_season");
  });

  it("returns response shapes that match the SleeperLeague/User/Roster/Draft contracts", async () => {
    const { leagueIds, uninstall: u } = installSleeperMock({
      seasons: 1,
      latencyMs: 0,
    });
    uninstall = u;

    const id = leagueIds[0];
    const league = await Sleeper.getLeague(id);
    expect(league.league_id).toBe(id);
    expect(typeof league.season).toBe("string");
    expect(league.previous_league_id).toBeNull();
    expect(league.status).toBe("complete");
    expect(league.draft_id).toBeTruthy();
    expect(Array.isArray(league.roster_positions)).toBe(true);

    const users = await Sleeper.getLeagueUsers(id);
    expect(users.length).toBeGreaterThan(0);
    expect(users[0]).toHaveProperty("user_id");
    expect(users[0]).toHaveProperty("display_name");

    const rosters = await Sleeper.getRosters(id);
    expect(rosters.length).toBeGreaterThan(0);
    expect(rosters[0]).toHaveProperty("roster_id");
    expect(rosters[0]).toHaveProperty("settings");

    const drafts = await Sleeper.getDrafts(id);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].draft_id).toBe(league.draft_id);

    const picks = await Sleeper.getDraftPicks(drafts[0].draft_id);
    expect(picks.length).toBeGreaterThan(0);
    expect(picks[0]).toHaveProperty("pick_no");
    expect(picks[0]).toHaveProperty("round");

    const traded = await Sleeper.getTradedPicks(id);
    expect(Array.isArray(traded)).toBe(true);

    const tx = await Sleeper.getTransactions(id, 4);
    expect(tx.length).toBeGreaterThan(0);
    expect(tx[0].type).toBe("trade");
    expect(tx[0].leg).toBe(4);

    const txEmpty = await Sleeper.getTransactions(id, 1);
    expect(txEmpty).toHaveLength(0);

    const matchups = await Sleeper.getMatchups(id, 1);
    expect(matchups.length).toBeGreaterThan(0);
    expect(matchups[0]).toHaveProperty("roster_id");
    expect(matchups[0]).toHaveProperty("matchup_id");

    const bracket = await Sleeper.getWinnersBracket(id);
    expect(bracket.length).toBeGreaterThan(0);
  });

  it("tracks api call count + per-endpoint breakdown", async () => {
    const { leagueIds, uninstall: u } = installSleeperMock({
      seasons: 1,
      latencyMs: 0,
    });
    uninstall = u;

    await Sleeper.getLeague(leagueIds[0]);
    await Sleeper.getRosters(leagueIds[0]);
    await Sleeper.getMatchups(leagueIds[0], 1);
    await Sleeper.getMatchups(leagueIds[0], 2);

    const stats = getMockStats();
    expect(stats.apiCalls).toBe(4);
    expect(stats.callsByEndpoint["/league/{id}"]).toBe(1);
    expect(stats.callsByEndpoint["/league/{id}/rosters"]).toBe(1);
    expect(stats.callsByEndpoint["/league/{id}/matchups/{week}"]).toBe(2);
  });

  it("tracks peak concurrency under simulated parallelism", async () => {
    const { leagueIds, uninstall: u } = installSleeperMock({
      seasons: 1,
      latencyMs: 5,
    });
    uninstall = u;

    // Fire 6 calls concurrently — peak should reflect the burst.
    await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        Sleeper.getMatchups(leagueIds[0], i + 1),
      ),
    );

    const stats = getMockStats();
    expect(stats.apiCalls).toBe(6);
    expect(stats.peakConcurrency).toBeGreaterThanOrEqual(2);
  });

  it("uninstall restores the originals", () => {
    const originalGetLeague = Sleeper.getLeague;
    const result = installSleeperMock({ seasons: 1, latencyMs: 0 });

    expect(Sleeper.getLeague).not.toBe(originalGetLeague);

    result.uninstall();
    expect(Sleeper.getLeague).toBe(originalGetLeague);
  });

  it("resetMockStats zeros the counters", () => {
    const result = installSleeperMock({ seasons: 1, latencyMs: 0 });
    uninstall = result.uninstall;

    return Sleeper.getLeague(result.leagueIds[0]).then(() => {
      expect(getMockStats().apiCalls).toBe(1);
      resetMockStats();
      expect(getMockStats().apiCalls).toBe(0);
      expect(getMockStats().callsByEndpoint).toEqual({});
    });
  });
});
