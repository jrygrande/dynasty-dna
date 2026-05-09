/**
 * @jest-environment node
 *
 * Coverage fill-in for src/services/sync.ts. The pre-existing sync.test.ts
 * pins the per-week fetch concurrency + atomic-failure behavior; this file
 * exercises the surrounding paths (drafts, traded picks, watermark
 * advancement under in_season vs complete, winners bracket, NFL data
 * stage, grading try/catch fall-through, syncLeagueFamily partition logic
 * and manager-grade rollup, all-fail throw).
 *
 * The strategy mirrors sync.test.ts: mock Sleeper + every downstream
 * service at the module boundary so the test stays focused on sync.ts's
 * own branching.
 */

const sleeperMock = {
  getLeague: jest.fn(),
  getLeagueUsers: jest.fn(),
  getRosters: jest.fn(),
  getDrafts: jest.fn(),
  getDraft: jest.fn(),
  getDraftPicks: jest.fn(),
  getTradedPicks: jest.fn(),
  getTransactions: jest.fn(),
  getMatchups: jest.fn(),
  getWinnersBracket: jest.fn(),
};

jest.mock("@/lib/sleeper", () => ({
  Sleeper: sleeperMock,
}));

interface DbCall {
  table: string;
  rowCount: number;
  op: "insert-update" | "insert-nothing" | "update";
}

const insertCalls: DbCall[] = [];
const updateCalls: Array<{ table: string; set: Record<string, unknown> }> = [];

// In-memory state used by the read-side of the fake DB. Tests mutate this
// before calling syncLeague* to drive specific branches.
const dbState = {
  watermarks: new Map<string, number>(), // dataType -> lastWeek
  familyMembers: [] as Array<{ season: string }>,
  leagueStatuses: [] as Array<{
    id: string;
    status: string;
    lastSyncedAt: Date | null;
  }>,
};

const fakeDb = {
  insert: (table: { __tableName?: string }) => ({
    values: () => ({
      onConflictDoUpdate: () => {
        insertCalls.push({
          table: table.__tableName ?? "?",
          rowCount: 0,
          op: "insert-update",
        });
        return Promise.resolve();
      },
      onConflictDoNothing: () => {
        insertCalls.push({
          table: table.__tableName ?? "?",
          rowCount: 0,
          op: "insert-nothing",
        });
        return Promise.resolve();
      },
    }),
  }),
  select: (cols?: Record<string, unknown>) => ({
    from: () => ({
      where: () => {
        // Differentiate which read is happening based on the projected cols.
        if (cols && "dataType" in cols) {
          return Promise.resolve(
            Array.from(dbState.watermarks.entries()).map(
              ([dataType, lastWeek]) => ({ dataType, lastWeek })
            )
          );
        }
        if (cols && "season" in cols && Object.keys(cols).length === 1) {
          return Promise.resolve(dbState.familyMembers);
        }
        if (cols && "status" in cols && "lastSyncedAt" in cols) {
          return Promise.resolve(dbState.leagueStatuses);
        }
        return Promise.resolve([]);
      },
    }),
  }),
  update: (table: { __tableName?: string }) => ({
    set: (s: Record<string, unknown>) => {
      updateCalls.push({ table: table.__tableName ?? "?", set: s });
      return {
        where: () => Promise.resolve(),
      };
    },
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
    leagues: {
      id: { __col: "id" },
      __tableName: "leagues",
    },
    leagueUsers: {
      leagueId: { __col: "leagueId" },
      userId: { __col: "userId" },
      __tableName: "leagueUsers",
    },
    rosters: {
      leagueId: { __col: "leagueId" },
      rosterId: { __col: "rosterId" },
      __tableName: "rosters",
    },
    drafts: { id: { __col: "id" }, __tableName: "drafts" },
    draftPicks: { __tableName: "draftPicks" },
    tradedPicks: {
      leagueId: { __col: "leagueId" },
      __tableName: "tradedPicks",
    },
    transactions: { __tableName: "transactions" },
    matchups: {
      leagueId: { __col: "leagueId" },
      week: { __col: "week" },
      rosterId: { __col: "rosterId" },
      __tableName: "matchups",
    },
    playerScores: { __tableName: "playerScores" },
    syncWatermarks: {
      leagueId: { __col: "leagueId" },
      dataType: { __col: "dataType" },
      __tableName: "syncWatermarks",
    },
    leagueFamilyMembers: {
      familyId: { __col: "familyId" },
      season: { __col: "season" },
      __tableName: "leagueFamilyMembers",
    },
  },
}));

