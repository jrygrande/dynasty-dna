/**
 * @jest-environment node
 *
 * Verifies the widened FantasyCalc cache key — the staleness lookup and
 * upsert payloads must include numTeams + numQbs so leagues with non-12
 * teams or non-1QB lineups are not served values calibrated for the
 * default 12-team / 1QB format.
 */

// Mock @/db before importing the service so the schema reference resolves
// to a stub the test owns.
jest.mock("@/db", () => {
  const stubColumn = (name: string) => ({ name });
  const fantasyCalcValues = {
    playerId: stubColumn("player_id"),
    isSuperFlex: stubColumn("is_super_flex"),
    ppr: stubColumn("ppr"),
    numTeams: stubColumn("num_teams"),
    numQbs: stubColumn("num_qbs"),
    playerName: stubColumn("player_name"),
    value: stubColumn("value"),
    rank: stubColumn("rank"),
    positionRank: stubColumn("position_rank"),
    position: stubColumn("position"),
    team: stubColumn("team"),
    fetchedAt: stubColumn("fetched_at"),
  };
  const leagues = {
    id: stubColumn("id"),
    scoringSettings: stubColumn("scoring_settings"),
    rosterPositions: stubColumn("roster_positions"),
    totalRosters: stubColumn("total_rosters"),
  };
  return {
    schema: { fantasyCalcValues, leagues },
    getDb: jest.fn(),
  };
});

jest.mock("@/lib/fantasycalc", () => ({
  getFantasyCalcValues: jest.fn(),
}));

