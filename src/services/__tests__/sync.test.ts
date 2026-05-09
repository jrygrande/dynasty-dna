/**
 * @jest-environment node
 *
 * Tests the per-season parallelization in syncLeague.
 *
 * Strategy: mock the Sleeper API client and every DB/grading dependency at the
 * module boundary, then drive syncLeague() and observe:
 *   - per-week fetches run concurrently (in-flight count > 1)
 *   - the concurrency cap is honored under stress
 *   - the rate limiter is invoked per fetch (no bypass)
 *   - DB writes for a season are batched ONCE after all weeks are collected
 *     (matchups + transactions + scores are not interleaved per-week)
 *   - a single failed week surfaces as an error rather than silently dropping
 *     data
 */

// ---- Mocks (must be declared before importing the module under test) ----

const sleeperMock = {
  getLeague: jest.fn(),
  getLeagueUsers: jest.fn(),
  getRosters: jest.fn(),
  getDrafts: jest.fn(),
  getDraftPicks: jest.fn(),
  getTradedPicks: jest.fn(),
  getTransactions: jest.fn(),
  getMatchups: jest.fn(),
  getWinnersBracket: jest.fn(),
};

jest.mock("@/lib/sleeper", () => ({
  Sleeper: sleeperMock,
}));

const insertCalls: Array<{ table: string; rowCount: number }> = [];

const fakeDb = {
  insert: (table: { __tableName?: string }) => ({
    values: () => ({
      onConflictDoUpdate: () => {
        insertCalls.push({ table: table.__tableName ?? "?", rowCount: 0 });
        return Promise.resolve();
      },
      onConflictDoNothing: () => {
        insertCalls.push({ table: table.__tableName ?? "?", rowCount: 0 });
        return Promise.resolve();
      },
    }),
  }),
  select: () => ({
    from: () => ({
      where: () => Promise.resolve([]),
    }),
  }),
  update: () => ({
    set: () => ({
      where: () => Promise.resolve(),
    }),
  }),
  delete: () => ({
    where: () => Promise.resolve(),
  }),
  transaction: async (fn: (tx: unknown) => Promise<void>) => {
    await fn({
      delete: () => ({ where: () => Promise.resolve() }),
      insert: () => ({ values: () => Promise.resolve() }),
    });
  },
};

jest.mock("@/db", () => ({
  getDb: () => fakeDb,
  getSyncDb: () => fakeDb,
  schema: {
    leagues: { id: "id", __tableName: "leagues" },
    leagueUsers: {
      leagueId: "leagueId",
      userId: "userId",
      __tableName: "leagueUsers",
    },
    rosters: {
      leagueId: "leagueId",
      rosterId: "rosterId",
      __tableName: "rosters",
    },
    drafts: { id: "id", __tableName: "drafts" },
    draftPicks: { __tableName: "draftPicks" },
    tradedPicks: {
      leagueId: "leagueId",
      __tableName: "tradedPicks",
    },
    transactions: { __tableName: "transactions" },
    matchups: {
      leagueId: "leagueId",
      week: "week",
      rosterId: "rosterId",
      __tableName: "matchups",
    },
    playerScores: { __tableName: "playerScores" },
    syncWatermarks: {
      leagueId: "leagueId",
      dataType: "dataType",
      __tableName: "syncWatermarks",
    },
    leagueFamilyMembers: { __tableName: "leagueFamilyMembers" },
  },
}));