// Stub heavy downstream services. Each spy returns a resolved promise so
// syncLeague's try/catch branches can be observed (or the rejection path
// when we want to test grading swallowing errors).
const syncPlayersMock = jest.fn();
const buildAssetEventsMock = jest.fn();
const syncRosterStatusMock = jest.fn();
const syncInjuriesMock = jest.fn();
const syncScheduleMock = jest.fn();
const syncFantasyCalcValuesMock = jest.fn();
const gradeLeagueTradesMock = jest.fn();
const gradeLeagueLineupsMock = jest.fn();
const gradeLeagueDraftsMock = jest.fn();
const gradeLeagueWaiversMock = jest.fn();
const rollupManagerGradesMock = jest.fn();

jest.mock("@/services/playerSync", () => ({
  syncPlayers: (...args: unknown[]) => syncPlayersMock(...args),
}));
jest.mock("@/services/assetEvents", () => ({
  buildAssetEvents: (...args: unknown[]) => buildAssetEventsMock(...args),
}));
jest.mock("@/services/rosterStatusSync", () => ({
  syncRosterStatus: (opts: unknown) => syncRosterStatusMock(opts),
}));
jest.mock("@/services/injurySync", () => ({
  syncInjuries: (opts: unknown) => syncInjuriesMock(opts),
}));
jest.mock("@/services/scheduleSync", () => ({
  syncSchedule: (opts: unknown) => syncScheduleMock(opts),
}));
jest.mock("@/services/fantasyCalcSync", () => ({
  syncFantasyCalcValues: (id: string, opts?: unknown) =>
    syncFantasyCalcValuesMock(id, opts),
}));
jest.mock("@/services/tradeGrading", () => ({
  gradeLeagueTrades: (...args: unknown[]) => gradeLeagueTradesMock(...args),
}));
jest.mock("@/services/lineupGrading", () => ({
  gradeLeagueLineups: (...args: unknown[]) => gradeLeagueLineupsMock(...args),
}));
jest.mock("@/services/draftGrading", () => ({
  gradeLeagueDrafts: (...args: unknown[]) => gradeLeagueDraftsMock(...args),
}));
jest.mock("@/services/waiverGrading", () => ({
  gradeLeagueWaivers: (...args: unknown[]) => gradeLeagueWaiversMock(...args),
}));
jest.mock("@/services/managerGrades", () => ({
  rollupManagerGrades: (...args: unknown[]) =>
    rollupManagerGradesMock(...args),
}));

jest.mock("@/services/batchHelper", () => ({
  BATCH_SIZE: 200,
  batchInsert: jest.fn(
    async (table: { __tableName?: string }, values: unknown[]) => {
      insertCalls.push({
        table: table.__tableName ?? "?",
        rowCount: values.length,
        op: "insert-update",
      });
    }
  ),
}));

import { syncLeague, syncLeagueFamily } from "../sync";

