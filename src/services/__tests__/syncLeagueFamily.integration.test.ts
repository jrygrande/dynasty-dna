/**
 * @jest-environment node
 *
 * Integration test for syncLeagueFamily / syncLeague against the dev Neon
 * branch. Real DB writes; mocked Sleeper.
 *
 * Self-skips when:
 *   - DATABASE_URL_DEV is not set, OR
 *   - the resolved hostname doesn't match the dev-branch convention.
 *
 * The dev-branch convention mirrors `scripts/reset-db.ts`: hostname
 * contains `-dev.` or `dev-branch`, OR appears in the comma-separated
 * `NEON_DEV_HOST_ALLOWLIST` env var.
 *
 * What it verifies:
 *   1. A first sync writes rows to leagues, league_users, rosters, drafts,
 *      draft_picks, traded_picks, transactions, matchups, and the matching
 *      sync_watermarks rows.
 *   2. Re-running the sync is idempotent — row counts don't change, no
 *      uniqueness violations, and the warm-path skip in syncLeagueFamily
 *      kicks in for completed seasons synced within the staleness window.
 */

import { resolveDatabaseUrl } from "@/db";

// ---- Decide whether to run before pulling in heavyweight imports. ----

const DEV_HOST_PATTERNS = [/-dev\./i, /dev-branch/i];

function looksLikeDevHost(url: string): boolean {
  try {
    const host = new URL(url).host.toLowerCase();
    if (DEV_HOST_PATTERNS.some((p) => p.test(host))) return true;
    const allowlist = (process.env.NEON_DEV_HOST_ALLOWLIST ?? "")
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean);
    return allowlist.includes(host);
  } catch {
    return false;
  }
}

const integrationEnabled = (() => {
  if (!process.env.DATABASE_URL_DEV) return false;
  if (process.env.VERCEL_ENV) return false; // never run integration on Vercel
  try {
    const { url, source } = resolveDatabaseUrl();
    if (source !== "DATABASE_URL_DEV") return false;
    return looksLikeDevHost(url);
  } catch {
    return false;
  }
})();

const describeIntegration = integrationEnabled ? describe : describe.skip;

if (!integrationEnabled) {
  // eslint-disable-next-line no-console
  console.info(
    "[integration] syncLeagueFamily integration skipped — set DATABASE_URL_DEV and (NEON_DEV_HOST_ALLOWLIST or `-dev.` host) to enable."
  );
}

// ---- Mocks: Sleeper at the fetch boundary, heavy downstream services. ----

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
  getPlayers: jest.fn(),
  getNFLState: jest.fn(),
  getUserByUsername: jest.fn(),
  getUserById: jest.fn(),
  getLeaguesByUser: jest.fn(),
};

jest.mock("@/lib/sleeper", () => ({
  Sleeper: sleeperMock,
}));

// Stub heavy downstream services so this test stays focused on the rows
// syncLeague itself writes (drafts, transactions, matchups, watermarks).
// These services already have their own unit tests.
jest.mock("@/services/playerSync", () => ({
  syncPlayers: jest.fn(async () => 0),
}));
jest.mock("@/services/assetEvents", () => ({
  buildAssetEvents: jest.fn(async () => 0),
}));
jest.mock("@/services/rosterStatusSync", () => ({
  syncRosterStatus: jest.fn(async () => ({ total: 0, seasonResults: {} })),
}));
jest.mock("@/services/injurySync", () => ({
  syncInjuries: jest.fn(async () => ({ total: 0, seasonResults: {} })),
}));
jest.mock("@/services/scheduleSync", () => ({
  syncSchedule: jest.fn(async () => ({ total: 0, seasonResults: {} })),
}));
jest.mock("@/services/fantasyCalcSync", () => ({
  syncFantasyCalcValues: jest.fn(async () => new Date()),
}));
jest.mock("@/services/tradeGrading", () => ({
  gradeLeagueTrades: jest.fn(async () => undefined),
}));
jest.mock("@/services/lineupGrading", () => ({
  gradeLeagueLineups: jest.fn(async () => undefined),
}));
jest.mock("@/services/draftGrading", () => ({
  gradeLeagueDrafts: jest.fn(async () => undefined),
}));
jest.mock("@/services/waiverGrading", () => ({
  gradeLeagueWaivers: jest.fn(async () => undefined),
}));
jest.mock("@/services/managerGrades", () => ({
  rollupManagerGrades: jest.fn(async () => undefined),
}));