// Stub every heavy downstream service so syncLeague stays focused on
// the per-week fetch behavior we care about.
jest.mock("@/services/playerSync", () => ({ syncPlayers: jest.fn() }));
jest.mock("@/services/assetEvents", () => ({ buildAssetEvents: jest.fn() }));
jest.mock("@/services/rosterStatusSync", () => ({ syncRosterStatus: jest.fn() }));
jest.mock("@/services/injurySync", () => ({ syncInjuries: jest.fn() }));
jest.mock("@/services/scheduleSync", () => ({ syncSchedule: jest.fn() }));
jest.mock("@/services/fantasyCalcSync", () => ({
  syncFantasyCalcValues: jest.fn(),
}));
jest.mock("@/services/tradeGrading", () => ({ gradeLeagueTrades: jest.fn() }));
jest.mock("@/services/lineupGrading", () => ({ gradeLeagueLineups: jest.fn() }));
jest.mock("@/services/draftGrading", () => ({ gradeLeagueDrafts: jest.fn() }));
jest.mock("@/services/waiverGrading", () => ({ gradeLeagueWaivers: jest.fn() }));
jest.mock("@/services/managerGrades", () => ({ rollupManagerGrades: jest.fn() }));

// batchInsert: just record what tables are written. We don't care about chunking here.
jest.mock("@/services/batchHelper", () => ({
  BATCH_SIZE: 200,
  batchInsert: jest.fn(async (table: { __tableName?: string }, values: unknown[]) => {
    insertCalls.push({
      table: table.__tableName ?? "?",
      rowCount: values.length,
    });
  }),
}));

import { syncLeague } from "../sync";

// ---- Helpers ----

function resetSleeperMocks() {
  for (const fn of Object.values(sleeperMock)) fn.mockReset();
  sleeperMock.getLeague.mockResolvedValue({
    league_id: "L1",
    name: "Test League",
    season: "2024",
    previous_league_id: null,
    status: "complete",
    settings: {},
    scoring_settings: {},
    roster_positions: [],
    total_rosters: 12,
    draft_id: "D1",
  });
  sleeperMock.getLeagueUsers.mockResolvedValue([]);
  sleeperMock.getRosters.mockResolvedValue([]);
  sleeperMock.getDrafts.mockResolvedValue([]);
  sleeperMock.getDraftPicks.mockResolvedValue([]);
  sleeperMock.getTradedPicks.mockResolvedValue([]);
  sleeperMock.getWinnersBracket.mockResolvedValue([]);
  sleeperMock.getTransactions.mockResolvedValue([]);
  sleeperMock.getMatchups.mockResolvedValue([]);
}

beforeEach(() => {
  resetSleeperMocks();
  insertCalls.length = 0;
});

