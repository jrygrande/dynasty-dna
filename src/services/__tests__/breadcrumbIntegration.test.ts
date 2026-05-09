/**
 * @jest-environment node
 *
 * Integration test for Sync 9b (#152): every top-level sync service must
 * emit a structured breadcrumb on success and a `outcome: "failed"` one
 * on error, then re-throw the original error so the caller still sees it.
 *
 * Strategy: mock @/db so the staleness gates immediately return "stale"
 * (or in scheduleSync's case, drive the CSV fetch to fail), call the
 * service, and inspect what was passed to recordSyncBreadcrumb.
 */

const recordSyncBreadcrumb = jest.fn();
jest.mock("@/lib/observability/syncBreadcrumb", () => {
  const actual = jest.requireActual("@/lib/observability/syncBreadcrumb");
  return {
    ...actual,
    recordSyncBreadcrumb,
  };
});

jest.mock("drizzle-orm", () => ({
  eq: (col: { name: string }, value: unknown) => ({ op: "eq", col, value }),
  and: (...args: unknown[]) => ({ op: "and", args }),
  isNull: (col: { name: string }) => ({ op: "isNull", col }),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({
      op: "sql",
      strings: Array.from(strings),
      values,
    }),
    {
      raw: (s: string) => s,
    },
  ),
}));

jest.mock("@/db", () => {
  const stubColumn = (name: string) => ({ name });
  return {
    schema: {
      players: {
        id: stubColumn("id"),
        name: stubColumn("name"),
        gsisId: stubColumn("gsis_id"),
        firstName: stubColumn("first_name"),
        lastName: stubColumn("last_name"),
        position: stubColumn("position"),
        team: stubColumn("team"),
        age: stubColumn("age"),
        status: stubColumn("status"),
        injuryStatus: stubColumn("injury_status"),
        yearsExp: stubColumn("years_exp"),
        updatedAt: stubColumn("updated_at"),
      },
      nflWeeklyRosterStatus: {
        gsisId: stubColumn("gsis_id"),
        playerName: stubColumn("player_name"),
        position: stubColumn("position"),
        season: stubColumn("season"),
      },
      nflInjuries: {
        season: stubColumn("season"),
        gsisId: stubColumn("gsis_id"),
      },
      nflSchedule: {
        season: stubColumn("season"),
      },
      fantasyCalcValues: {
        playerId: stubColumn("player_id"),
        isSuperFlex: stubColumn("is_super_flex"),
        ppr: stubColumn("ppr"),
        numTeams: stubColumn("num_teams"),
        numQbs: stubColumn("num_qbs"),
        fetchedAt: stubColumn("fetched_at"),
      },
      leagues: {
        id: stubColumn("id"),
        scoringSettings: stubColumn("scoring_settings"),
        rosterPositions: stubColumn("roster_positions"),
        totalRosters: stubColumn("total_rosters"),
      },
    },
    getDb: jest.fn(),
    getSyncDb: jest.fn(),
  };
});

jest.mock("@/services/nflverseWatermark", () => ({
  setNflverseWatermarkTx: jest.fn(),
  shouldSkipSeasonSync: jest.fn().mockResolvedValue(false),
}));

jest.mock("@/lib/sleeper", () => ({
  Sleeper: {
    getPlayers: jest.fn(),
  },
}));

jest.mock("@/lib/fantasycalc", () => ({
  getFantasyCalcValues: jest.fn(),
}));

import { getDb, getSyncDb } from "@/db";
import { Sleeper } from "@/lib/sleeper";
import { getFantasyCalcValues } from "@/lib/fantasycalc";
import { syncPlayers } from "../playerSync";
import { syncFantasyCalcValuesForConfig } from "../fantasyCalcSync";
import {
  syncSchedule,
  __resetScheduleCsvCache,
} from "../scheduleSync";
import { syncInjuries } from "../injurySync";
import { syncRosterStatus } from "../rosterStatusSync";