function resetSleeper(status: "complete" | "in_season" = "complete") {
  for (const fn of Object.values(sleeperMock)) fn.mockReset();
  sleeperMock.getLeague.mockResolvedValue({
    league_id: "L1",
    name: "Test League",
    season: "2024",
    previous_league_id: null,
    status,
    settings: { playoff_week_start: 15 },
    scoring_settings: { rec: 1 },
    roster_positions: ["QB", "RB", "WR", "TE", "FLEX"],
    total_rosters: 12,
    draft_id: "D1",
  });
  sleeperMock.getLeagueUsers.mockResolvedValue([
    {
      user_id: "u1",
      display_name: "Alice",
      metadata: { team_name: "Team A" },
      avatar: "av",
    },
  ]);
  sleeperMock.getRosters.mockResolvedValue([
    {
      roster_id: 1,
      owner_id: "u1",
      players: ["p1"],
      starters: ["p1"],
      reserve: [],
      settings: {
        wins: 10,
        losses: 4,
        ties: 0,
        fpts: 1500,
        fpts_decimal: 25,
        fpts_against: 1400,
        fpts_against_decimal: 75,
      },
    },
  ]);
  sleeperMock.getDrafts.mockResolvedValue([
    {
      draft_id: "D1",
      league_id: "L1",
      season: "2024",
      type: "snake",
      status: "complete",
      start_time: 1_700_000_000_000,
      settings: {},
    },
  ]);
  sleeperMock.getDraft.mockResolvedValue({
    draft_id: "D1",
    league_id: "L1",
    season: "2024",
    type: "snake",
    status: "complete",
    start_time: 1_700_000_000_000,
    settings: {},
    slot_to_roster_id: { "1": 1 },
  });
  sleeperMock.getDraftPicks.mockResolvedValue([
    {
      round: 1,
      pick_no: 1,
      draft_slot: 1,
      roster_id: 1,
      player_id: "p1",
      is_keeper: null,
      metadata: {},
    },
  ]);
  sleeperMock.getTradedPicks.mockResolvedValue([
    {
      season: "2025",
      round: 1,
      roster_id: 1,
      previous_owner_id: 1,
      owner_id: 2,
    },
  ]);
  sleeperMock.getTransactions.mockResolvedValue([
    {
      transaction_id: "tx1",
      type: "trade",
      status: "complete",
      roster_ids: [1, 2],
      adds: { p1: 1 },
      drops: { p2: 1 },
      draft_picks: [],
      leg: 1,
      settings: {},
      created: 1_700_000_000_000,
    },
    {
      // dropped because status != complete
      transaction_id: "tx2",
      type: "waiver",
      status: "failed",
      roster_ids: [1],
      adds: null,
      drops: null,
      draft_picks: [],
      leg: 1,
      settings: {},
      created: 1_700_000_000_001,
    },
  ]);
  sleeperMock.getMatchups.mockResolvedValue([
    {
      roster_id: 1,
      matchup_id: 1,
      points: 100.5,
      starters: ["p1"],
      starters_points: [10.5],
      players: ["p1", "p2"],
      players_points: { p1: 10.5, p2: 5.2 },
    },
  ]);
  sleeperMock.getWinnersBracket.mockResolvedValue([
    { r: 1, m: 1, t1: 1, t2: 2, w: 1, l: 2 },
  ]);
}

beforeEach(() => {
  resetSleeper("complete");
  insertCalls.length = 0;
  updateCalls.length = 0;
  dbState.watermarks.clear();
  dbState.familyMembers = [];
  dbState.leagueStatuses = [];

  syncPlayersMock.mockReset().mockResolvedValue(0);
  buildAssetEventsMock.mockReset().mockResolvedValue(undefined);
  syncRosterStatusMock.mockReset().mockResolvedValue({ total: 0, seasonResults: {} });
  syncInjuriesMock.mockReset().mockResolvedValue({ total: 0, seasonResults: {} });
  syncScheduleMock.mockReset().mockResolvedValue({ total: 0, seasonResults: {} });
  syncFantasyCalcValuesMock.mockReset().mockResolvedValue(new Date());
  gradeLeagueTradesMock.mockReset().mockResolvedValue(undefined);
  gradeLeagueLineupsMock.mockReset().mockResolvedValue(undefined);
  gradeLeagueDraftsMock.mockReset().mockResolvedValue(undefined);
  gradeLeagueWaiversMock.mockReset().mockResolvedValue(undefined);
  rollupManagerGradesMock.mockReset().mockResolvedValue(undefined);
});