import { syncLeague, syncLeagueFamily } from "../sync";
import { getDb, getSyncDb, schema } from "@/db";
import { eq, sql } from "drizzle-orm";

const TEST_LEAGUE_ID = "test_int_L1";
const TEST_DRAFT_ID = "test_int_D1";

function buildSleeperFixtures() {
  sleeperMock.getLeague.mockResolvedValue({
    league_id: TEST_LEAGUE_ID,
    name: "Integration Test League",
    season: "2024",
    previous_league_id: null,
    status: "complete",
    settings: { playoff_week_start: 15 },
    scoring_settings: { rec: 1 },
    roster_positions: ["QB", "RB", "WR", "TE", "FLEX"],
    total_rosters: 2,
    draft_id: TEST_DRAFT_ID,
  });

  sleeperMock.getLeagueUsers.mockResolvedValue([
    {
      user_id: "test_int_u1",
      display_name: "Alice",
      metadata: { team_name: "Team A" },
      avatar: null,
    },
    {
      user_id: "test_int_u2",
      display_name: "Bob",
      metadata: { team_name: "Team B" },
      avatar: null,
    },
  ]);

  sleeperMock.getRosters.mockResolvedValue([
    {
      roster_id: 1,
      owner_id: "test_int_u1",
      players: ["test_int_p1"],
      starters: ["test_int_p1"],
      reserve: [],
      settings: { wins: 10, losses: 4, ties: 0, fpts: 1500, fpts_decimal: 25 },
    },
    {
      roster_id: 2,
      owner_id: "test_int_u2",
      players: ["test_int_p2"],
      starters: ["test_int_p2"],
      reserve: [],
      settings: { wins: 4, losses: 10, ties: 0, fpts: 1200, fpts_decimal: 0 },
    },
  ]);

  sleeperMock.getDrafts.mockResolvedValue([
    {
      draft_id: TEST_DRAFT_ID,
      league_id: TEST_LEAGUE_ID,
      season: "2024",
      type: "snake",
      status: "complete",
      start_time: 1_700_000_000_000,
      settings: {},
      slot_to_roster_id: { "1": 1, "2": 2 },
    },
  ]);

  sleeperMock.getDraftPicks.mockResolvedValue([
    {
      round: 1,
      pick_no: 1,
      draft_slot: 1,
      roster_id: 1,
      player_id: "test_int_p1",
      is_keeper: null,
      metadata: {},
    },
    {
      round: 1,
      pick_no: 2,
      draft_slot: 2,
      roster_id: 2,
      player_id: "test_int_p2",
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

  sleeperMock.getTransactions.mockImplementation(async (_id, week) => {
    if (week === 1) {
      return [
        {
          transaction_id: "test_int_tx1",
          type: "trade",
          status: "complete",
          roster_ids: [1, 2],
          adds: { test_int_p1: 2 },
          drops: { test_int_p2: 1 },
          draft_picks: [],
          leg: 1,
          settings: {},
          created: 1_700_000_001_000,
        },
        {
          transaction_id: "test_int_tx2",
          type: "waiver",
          status: "complete",
          roster_ids: [1],
          adds: { test_int_p3: 1 },
          drops: null,
          draft_picks: [],
          leg: 1,
          settings: { waiver_bid: 5 },
          created: 1_700_000_002_000,
        },
      ];
    }
    return [];
  });

  sleeperMock.getMatchups.mockImplementation(async (_id, week) => {
    if (week >= 1 && week <= 14) {
      return [
        {
          roster_id: 1,
          matchup_id: 1,
          points: 100 + week,
          starters: ["test_int_p1"],
          starters_points: [10 + week],
          players: ["test_int_p1"],
          players_points: { test_int_p1: 10 + week },
        },
        {
          roster_id: 2,
          matchup_id: 1,
          points: 90 + week,
          starters: ["test_int_p2"],
          starters_points: [9 + week],
          players: ["test_int_p2"],
          players_points: { test_int_p2: 9 + week },
        },
      ];
    }
    return [];
  });

  sleeperMock.getWinnersBracket.mockResolvedValue([
    { r: 1, m: 1, t1: 1, t2: 2, w: 1, l: 2 },
  ]);
}

async function cleanupTestRows(): Promise<void> {
  const db = getDb();
  await db
    .delete(schema.matchups)
    .where(eq(schema.matchups.leagueId, TEST_LEAGUE_ID));
  await db
    .delete(schema.playerScores)
    .where(eq(schema.playerScores.leagueId, TEST_LEAGUE_ID));
  await db
    .delete(schema.transactions)
    .where(eq(schema.transactions.leagueId, TEST_LEAGUE_ID));
  await db
    .delete(schema.tradedPicks)
    .where(eq(schema.tradedPicks.leagueId, TEST_LEAGUE_ID));
  await db
    .delete(schema.draftPicks)
    .where(eq(schema.draftPicks.draftId, TEST_DRAFT_ID));
  await db.delete(schema.drafts).where(eq(schema.drafts.id, TEST_DRAFT_ID));
  await db
    .delete(schema.rosters)
    .where(eq(schema.rosters.leagueId, TEST_LEAGUE_ID));
  await db
    .delete(schema.leagueUsers)
    .where(eq(schema.leagueUsers.leagueId, TEST_LEAGUE_ID));
  await db
    .delete(schema.syncWatermarks)
    .where(eq(schema.syncWatermarks.leagueId, TEST_LEAGUE_ID));
  await db.delete(schema.leagues).where(eq(schema.leagues.id, TEST_LEAGUE_ID));
}

async function countWhere(
  // eslint-disable-next-line
  table: any,
  whereClause: ReturnType<typeof eq>
): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(table)
    .where(whereClause);
  return Number(rows[0]?.c ?? 0);
}

describeIntegration("syncLeagueFamily integration (dev DB)", () => {
  beforeAll(async () => {
    if (!integrationEnabled) return;
    const { url, source } = resolveDatabaseUrl();
    if (source !== "DATABASE_URL_DEV" || !looksLikeDevHost(url)) {
      throw new Error(
        `[integration] refusing to run: resolved DB is ${source} (${new URL(url).host})`
      );
    }
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    buildSleeperFixtures();
    await cleanupTestRows();
  });

  afterAll(async () => {
    if (!integrationEnabled) return;
    await cleanupTestRows();

    // Drain neon's WS pool so jest can exit cleanly.
    try {
      // eslint-disable-next-line
      const syncDb = getSyncDb() as any;
      if (typeof syncDb.$client?.end === "function") {
        await syncDb.$client.end();
      }
    } catch {
      // Best effort.
    }
  });

  it("first sync writes leagues, rosters, drafts, transactions, matchups, watermarks", async () => {
    await syncLeague(TEST_LEAGUE_ID, undefined, undefined, {
      skipGlobalSyncs: true,
    });

    const leagueCount = await countWhere(
      schema.leagues,
      eq(schema.leagues.id, TEST_LEAGUE_ID)
    );
    expect(leagueCount).toBe(1);

    const userCount = await countWhere(
      schema.leagueUsers,
      eq(schema.leagueUsers.leagueId, TEST_LEAGUE_ID)
    );
    expect(userCount).toBe(2);

    const rosterCount = await countWhere(
      schema.rosters,
      eq(schema.rosters.leagueId, TEST_LEAGUE_ID)
    );
    expect(rosterCount).toBe(2);

    const draftCount = await countWhere(
      schema.drafts,
      eq(schema.drafts.id, TEST_DRAFT_ID)
    );
    expect(draftCount).toBe(1);

    const draftPickCount = await countWhere(
      schema.draftPicks,
      eq(schema.draftPicks.draftId, TEST_DRAFT_ID)
    );
    expect(draftPickCount).toBe(2);

    const tradedPickCount = await countWhere(
      schema.tradedPicks,
      eq(schema.tradedPicks.leagueId, TEST_LEAGUE_ID)
    );
    expect(tradedPickCount).toBe(1);

    const txCount = await countWhere(
      schema.transactions,
      eq(schema.transactions.leagueId, TEST_LEAGUE_ID)
    );
    expect(txCount).toBe(2);

    const matchupCount = await countWhere(
      schema.matchups,
      eq(schema.matchups.leagueId, TEST_LEAGUE_ID)
    );
    // 2 rosters * 14 weeks (only weeks 1-14 return data in the fixture)
    expect(matchupCount).toBe(2 * 14);

    // Watermarks: completed season -> set to maxWeek (18)
    const db = getDb();
    const wmRows = await db
      .select()
      .from(schema.syncWatermarks)
      .where(eq(schema.syncWatermarks.leagueId, TEST_LEAGUE_ID));
    const byType = new Map(wmRows.map((r) => [r.dataType, r.lastWeek]));
    expect(byType.get("transactions")).toBe(18);
    expect(byType.get("matchups")).toBe(18);
  }, 60_000);

  it("re-running is idempotent — counts unchanged on second run", async () => {
    await syncLeague(TEST_LEAGUE_ID, undefined, undefined, {
      skipGlobalSyncs: true,
    });

    const counts1 = await Promise.all([
      countWhere(schema.leagues, eq(schema.leagues.id, TEST_LEAGUE_ID)),
      countWhere(
        schema.rosters,
        eq(schema.rosters.leagueId, TEST_LEAGUE_ID)
      ),
      countWhere(
        schema.draftPicks,
        eq(schema.draftPicks.draftId, TEST_DRAFT_ID)
      ),
      countWhere(
        schema.transactions,
        eq(schema.transactions.leagueId, TEST_LEAGUE_ID)
      ),
      countWhere(
        schema.matchups,
        eq(schema.matchups.leagueId, TEST_LEAGUE_ID)
      ),
      countWhere(
        schema.tradedPicks,
        eq(schema.tradedPicks.leagueId, TEST_LEAGUE_ID)
      ),
    ]);

    await syncLeague(TEST_LEAGUE_ID, undefined, undefined, {
      skipGlobalSyncs: true,
    });

    const counts2 = await Promise.all([
      countWhere(schema.leagues, eq(schema.leagues.id, TEST_LEAGUE_ID)),
      countWhere(
        schema.rosters,
        eq(schema.rosters.leagueId, TEST_LEAGUE_ID)
      ),
      countWhere(
        schema.draftPicks,
        eq(schema.draftPicks.draftId, TEST_DRAFT_ID)
      ),
      countWhere(
        schema.transactions,
        eq(schema.transactions.leagueId, TEST_LEAGUE_ID)
      ),
      countWhere(
        schema.matchups,
        eq(schema.matchups.leagueId, TEST_LEAGUE_ID)
      ),
      countWhere(
        schema.tradedPicks,
        eq(schema.tradedPicks.leagueId, TEST_LEAGUE_ID)
      ),
    ]);

    expect(counts2).toEqual(counts1);
  }, 60_000);

  it("syncLeagueFamily skips a recently-synced complete league (warm-path)", async () => {
    await syncLeague(TEST_LEAGUE_ID, undefined, undefined, {
      skipGlobalSyncs: true,
    });

    sleeperMock.getLeague.mockClear();

    await syncLeagueFamily([TEST_LEAGUE_ID], undefined, undefined);

    expect(sleeperMock.getLeague).not.toHaveBeenCalled();
  }, 60_000);
});