const mockedGetDb = getDb as jest.MockedFunction<typeof getDb>;
const mockedGetSyncDb = getSyncDb as jest.MockedFunction<typeof getSyncDb>;
const mockedGetPlayers = Sleeper.getPlayers as jest.MockedFunction<
  typeof Sleeper.getPlayers
>;
const mockedGetFantasyCalcValues = getFantasyCalcValues as jest.MockedFunction<
  typeof getFantasyCalcValues
>;

function makeReadDb() {
  return {
    select: jest.fn(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() => Promise.resolve([{ count: 0 }])),
      })),
    })),
    selectDistinct: jest.fn(() => ({
      from: jest.fn(() => Promise.resolve([])),
    })),
    insert: jest.fn(() => ({
      values: jest.fn(() => ({
        onConflictDoUpdate: jest.fn(() => Promise.resolve()),
      })),
    })),
    update: jest.fn(() => ({
      set: jest.fn(() => ({
        where: jest.fn(() => Promise.resolve()),
      })),
    })),
  };
}

function makeSyncDb() {
  return {
    transaction: jest.fn(async (cb: (tx: unknown) => Promise<void>) => {
      await cb({
        delete: jest.fn(() => ({ where: jest.fn(() => Promise.resolve()) })),
        insert: jest.fn(() => ({
          values: jest.fn(() => ({
            onConflictDoNothing: jest.fn(() => Promise.resolve()),
            onConflictDoUpdate: jest.fn(() => Promise.resolve()),
          })),
        })),
      });
    }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  __resetScheduleCsvCache();
});

describe("syncPlayers breadcrumb", () => {
  it("emits a success breadcrumb when fresh data lets it skip", async () => {
    // Latest update is recent so isStale() returns false; we still want to
    // see the breadcrumb so dashboards know syncPlayers was invoked.
    mockedGetDb.mockReturnValue({
      select: jest.fn(() => ({
        from: jest.fn(() =>
          Promise.resolve([{ latest: new Date().toISOString() }]),
        ),
      })),
    } as unknown as ReturnType<typeof getDb>);

    await syncPlayers(false, { trigger: "cron", scope: "test-scope" });

    expect(recordSyncBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "sleeper",
        trigger: "cron",
        scope: "test-scope",
        outcome: "success",
        apiCalls: 0,
      }),
    );
  });

  it("emits failed breadcrumb and re-throws on Sleeper error", async () => {
    // Force the staleness check to claim "stale" so we proceed to fetch.
    mockedGetDb.mockReturnValue({
      select: jest.fn(() => ({
        from: jest.fn(() => Promise.resolve([{ latest: null }])),
      })),
    } as unknown as ReturnType<typeof getDb>);
    mockedGetPlayers.mockRejectedValueOnce(new Error("Sleeper down"));

    await expect(
      syncPlayers(true, { trigger: "manual", scope: "fail-test" }),
    ).rejects.toThrow("Sleeper down");

    expect(recordSyncBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "sleeper",
        trigger: "manual",
        scope: "fail-test",
        outcome: "failed",
        error: "Sleeper down",
      }),
    );
  });
});