describe("syncLeague — drafts, traded picks, watermarks, winners bracket", () => {
  it("upserts drafts + draft picks for completed drafts", async () => {
    await syncLeague("L1", undefined, undefined, { skipGlobalSyncs: true });
    expect(sleeperMock.getDrafts).toHaveBeenCalledWith("L1");
    expect(sleeperMock.getDraftPicks).toHaveBeenCalledWith("D1");
    const draftWrites = insertCalls.filter((c) => c.table === "drafts");
    const pickWrites = insertCalls.filter((c) => c.table === "draftPicks");
    expect(draftWrites.length).toBeGreaterThan(0);
    expect(pickWrites.length).toBeGreaterThan(0);
  });

  it("fetches /draft/{id} per draft to enrich slot_to_roster_id (#173)", async () => {
    await syncLeague("L1", undefined, undefined, { skipGlobalSyncs: true });
    // The list endpoint returns the draft id; the per-draft endpoint
    // returns slot_to_roster_id. Both must fire on every sync, otherwise
    // the lineage tracer pick→player remap silently no-ops.
    expect(sleeperMock.getDrafts).toHaveBeenCalledWith("L1");
    expect(sleeperMock.getDraft).toHaveBeenCalledWith("D1");
  });

  it("falls back to the list-endpoint draft when /draft/{id} throws", async () => {
    sleeperMock.getDraft.mockRejectedValueOnce(new Error("boom"));
    // Should not throw — partial data lands and the COALESCE upsert
    // preserves any prior slot_to_roster_id in the DB.
    await expect(
      syncLeague("L1", undefined, undefined, { skipGlobalSyncs: true })
    ).resolves.toBeUndefined();
    const draftWrites = insertCalls.filter((c) => c.table === "drafts");
    expect(draftWrites.length).toBeGreaterThan(0);
  });

  it("skips fetching draft picks for non-complete drafts", async () => {
    sleeperMock.getDrafts.mockResolvedValue([
      {
        draft_id: "D2",
        league_id: "L1",
        season: "2024",
        type: "snake",
        status: "drafting", // not complete
        start_time: 1,
        settings: {},
      },
    ]);
    sleeperMock.getDraft.mockResolvedValue({
      draft_id: "D2",
      league_id: "L1",
      season: "2024",
      type: "snake",
      status: "drafting",
      start_time: 1,
      settings: {},
    });
    await syncLeague("L1", undefined, undefined, { skipGlobalSyncs: true });
    expect(sleeperMock.getDraftPicks).not.toHaveBeenCalled();
  });

  it("uses existing watermarks to start transactions/matchups fetches mid-season", async () => {
    dbState.watermarks.set("transactions", 5);
    dbState.watermarks.set("matchups", 7);

    await syncLeague("L1", undefined, undefined, { skipGlobalSyncs: true });

    const txWeeks = sleeperMock.getTransactions.mock.calls
      .map((c: unknown[]) => c[1] as number)
      .sort((a: number, b: number) => a - b);
    expect(txWeeks[0]).toBe(6);
    expect(txWeeks[txWeeks.length - 1]).toBe(18);

    const matchupWeeks = sleeperMock.getMatchups.mock.calls
      .map((c: unknown[]) => c[1] as number)
      .sort((a: number, b: number) => a - b);
    expect(matchupWeeks[0]).toBe(8);
    expect(matchupWeeks[matchupWeeks.length - 1]).toBe(18);
  });

  it("writes a watermark row for both transactions and matchups", async () => {
    await syncLeague("L1", undefined, undefined, { skipGlobalSyncs: true });
    const watermarkWrites = insertCalls.filter(
      (c) => c.table === "syncWatermarks"
    );
    expect(watermarkWrites.length).toBeGreaterThanOrEqual(2);
  });

  it("writes the winners bracket when playoffs have started + bracket has results", async () => {
    await syncLeague("L1", undefined, undefined, { skipGlobalSyncs: true });
    expect(sleeperMock.getWinnersBracket).toHaveBeenCalledWith("L1");
    const bracketWrites = updateCalls.filter((c) => c.table === "leagues");
    const hasBracketWrite = bracketWrites.some((c) => "winnersBracket" in c.set);
    expect(hasBracketWrite).toBe(true);
  });

  it("does NOT fetch the winners bracket when playoff_week_start is not set", async () => {
    sleeperMock.getLeague.mockResolvedValue({
      league_id: "L1",
      name: "T",
      season: "2024",
      previous_league_id: null,
      status: "complete",
      settings: {},
      scoring_settings: {},
      roster_positions: [],
      total_rosters: 12,
      draft_id: "D1",
    });
    await syncLeague("L1", undefined, undefined, { skipGlobalSyncs: true });
    expect(sleeperMock.getWinnersBracket).not.toHaveBeenCalled();
  });

  it("swallows winners bracket errors so a flaky bracket doesn't poison the sync", async () => {
    sleeperMock.getWinnersBracket.mockRejectedValue(new Error("boom"));
    await expect(
      syncLeague("L1", undefined, undefined, { skipGlobalSyncs: true })
    ).resolves.toBeUndefined();
  });

  it("does NOT write the winners bracket when none of the matches have a winner", async () => {
    sleeperMock.getWinnersBracket.mockResolvedValue([
      { r: 1, m: 1, t1: 1, t2: 2, w: null, l: null },
    ]);
    await syncLeague("L1", undefined, undefined, { skipGlobalSyncs: true });
    const bracketWrites = updateCalls.filter(
      (c) => c.table === "leagues" && "winnersBracket" in c.set
    );
    expect(bracketWrites).toHaveLength(0);
  });
});

