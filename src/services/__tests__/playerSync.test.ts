/**
 * @jest-environment node
 *
 * Unit tests for playerSync.ts.
 *
 * Coverage targets:
 *   - Staleness gate: skip when most recent player row is < 24h old, run
 *     when stale (and when the table is empty).
 *   - Force flag: bypasses the staleness check.
 *   - Position filter: only QB/RB/WR/TE/K/DEF entries land in the upsert.
 *   - GSIS normalization: strips whitespace from sleeper-supplied gsis_id.
 *   - GSIS backfill: name-match (single match), position-disambiguated match,
 *     and ambiguous (no match) cases.
 */

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
      },
    },
    getDb: jest.fn(),
  };
});

jest.mock("@/lib/sleeper", () => ({
  Sleeper: { getPlayers: jest.fn() },
}));

jest.mock("drizzle-orm", () => ({
  isNull: (col: { name: string }) => ({ op: "isNull", col }),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({
      op: "sql",
      strings: Array.from(strings),
      values,
    }),
    {
      raw: (s: string) => s,
    }
  ),
}));

import { getDb } from "@/db";
import { Sleeper } from "@/lib/sleeper";
import type { SleeperPlayerMap } from "@/lib/sleeper";
import { syncPlayers } from "../playerSync";

const mockedGetDb = getDb as jest.MockedFunction<typeof getDb>;
const mockedGetPlayers = Sleeper.getPlayers as jest.MockedFunction<
  typeof Sleeper.getPlayers
>;

interface InsertCapture {
  rows: Array<Record<string, unknown>>;
}

interface DbState {
  // staleness query: latest updatedAt (string ISO or null)
  latestUpdatedAt: string | null;
  // backfill missing-gsis players
  missingGsisPlayers: Array<{ id: string; name: string; position: string | null }>;
  // nflverse roster crosswalk for backfill
  rosterEntries: Array<{
    gsisId: string;
    name: string | null;
    position: string | null;
  }>;
  inserts: InsertCapture[];
  updates: Array<{ set: Record<string, unknown> }>;
}

function buildDb(state: DbState) {
  return {
    select: jest.fn((cols: Record<string, unknown>) => {
      // Distinguish select shape by column names:
      //  - { latest: sql<>... } → staleness lookup, awaited directly off .from()
      //  - { id, name, position }  → missing-gsis players, has .where()
      const isStaleness = cols && "latest" in cols;
      if (isStaleness) {
        return {
          from: jest.fn(() =>
            Promise.resolve(
              state.latestUpdatedAt
                ? [{ latest: state.latestUpdatedAt }]
                : [{}]
            )
          ),
        };
      }
      return {
        from: jest.fn(() => ({
          where: jest.fn(() => Promise.resolve(state.missingGsisPlayers)),
        })),
      };
    }),
    selectDistinct: jest.fn(() => ({
      from: jest.fn(() => Promise.resolve(state.rosterEntries)),
    })),
    insert: jest.fn(() => {
      let captured: InsertCapture | null = null;
      type Builder = {
        values: jest.Mock;
        onConflictDoUpdate: jest.Mock;
      };
      const builder: Builder = {
        values: jest.fn((rows: Array<Record<string, unknown>>): Builder => {
          captured = { rows };
          state.inserts.push(captured);
          return builder;
        }),
        onConflictDoUpdate: jest.fn(() => Promise.resolve()),
      };
      return builder;
    }),
    update: jest.fn(() => ({
      set: jest.fn((s: Record<string, unknown>) => {
        state.updates.push({ set: s });
        return {
          where: jest.fn(() => Promise.resolve()),
        };
      }),
    })),
  };
}

function makePlayer(
  overrides: Partial<SleeperPlayerMap[string]> & { player_id: string }
): SleeperPlayerMap[string] {
  return {
    player_id: overrides.player_id,
    gsis_id: overrides.gsis_id ?? null,
    full_name: overrides.full_name ?? "First Last",
    first_name: overrides.first_name ?? "First",
    last_name: overrides.last_name ?? "Last",
    position: overrides.position ?? "RB",
    team: overrides.team ?? "DAL",
    age: overrides.age ?? 25,
    status: overrides.status ?? "Active",
    injury_status: overrides.injury_status ?? null,
    years_exp: overrides.years_exp ?? 3,
  };
}