describe("syncFantasyCalcValuesForConfig breadcrumb", () => {
  function setupDb() {
    mockedGetDb.mockReturnValue({
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            limit: jest.fn(() => Promise.resolve([])),
            // Staleness fall-through (no .latest, so not fresh)
            then: (resolve: (v: unknown) => void) => {
              resolve([{}]);
              return Promise.resolve(undefined);
            },
          })),
        })),
      })),
      insert: jest.fn(() => ({
        values: jest.fn(() => ({
          onConflictDoUpdate: jest.fn(() => Promise.resolve()),
        })),
      })),
    } as unknown as ReturnType<typeof getDb>);
  }

  it("emits a success breadcrumb with apiCalls=1 on a real run", async () => {
    setupDb();
    mockedGetFantasyCalcValues.mockResolvedValueOnce([
      {
        player: {
          name: "Player",
          position: "QB",
          maybeTeam: "KC",
          maybeBirthDate: null,
          espnId: null,
          yahooId: null,
          sleeperId: "p1",
        },
        value: 9000,
        overallRank: 1,
        positionRank: 1,
        redraftValue: 9000,
        combinedValue: 9000,
        trend30Day: 0,
      },
    ]);

    await syncFantasyCalcValuesForConfig(
      { isSuperFlex: false, ppr: 0.5, numTeams: 12, numQbs: 1 },
      { trigger: "cron" },
    );

    expect(recordSyncBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "fantasycalc",
        trigger: "cron",
        outcome: "success",
        apiCalls: 1,
      }),
    );
  });

  it("emits failed breadcrumb on FantasyCalc error", async () => {
    setupDb();
    mockedGetFantasyCalcValues.mockRejectedValueOnce(new Error("FC 503"));

    await expect(
      syncFantasyCalcValuesForConfig(
        { isSuperFlex: false, ppr: 0.5, numTeams: 12, numQbs: 1 },
        { trigger: "manual" },
      ),
    ).rejects.toThrow("FC 503");

    expect(recordSyncBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "fantasycalc",
        trigger: "manual",
        outcome: "failed",
        error: "FC 503",
      }),
    );
  });
});

describe("syncSchedule breadcrumb", () => {
  it("emits success breadcrumb after a clean run", async () => {
    mockedGetDb.mockReturnValue(
      makeReadDb() as unknown as ReturnType<typeof getDb>,
    );
    mockedGetSyncDb.mockReturnValue(
      makeSyncDb() as unknown as ReturnType<typeof getSyncDb>,
    );

    const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(
        "season,game_type,week,home_team,away_team,home_score,away_score,gameday\n2024,REG,1,KC,BAL,27,20,2024-09-05",
        { status: 200 },
      ) as unknown as Response,
    );

    await syncSchedule({ seasons: [2024], trigger: "cron" });

    expect(recordSyncBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "nflverse",
        trigger: "cron",
        outcome: "success",
        apiCalls: 1,
      }),
    );

    fetchSpy.mockRestore();
  });

  it("emits failed breadcrumb when CSV fetch fails", async () => {
    mockedGetDb.mockReturnValue(
      makeReadDb() as unknown as ReturnType<typeof getDb>,
    );
    mockedGetSyncDb.mockReturnValue(
      makeSyncDb() as unknown as ReturnType<typeof getSyncDb>,
    );

    const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response("oops", { status: 500 }) as unknown as Response,
    );

    await expect(
      syncSchedule({ seasons: [2024], trigger: "cron" }),
    ).rejects.toThrow(/Failed to fetch schedule data/);

    expect(recordSyncBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "nflverse",
        trigger: "cron",
        outcome: "failed",
      }),
    );

    fetchSpy.mockRestore();
  });
});

describe("syncInjuries breadcrumb", () => {
  it("emits success breadcrumb (zero seasons -> zero api calls)", async () => {
    mockedGetDb.mockReturnValue(
      makeReadDb() as unknown as ReturnType<typeof getDb>,
    );

    // No seasons means we don't actually fetch — but the breadcrumb still
    // fires so the audit trail shows the call site was hit.
    await syncInjuries({ seasons: [], trigger: "cron" });

    expect(recordSyncBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "nflverse",
        trigger: "cron",
        scope: expect.stringContaining("injuries"),
        outcome: "success",
      }),
    );
  });
});

describe("syncRosterStatus breadcrumb", () => {
  it("emits success breadcrumb (zero seasons -> zero api calls)", async () => {
    mockedGetDb.mockReturnValue(
      makeReadDb() as unknown as ReturnType<typeof getDb>,
    );

    await syncRosterStatus({ seasons: [], trigger: "cron" });

    expect(recordSyncBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "nflverse",
        trigger: "cron",
        scope: expect.stringContaining("roster-status"),
        outcome: "success",
      }),
    );
  });
});