describe("syncLeague — NFL data + grading branches", () => {
  it("invokes hoisted nflverse + fantasyCalc syncs when skipGlobal=false", async () => {
    await syncLeague("L1", undefined, undefined, { skipGlobalSyncs: false });
    expect(syncPlayersMock).toHaveBeenCalled();
    expect(syncRosterStatusMock).toHaveBeenCalled();
    expect(syncInjuriesMock).toHaveBeenCalled();
    expect(syncScheduleMock).toHaveBeenCalled();
    expect(syncFantasyCalcValuesMock).toHaveBeenCalledWith("L1", {
      trigger: "manual",
    });
  });

  it("uses family seasons for NFL data when familyId is supplied", async () => {
    dbState.familyMembers = [
      { season: "2022" },
      { season: "2023" },
      { season: "2024" },
      { season: "2024" }, // dup
    ];
    await syncLeague("L1", undefined, "fam_1", { skipGlobalSyncs: false });
    const lastCall = syncRosterStatusMock.mock.calls.at(-1)?.[0];
    const seasons = lastCall?.seasons as number[];
    expect(seasons).toEqual(expect.arrayContaining([2022, 2023, 2024]));
    expect(seasons).toHaveLength(3); // dedup
  });

  it("calls grading services when familyId is provided + swallows their errors", async () => {
    gradeLeagueTradesMock.mockRejectedValue(new Error("grade trade fail"));
    gradeLeagueDraftsMock.mockRejectedValue(new Error("grade draft fail"));
    gradeLeagueWaiversMock.mockRejectedValue(new Error("grade waiver fail"));
    gradeLeagueLineupsMock.mockRejectedValue(new Error("grade lineup fail"));

    await expect(
      syncLeague("L1", undefined, "fam_1", { skipGlobalSyncs: true })
    ).resolves.toBeUndefined();

    expect(gradeLeagueTradesMock).toHaveBeenCalledWith("L1", "fam_1");
    expect(gradeLeagueDraftsMock).toHaveBeenCalledWith("L1", "fam_1");
    expect(gradeLeagueWaiversMock).toHaveBeenCalledWith("L1", "fam_1");
    expect(gradeLeagueLineupsMock).toHaveBeenCalledWith("L1");
  });

  it("does NOT call trade/draft/waiver grading when familyId is missing", async () => {
    await syncLeague("L1", undefined, undefined, { skipGlobalSyncs: true });
    expect(gradeLeagueTradesMock).not.toHaveBeenCalled();
    expect(gradeLeagueDraftsMock).not.toHaveBeenCalled();
    expect(gradeLeagueWaiversMock).not.toHaveBeenCalled();
    // Lineup grading still runs.
    expect(gradeLeagueLineupsMock).toHaveBeenCalled();
  });
});

describe("syncLeague — onProgress callback", () => {
  it("emits a 'complete' progress event when the sync finishes", async () => {
    const progress: Array<{ step: string }> = [];
    await syncLeague("L1", (p) => progress.push(p), undefined, {
      skipGlobalSyncs: true,
    });

    const steps = progress.map((p) => p.step);
    expect(steps).toContain("league");
    expect(steps).toContain("rosters");
    expect(steps).toContain("transactions");
    expect(steps).toContain("matchups");
    expect(steps).toContain("complete");
  });
});