describe("syncPlayers staleness gate", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("skips when last update is < 24h old (returns 0, no Sleeper call)", async () => {
    const state: DbState = {
      latestUpdatedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      missingGsisPlayers: [],
      rosterEntries: [],
      inserts: [],
      updates: [],
    };
    mockedGetDb.mockReturnValue(buildDb(state) as unknown as ReturnType<typeof getDb>);

    const result = await syncPlayers();

    expect(result).toBe(0);
    expect(mockedGetPlayers).not.toHaveBeenCalled();
  });

  it("runs when the players table is empty (no latest)", async () => {
    const state: DbState = {
      latestUpdatedAt: null,
      missingGsisPlayers: [],
      rosterEntries: [],
      inserts: [],
      updates: [],
    };
    mockedGetDb.mockReturnValue(buildDb(state) as unknown as ReturnType<typeof getDb>);
    mockedGetPlayers.mockResolvedValue({
      p1: makePlayer({ player_id: "p1", position: "QB" }),
    });

    const result = await syncPlayers();

    expect(result).toBe(1);
    expect(mockedGetPlayers).toHaveBeenCalled();
  });

  it("runs when the data is older than 24 hours", async () => {
    const state: DbState = {
      latestUpdatedAt: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString(),
      missingGsisPlayers: [],
      rosterEntries: [],
      inserts: [],
      updates: [],
    };
    mockedGetDb.mockReturnValue(buildDb(state) as unknown as ReturnType<typeof getDb>);
    mockedGetPlayers.mockResolvedValue({
      p1: makePlayer({ player_id: "p1", position: "WR" }),
    });

    await syncPlayers();
    expect(mockedGetPlayers).toHaveBeenCalled();
  });

  it("force=true bypasses the staleness check even when fresh", async () => {
    const state: DbState = {
      latestUpdatedAt: new Date(Date.now() - 60 * 1000).toISOString(),
      missingGsisPlayers: [],
      rosterEntries: [],
      inserts: [],
      updates: [],
    };
    mockedGetDb.mockReturnValue(buildDb(state) as unknown as ReturnType<typeof getDb>);
    mockedGetPlayers.mockResolvedValue({
      p1: makePlayer({ player_id: "p1", position: "TE" }),
    });

    await syncPlayers(true);
    expect(mockedGetPlayers).toHaveBeenCalled();
  });
});

describe("syncPlayers position filter + gsis normalization", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("filters out non-fantasy positions before upsert", async () => {
    const state: DbState = {
      latestUpdatedAt: null,
      missingGsisPlayers: [],
      rosterEntries: [],
      inserts: [],
      updates: [],
    };
    mockedGetDb.mockReturnValue(buildDb(state) as unknown as ReturnType<typeof getDb>);
    mockedGetPlayers.mockResolvedValue({
      qb: makePlayer({ player_id: "qb", position: "QB" }),
      lb: makePlayer({ player_id: "lb", position: "LB" }),
      ol: makePlayer({ player_id: "ol", position: "OL" }),
      wr: makePlayer({ player_id: "wr", position: "WR" }),
    });

    const count = await syncPlayers();
    expect(count).toBe(2);
    const inserted = state.inserts.flatMap((i) => i.rows);
    const ids = inserted.map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining(["qb", "wr"]));
    expect(ids).not.toEqual(expect.arrayContaining(["lb", "ol"]));
  });

  it("strips whitespace from gsis_id (Sleeper bug for 2019 cohort)", async () => {
    const state: DbState = {
      latestUpdatedAt: null,
      missingGsisPlayers: [],
      rosterEntries: [],
      inserts: [],
      updates: [],
    };
    mockedGetDb.mockReturnValue(buildDb(state) as unknown as ReturnType<typeof getDb>);
    mockedGetPlayers.mockResolvedValue({
      p1: makePlayer({
        player_id: "p1",
        position: "RB",
        gsis_id: " 00-001234 ", // leading + trailing whitespace
      }),
    });

    await syncPlayers();
    const row = state.inserts[0].rows[0];
    expect(row.gsisId).toBe("00-001234");
  });

  it("falls back to first+last name when full_name is missing", async () => {
    const state: DbState = {
      latestUpdatedAt: null,
      missingGsisPlayers: [],
      rosterEntries: [],
      inserts: [],
      updates: [],
    };
    mockedGetDb.mockReturnValue(buildDb(state) as unknown as ReturnType<typeof getDb>);
    mockedGetPlayers.mockResolvedValue({
      p1: {
        ...makePlayer({ player_id: "p1", position: "RB" }),
        full_name: "",
        first_name: "Joe",
        last_name: "Smith",
      },
    });

    await syncPlayers();
    expect(state.inserts[0].rows[0].name).toBe("Joe Smith");
  });

  it("nulls out gsis_id when sleeper provides only whitespace", async () => {
    const state: DbState = {
      latestUpdatedAt: null,
      missingGsisPlayers: [],
      rosterEntries: [],
      inserts: [],
      updates: [],
    };
    mockedGetDb.mockReturnValue(buildDb(state) as unknown as ReturnType<typeof getDb>);
    mockedGetPlayers.mockResolvedValue({
      p1: makePlayer({ player_id: "p1", position: "QB", gsis_id: "   " }),
    });

    await syncPlayers();
    expect(state.inserts[0].rows[0].gsisId).toBeNull();
  });
});