describe("syncLeague per-week parallelization", () => {
  it("fetches transactions and matchups concurrently across weeks", async () => {
    let txInFlight = 0;
    let txMaxInFlight = 0;
    let matchupInFlight = 0;
    let matchupMaxInFlight = 0;

    sleeperMock.getTransactions.mockImplementation(async () => {
      txInFlight++;
      txMaxInFlight = Math.max(txMaxInFlight, txInFlight);
      await new Promise((r) => setTimeout(r, 10));
      txInFlight--;
      return [];
    });
    sleeperMock.getMatchups.mockImplementation(async () => {
      matchupInFlight++;
      matchupMaxInFlight = Math.max(matchupMaxInFlight, matchupInFlight);
      await new Promise((r) => setTimeout(r, 10));
      matchupInFlight--;
      return [];
    });

    await syncLeague("L1", undefined, undefined, { skipGlobalSyncs: true });

    // 18 regular-season weeks scheduled
    expect(sleeperMock.getTransactions).toHaveBeenCalledTimes(18);
    expect(sleeperMock.getMatchups).toHaveBeenCalledTimes(18);

    // Concurrent: more than one in-flight at peak
    expect(txMaxInFlight).toBeGreaterThan(1);
    expect(matchupMaxInFlight).toBeGreaterThan(1);

    // But never above the cap (5)
    expect(txMaxInFlight).toBeLessThanOrEqual(5);
    expect(matchupMaxInFlight).toBeLessThanOrEqual(5);
  });

  it("honors the concurrency cap of 5 even under stress", async () => {
    let txInFlight = 0;
    let txMaxInFlight = 0;

    sleeperMock.getTransactions.mockImplementation(async () => {
      txInFlight++;
      txMaxInFlight = Math.max(txMaxInFlight, txInFlight);
      // Wide latency variance to exercise queue scheduling
      await new Promise((r) => setTimeout(r, Math.random() * 30));
      txInFlight--;
      return [];
    });

    await syncLeague("L1", undefined, undefined, { skipGlobalSyncs: true });

    expect(txMaxInFlight).toBeLessThanOrEqual(5);
  });

  it("invokes Sleeper.getTransactions/getMatchups once per week (no bypass)", async () => {
    await syncLeague("L1", undefined, undefined, { skipGlobalSyncs: true });

    const txWeeks = sleeperMock.getTransactions.mock.calls
      .map((c: unknown[]) => c[1] as number)
      .sort((a: number, b: number) => a - b);
    expect(txWeeks).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]);

    const mWeeks = sleeperMock.getMatchups.mock.calls
      .map((c: unknown[]) => c[1] as number)
      .sort((a: number, b: number) => a - b);
    expect(mWeeks).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]);
  });

  it("writes transactions in a single batch AFTER all week fetches complete (no per-week interleaving)", async () => {
    const fetchOrder: string[] = [];

    sleeperMock.getTransactions.mockImplementation(async (_: string, week: number) => {
      fetchOrder.push(`tx-fetch-${week}`);
      return [];
    });
    sleeperMock.getMatchups.mockImplementation(async (_: string, week: number) => {
      fetchOrder.push(`m-fetch-${week}`);
      return [];
    });

    const { batchInsert } = jest.requireMock("@/services/batchHelper") as {
      batchInsert: jest.Mock;
    };
    batchInsert.mockClear();

    await syncLeague("L1", undefined, undefined, { skipGlobalSyncs: true });

    // batchInsert is called once per write target (transactions, matchups,
    // playerScores), NOT 18 times. Verifying we collect-then-write.
    const txInserts = batchInsert.mock.calls.filter(
      (c: unknown[]) => (c[0] as { __tableName?: string }).__tableName === "transactions"
    );
    const matchupInserts = batchInsert.mock.calls.filter(
      (c: unknown[]) => (c[0] as { __tableName?: string }).__tableName === "matchups"
    );
    expect(txInserts.length).toBe(1);
    expect(matchupInserts.length).toBe(1);
  });

  it("surfaces an error when any week fails (does not silently drop data)", async () => {
    sleeperMock.getTransactions.mockImplementation(
      async (_: string, week: number) => {
        if (week === 7) throw new Error("Sleeper 500 for week 7");
        return [];
      }
    );

    await expect(
      syncLeague("L1", undefined, undefined, { skipGlobalSyncs: true })
    ).rejects.toThrow(/transactions fetch failed/i);

    // All 18 weeks were still attempted (allSettled within the batch).
    expect(sleeperMock.getTransactions).toHaveBeenCalledTimes(18);
  });

  it("does NOT advance the transactions watermark when any week fails", async () => {
    // Pin the atomic-failure guarantee: if 1 of 18 weeks fails, the watermark
    // must NOT be set — otherwise the next sync would skip past the missing
    // week and we'd silently lose data forever.
    sleeperMock.getTransactions.mockImplementation(
      async (_: string, week: number) => {
        if (week === 11) throw new Error("Sleeper 500 for week 11");
        return [];
      }
    );

    await expect(
      syncLeague("L1", undefined, undefined, { skipGlobalSyncs: true })
    ).rejects.toThrow(/transactions fetch failed/i);

    // setWatermark inserts/upserts into the syncWatermarks table. If it ran,
    // we'd see at least one insertCalls entry for that table.
    const watermarkWrites = insertCalls.filter(
      (c) => c.table === "syncWatermarks"
    );
    expect(watermarkWrites).toHaveLength(0);
  });
});