describe("syncLeagueFamily", () => {
  it("partitions completed (recent) -> skip vs completed (stale) -> sync", async () => {
    const recentTs = new Date(Date.now() - 60 * 1000); // very recent
    const staleTs = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000); // 2 weeks
    dbState.leagueStatuses = [
      { id: "L_recent", status: "complete", lastSyncedAt: recentTs },
      { id: "L_stale", status: "complete", lastSyncedAt: staleTs },
    ];

    sleeperMock.getLeague.mockImplementation(async (id: string) => ({
      league_id: id,
      name: id,
      season: "2024",
      previous_league_id: null,
      status: "complete",
      settings: {},
      scoring_settings: {},
      roster_positions: [],
      total_rosters: 12,
      draft_id: "D",
    }));

    await syncLeagueFamily(["L_recent", "L_stale"], undefined, undefined);

    expect(sleeperMock.getLeague).toHaveBeenCalledWith("L_stale");
    expect(sleeperMock.getLeague).not.toHaveBeenCalledWith("L_recent");
  });

  it("treats unknown leagues as active (sequential path)", async () => {
    dbState.leagueStatuses = []; // no status row -> goes to active branch

    sleeperMock.getLeague.mockImplementation(async (id: string) => ({
      league_id: id,
      name: id,
      season: "2024",
      previous_league_id: null,
      status: "in_season",
      settings: {},
      scoring_settings: {},
      roster_positions: [],
      total_rosters: 12,
      draft_id: "D",
    }));

    await syncLeagueFamily(["L_new"], undefined, undefined);
    expect(sleeperMock.getLeague).toHaveBeenCalledWith("L_new");
  });

  it("rolls up manager grades when familyId is provided", async () => {
    dbState.leagueStatuses = [];
    sleeperMock.getLeague.mockImplementation(async (id: string) => ({
      league_id: id,
      name: id,
      season: "2024",
      previous_league_id: null,
      status: "in_season",
      settings: {},
      scoring_settings: {},
      roster_positions: [],
      total_rosters: 12,
      draft_id: "D",
    }));

    await syncLeagueFamily(["L1"], undefined, "fam_1");
    expect(rollupManagerGradesMock).toHaveBeenCalledWith("fam_1");
  });

  it("swallows manager-grade rollup errors", async () => {
    rollupManagerGradesMock.mockRejectedValue(new Error("rollup boom"));
    dbState.leagueStatuses = [];
    sleeperMock.getLeague.mockImplementation(async (id: string) => ({
      league_id: id,
      name: id,
      season: "2024",
      previous_league_id: null,
      status: "in_season",
      settings: {},
      scoring_settings: {},
      roster_positions: [],
      total_rosters: 12,
      draft_id: "D",
    }));

    await expect(
      syncLeagueFamily(["L1"], undefined, "fam_1")
    ).resolves.toBeUndefined();
  });

  it("throws when EVERY attempted season fails", async () => {
    dbState.leagueStatuses = [
      { id: "L1", status: "complete", lastSyncedAt: null },
      { id: "L2", status: "complete", lastSyncedAt: null },
    ];

    sleeperMock.getLeague.mockRejectedValue(new Error("sleeper down"));

    await expect(
      syncLeagueFamily(["L1", "L2"], undefined, "fam_1")
    ).rejects.toThrow(/All 2 season sync\(s\) failed/);
  });

  it("does NOT throw when only some seasons fail", async () => {
    dbState.leagueStatuses = [
      { id: "L1", status: "complete", lastSyncedAt: null },
      { id: "L2", status: "complete", lastSyncedAt: null },
    ];

    let calls = 0;
    sleeperMock.getLeague.mockImplementation(async (id: string) => {
      calls++;
      if (id === "L1") throw new Error("L1 sleeper down");
      return {
        league_id: id,
        name: id,
        season: "2024",
        previous_league_id: null,
        status: "complete",
        settings: {},
        scoring_settings: {},
        roster_positions: [],
        total_rosters: 12,
        draft_id: "D",
      };
    });

    await expect(
      syncLeagueFamily(["L1", "L2"], undefined, "fam_1")
    ).resolves.toBeUndefined();
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it("hoists nflverse + fantasyCalc syncs at family level", async () => {
    dbState.familyMembers = [{ season: "2024" }];
    dbState.leagueStatuses = [];

    await syncLeagueFamily(["L1"], undefined, "fam_1");

    expect(syncRosterStatusMock).toHaveBeenCalled();
    expect(syncInjuriesMock).toHaveBeenCalled();
    expect(syncScheduleMock).toHaveBeenCalled();
    expect(syncFantasyCalcValuesMock).toHaveBeenCalledWith("L1", {
      trigger: "manual",
    });
  });
});