describe("syncPlayers gsis backfill", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("updates a player with a single name match in the nflverse crosswalk", async () => {
    const state: DbState = {
      latestUpdatedAt: null,
      missingGsisPlayers: [
        { id: "p_no_gsis", name: "Ted Tester", position: "WR" },
      ],
      rosterEntries: [
        { gsisId: "00-005555", name: "Ted Tester", position: "WR" },
      ],
      inserts: [],
      updates: [],
    };
    mockedGetDb.mockReturnValue(buildDb(state) as unknown as ReturnType<typeof getDb>);
    // No new players to upsert (Sleeper returns nothing) — just exercise the
    // backfill stage.
    mockedGetPlayers.mockResolvedValue({});

    await syncPlayers();
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0].set).toEqual({ gsisId: "00-005555" });
  });

  it("disambiguates duplicate name matches by position", async () => {
    const state: DbState = {
      latestUpdatedAt: null,
      missingGsisPlayers: [{ id: "p1", name: "Mike Williams", position: "WR" }],
      rosterEntries: [
        { gsisId: "00-A", name: "Mike Williams", position: "WR" },
        { gsisId: "00-B", name: "Mike Williams", position: "DT" }, // same name
      ],
      inserts: [],
      updates: [],
    };
    mockedGetDb.mockReturnValue(buildDb(state) as unknown as ReturnType<typeof getDb>);
    mockedGetPlayers.mockResolvedValue({});

    await syncPlayers();
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0].set).toEqual({ gsisId: "00-A" });
  });

  it("skips ambiguous matches when position can't disambiguate", async () => {
    const state: DbState = {
      latestUpdatedAt: null,
      missingGsisPlayers: [{ id: "p1", name: "Common Name", position: "RB" }],
      rosterEntries: [
        { gsisId: "00-X", name: "Common Name", position: "RB" },
        { gsisId: "00-Y", name: "Common Name", position: "RB" },
      ],
      inserts: [],
      updates: [],
    };
    mockedGetDb.mockReturnValue(buildDb(state) as unknown as ReturnType<typeof getDb>);
    mockedGetPlayers.mockResolvedValue({});

    await syncPlayers();
    expect(state.updates).toHaveLength(0);
  });

  it("skips players with no name match in the nflverse crosswalk", async () => {
    const state: DbState = {
      latestUpdatedAt: null,
      missingGsisPlayers: [{ id: "p1", name: "Nobody Here", position: "RB" }],
      rosterEntries: [
        { gsisId: "00-X", name: "Different Person", position: "RB" },
      ],
      inserts: [],
      updates: [],
    };
    mockedGetDb.mockReturnValue(buildDb(state) as unknown as ReturnType<typeof getDb>);
    mockedGetPlayers.mockResolvedValue({});

    await syncPlayers();
    expect(state.updates).toHaveLength(0);
  });

  it("returns 0 backfill updates when no players are missing gsis", async () => {
    const state: DbState = {
      latestUpdatedAt: null,
      missingGsisPlayers: [],
      rosterEntries: [
        { gsisId: "00-X", name: "Anyone", position: "QB" },
      ],
      inserts: [],
      updates: [],
    };
    mockedGetDb.mockReturnValue(buildDb(state) as unknown as ReturnType<typeof getDb>);
    mockedGetPlayers.mockResolvedValue({});

    await syncPlayers();
    expect(state.updates).toHaveLength(0);
  });
});