// drizzle-orm helpers — capture the columns/values they receive so
// assertions can inspect the WHERE filters and conflict targets.
jest.mock("drizzle-orm", () => ({
  eq: (col: { name: string }, value: unknown) => ({ op: "eq", col, value }),
  and: (...args: unknown[]) => ({ op: "and", args }),
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

import { getDb, schema } from "@/db";
import { getFantasyCalcValues } from "@/lib/fantasycalc";
import {
  syncFantasyCalcValues,
  getDistinctFantasyCalcConfigs,
} from "../fantasyCalcSync";

const mockedGetDb = getDb as jest.MockedFunction<typeof getDb>;
const mockedGetFantasyCalcValues = getFantasyCalcValues as jest.MockedFunction<
  typeof getFantasyCalcValues
>;

type WhereClause = { op: string; args?: unknown[] };

interface InsertCapture {
  rows: Array<Record<string, unknown>>;
  conflictTarget: unknown[];
}

function buildDbMock(opts: {
  league: {
    scoringSettings: Record<string, number> | null;
    rosterPositions: string[];
    totalRosters: number;
  } | null;
  latestFetchedAt: string | null;
  capture: { staleWhere: WhereClause | null; inserts: InsertCapture[] };
}) {
  const { league, latestFetchedAt, capture } = opts;

  return {
    select: jest.fn((cols: Record<string, unknown>) => {
      // First select call (league lookup) asks for scoringSettings/...
      const isLeagueLookup =
        "scoringSettings" in cols || "rosterPositions" in cols;
      return {
        from: jest.fn(() => ({
          where: jest.fn((clause: WhereClause) => {
            if (!isLeagueLookup) {
              capture.staleWhere = clause;
            }
            return {
              limit: jest.fn(() =>
                Promise.resolve(isLeagueLookup && league ? [league] : []),
              ),
              // For staleness query (no .limit())
              then: (resolve: (v: unknown) => void) => {
                if (!isLeagueLookup) {
                  resolve([
                    latestFetchedAt ? { latest: latestFetchedAt } : {},
                  ]);
                } else {
                  resolve(league ? [league] : []);
                }
                return Promise.resolve(undefined);
              },
            };
          }),
        })),
      };
    }),
    insert: jest.fn(() => {
      let captured: InsertCapture | null = null;
      type Builder = {
        values: jest.Mock;
        onConflictDoUpdate: jest.Mock;
      };
      const builder: Builder = {
        values: jest.fn((rows: Array<Record<string, unknown>>) => {
          captured = { rows, conflictTarget: [] };
          capture.inserts.push(captured);
          return builder;
        }),
        onConflictDoUpdate: jest.fn(
          (config: { target: unknown[]; set: unknown }) => {
            if (captured) captured.conflictTarget = config.target;
            return Promise.resolve();
          },
        ),
      };
      return builder;
    }),
  };
}

describe("syncFantasyCalcValues — widened cache key", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("filters staleness lookup by all four config dimensions", async () => {
    const capture = {
      staleWhere: null as WhereClause | null,
      inserts: [] as InsertCapture[],
    };
    const db = buildDbMock({
      league: {
        scoringSettings: { rec: 1 },
        rosterPositions: ["QB", "RB", "WR", "TE", "FLEX", "SUPER_FLEX"],
        totalRosters: 10,
      },
      latestFetchedAt: null,
      capture,
    });
    mockedGetDb.mockReturnValue(db as unknown as ReturnType<typeof getDb>);
    mockedGetFantasyCalcValues.mockResolvedValue([
      {
        player: {
          name: "Player One",
          position: "QB",
          maybeTeam: "KC",
          maybeBirthDate: null,
          espnId: null,
          yahooId: null,
          sleeperId: "sleeper_p1",
        },
        value: 9000,
        overallRank: 1,
        positionRank: 1,
        redraftValue: 9000,
        combinedValue: 9000,
        trend30Day: 0,
      },
    ]);

    await syncFantasyCalcValues("league_1");

    expect(capture.staleWhere).not.toBeNull();
    const whereArgs = (capture.staleWhere as WhereClause).args as Array<{
      col: { name: string };
      value: unknown;
    }>;
    const byCol = Object.fromEntries(whereArgs.map((c) => [c.col.name, c.value]));

    expect(byCol).toMatchObject({
      is_super_flex: true,
      ppr: 1,
      num_teams: 10,
      num_qbs: 2,
    });
  });

  it("calls the FantasyCalc API with the league's numTeams and numQbs", async () => {
    const capture = {
      staleWhere: null as WhereClause | null,
      inserts: [] as InsertCapture[],
    };
    const db = buildDbMock({
      league: {
        scoringSettings: { rec: 0 },
        rosterPositions: ["QB", "RB", "WR", "TE"],
        totalRosters: 14,
      },
      latestFetchedAt: null,
      capture,
    });
    mockedGetDb.mockReturnValue(db as unknown as ReturnType<typeof getDb>);
    mockedGetFantasyCalcValues.mockResolvedValue([
      {
        player: {
          name: "P",
          position: "RB",
          maybeTeam: "DAL",
          maybeBirthDate: null,
          espnId: null,
          yahooId: null,
          sleeperId: "rb1",
        },
        value: 5000,
        overallRank: 5,
        positionRank: 1,
        redraftValue: 5000,
        combinedValue: 5000,
        trend30Day: 0,
      },
    ]);

    await syncFantasyCalcValues("league_x");

    expect(mockedGetFantasyCalcValues).toHaveBeenCalledWith({
      isDynasty: true,
      numQbs: 1,
      numTeams: 14,
      ppr: 0,
    });
  });

  it("upserts rows including numTeams + numQbs and uses the full conflict target", async () => {
    const capture = {
      staleWhere: null as WhereClause | null,
      inserts: [] as InsertCapture[],
    };
    const db = buildDbMock({
      league: {
        scoringSettings: { rec: 0.5 },
        rosterPositions: ["QB", "RB", "WR", "TE", "SUPER_FLEX"],
        totalRosters: 10,
      },
      latestFetchedAt: null,
      capture,
    });
    mockedGetDb.mockReturnValue(db as unknown as ReturnType<typeof getDb>);
    mockedGetFantasyCalcValues.mockResolvedValue([
      {
        player: {
          name: "Player",
          position: "WR",
          maybeTeam: "BUF",
          maybeBirthDate: null,
          espnId: null,
          yahooId: null,
          sleeperId: "wr_1",
        },
        value: 4500,
        overallRank: 20,
        positionRank: 5,
        redraftValue: 4500,
        combinedValue: 4500,
        trend30Day: 0,
      },
    ]);

    await syncFantasyCalcValues("league_y");

    expect(capture.inserts.length).toBeGreaterThan(0);
    const insert = capture.inserts[0];
    expect(insert.rows[0]).toMatchObject({
      playerId: "wr_1",
      isSuperFlex: true,
      ppr: 0.5,
      numTeams: 10,
      numQbs: 2,
    });

    // Conflict target must include numTeams + numQbs so rows from
    // different formats don't collide.
    const targetCols = (insert.conflictTarget as Array<{ name: string }>).map(
      (c) => c.name,
    );
    expect(targetCols).toEqual(
      expect.arrayContaining(["num_teams", "num_qbs"]),
    );
  });

  it("respects staleness window per format (skips fetch when fresh)", async () => {
    const recent = new Date(Date.now() - 60 * 1000).toISOString();
    const capture = {
      staleWhere: null as WhereClause | null,
      inserts: [] as InsertCapture[],
    };
    const db = buildDbMock({
      league: {
        scoringSettings: { rec: 1 },
        rosterPositions: ["QB", "RB", "WR", "TE", "SUPER_FLEX"],
        totalRosters: 12,
      },
      latestFetchedAt: recent,
      capture,
    });
    mockedGetDb.mockReturnValue(db as unknown as ReturnType<typeof getDb>);

    const result = await syncFantasyCalcValues("league_z");

    expect(result).toBeInstanceOf(Date);
    expect(mockedGetFantasyCalcValues).not.toHaveBeenCalled();
  });

  // Touch the schema mock so eslint/TS sees it as used and to keep the
  // import alive when refactoring.
  it("references the table fields the production code targets", () => {
    expect(schema.fantasyCalcValues.numTeams).toBeDefined();
    expect(schema.fantasyCalcValues.numQbs).toBeDefined();
  });
});

describe("getDistinctFantasyCalcConfigs", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("dedupes leagues that share a (sf, ppr, teams, qbs) combo", async () => {
    const rows = [
      {
        scoringSettings: { rec: 0.5 },
        rosterPositions: ["QB", "RB", "WR", "TE"],
        totalRosters: 12,
      },
      {
        scoringSettings: { rec: 0.5 },
        rosterPositions: ["QB", "RB", "WR", "TE"],
        totalRosters: 12,
      },
      {
        scoringSettings: { rec: 1 },
        rosterPositions: ["QB", "RB", "WR", "TE", "SUPER_FLEX"],
        totalRosters: 10,
      },
    ];
    mockedGetDb.mockReturnValue({
      select: jest.fn(() => ({ from: jest.fn(() => Promise.resolve(rows)) })),
    } as unknown as ReturnType<typeof getDb>);

    const combos = await getDistinctFantasyCalcConfigs();
    expect(combos).toHaveLength(2);
    expect(combos).toEqual(
      expect.arrayContaining([
        { isSuperFlex: false, ppr: 0.5, numTeams: 12, numQbs: 1 },
        { isSuperFlex: true, ppr: 1, numTeams: 10, numQbs: 2 },
      ]),
    );
  });
});
