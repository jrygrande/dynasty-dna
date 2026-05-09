/**
 * @jest-environment node
 *
 * Unit tests for rosterStatusSync.ts.
 *
 * Coverage targets:
 *   - season < 2002 returns 0 (out of range)
 *   - 404 from nflverse returns 0 instead of throwing
 *   - non-404 fetch errors throw
 *   - rows without gsis_id are dropped
 *   - delete-then-insert + watermark write inside one transaction
 *   - sleeper -> gsis crosswalk backfills players.gsis_id when sleeper_id
 *     is present in the CSV
 *   - getPlayerRosterStatus returns the matching row, or null
 */

jest.mock("@/db", () => {
  const stubColumn = (name: string) => ({ name });
  return {
    schema: {
      nflWeeklyRosterStatus: {
        season: stubColumn("season"),
        week: stubColumn("week"),
        gsisId: stubColumn("gsis_id"),
        status: stubColumn("status"),
        statusAbbr: stubColumn("status_abbr"),
        team: stubColumn("team"),
        position: stubColumn("position"),
        playerName: stubColumn("player_name"),
      },
      nflverseWatermarks: {
        source: stubColumn("source"),
        season: stubColumn("season"),
        lastSyncedWeek: stubColumn("last_synced_week"),
        lastSyncedAt: stubColumn("last_synced_at"),
      },
      players: {
        id: stubColumn("id"),
        gsisId: stubColumn("gsis_id"),
        updatedAt: stubColumn("updated_at"),
      },
    },
    getDb: jest.fn(),
    getSyncDb: jest.fn(),
  };
});

jest.mock("@/services/nflverseWatermark", () => ({
  shouldSkipSeasonSync: jest.fn(),
  setNflverseWatermarkTx: jest.fn(),
}));

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
    }
  ),
}));

import { getDb, getSyncDb } from "@/db";
import {
  shouldSkipSeasonSync,
  setNflverseWatermarkTx,
} from "@/services/nflverseWatermark";
import {
  syncRosterStatus,
  getPlayerRosterStatus,
} from "../rosterStatusSync";

const mockedGetDb = getDb as jest.MockedFunction<typeof getDb>;
const mockedGetSyncDb = getSyncDb as jest.MockedFunction<typeof getSyncDb>;
const mockedShouldSkip = shouldSkipSeasonSync as jest.MockedFunction<
  typeof shouldSkipSeasonSync
>;

interface TxCalls {
  deletes: number;
  insertedBatches: Array<Array<Record<string, unknown>>>;
}

interface TxStub {
  delete: jest.Mock;
  insert: jest.Mock;
}

function buildSyncDb(calls: TxCalls) {
  const tx: TxStub = {
    delete: jest.fn(() => ({
      where: jest.fn(() => {
        calls.deletes++;
        return Promise.resolve();
      }),
    })),
    insert: jest.fn(() => ({
      values: jest.fn((rows: Array<Record<string, unknown>>) => {
        calls.insertedBatches.push(rows);
        return {
          onConflictDoNothing: jest.fn(() => Promise.resolve()),
          onConflictDoUpdate: jest.fn(() => Promise.resolve()),
        };
      }),
    })),
  };
  return {
    transaction: jest.fn(async (cb: (tx: TxStub) => Promise<void>) => {
      await cb(tx);
    }),
  };
}

interface ReadDbState {
  // For hasRosterStatusRows count query
  countRows: number;
  // For the players-table sleeper->gsis crosswalk update
  executeCalls: Array<{ rowCount: number }>;
}

function buildReadDb(state: ReadDbState) {
  return {
    select: jest.fn(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() => Promise.resolve([{ count: state.countRows }])),
      })),
    })),
    execute: jest.fn(() => {
      const next = state.executeCalls.shift() ?? { rowCount: 0 };
      return Promise.resolve(next);
    }),
  };
}

const HEADER = [
  "season",
  "week",
  "gsis_id",
  "sleeper_id",
  "status",
  "status_description_abbr",
  "team",
  "position",
  "full_name",
].join(",");

function row(values: Record<string, string>): string {
  return [
    values.season ?? "2024",
    values.week ?? "1",
    values.gsis_id ?? "00-001",
    values.sleeper_id ?? "",
    values.status ?? "Active",
    values.status_description_abbr ?? "ACT",
    values.team ?? "DAL",
    values.position ?? "RB",
    values.full_name ?? "Joe Tester",
  ].join(",");
}

describe("syncRosterStatus", () => {
  let fetchSpy: jest.SpyInstance;
  const realFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedShouldSkip.mockResolvedValue(false);
    (setNflverseWatermarkTx as jest.MockedFunction<
      typeof setNflverseWatermarkTx
    >).mockResolvedValue();
  });

  afterEach(() => {
    if (fetchSpy) fetchSpy.mockRestore();
    global.fetch = realFetch;
  });

  it("returns 0 for seasons before 2002 (out of range)", async () => {
    fetchSpy = jest
      .spyOn(global, "fetch")
      .mockImplementation(() => {
        throw new Error("should not fetch out-of-range season");
      });
    mockedGetDb.mockReturnValue(
      buildReadDb({ countRows: 0, executeCalls: [] }) as unknown as ReturnType<
        typeof getDb
      >
    );

    const result = await syncRosterStatus({ seasons: [2001] });
    expect(result.seasonResults[2001]).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns 0 (no throw) when nflverse responds 404", async () => {
    fetchSpy = jest
      .spyOn(global, "fetch")
      .mockResolvedValue(new Response("not found", { status: 404 }));
    mockedGetDb.mockReturnValue(
      buildReadDb({ countRows: 0, executeCalls: [] }) as unknown as ReturnType<
        typeof getDb
      >
    );

    const result = await syncRosterStatus({ seasons: [2024] });
    expect(result.seasonResults[2024]).toBe(0);
  });

  it("throws on non-404 fetch errors", async () => {
    fetchSpy = jest
      .spyOn(global, "fetch")
      .mockResolvedValue(new Response("oops", { status: 500 }));
    mockedGetDb.mockReturnValue(
      buildReadDb({ countRows: 0, executeCalls: [] }) as unknown as ReturnType<
        typeof getDb
      >
    );

    await expect(syncRosterStatus({ seasons: [2024] })).rejects.toThrow(
      /Failed to fetch weekly roster data for 2024/
    );
  });

  it("ingests rows + writes watermark inside a single transaction", async () => {
    const csv = [HEADER, row({ week: "1" }), row({ week: "5" })].join("\n");
    fetchSpy = jest
      .spyOn(global, "fetch")
      .mockResolvedValue(new Response(csv, { status: 200 }));

    const calls: TxCalls = { deletes: 0, insertedBatches: [] };
    mockedGetSyncDb.mockReturnValue(
      buildSyncDb(calls) as unknown as ReturnType<typeof getSyncDb>
    );
    mockedGetDb.mockReturnValue(
      buildReadDb({ countRows: 0, executeCalls: [] }) as unknown as ReturnType<
        typeof getDb
      >
    );

    const result = await syncRosterStatus({ seasons: [2024] });
    expect(result.seasonResults[2024]).toBe(2);
    expect(calls.deletes).toBe(1);
    expect(setNflverseWatermarkTx).toHaveBeenCalledWith(
      expect.anything(),
      "roster_status",
      2024,
      5
    );
  });

  it("drops rows without gsis_id", async () => {
    const csv = [
      HEADER,
      row({ gsis_id: "" }),
      row({ gsis_id: "00-OK", week: "2" }),
    ].join("\n");
    fetchSpy = jest
      .spyOn(global, "fetch")
      .mockResolvedValue(new Response(csv, { status: 200 }));

    const calls: TxCalls = { deletes: 0, insertedBatches: [] };
    mockedGetSyncDb.mockReturnValue(
      buildSyncDb(calls) as unknown as ReturnType<typeof getSyncDb>
    );
    mockedGetDb.mockReturnValue(
      buildReadDb({ countRows: 0, executeCalls: [] }) as unknown as ReturnType<
        typeof getDb
      >
    );

    const result = await syncRosterStatus({ seasons: [2024] });
    expect(result.seasonResults[2024]).toBe(1);
    expect(calls.insertedBatches[0]).toHaveLength(1);
    expect(calls.insertedBatches[0][0].gsisId).toBe("00-OK");
  });

  it("backfills players.gsis_id from the sleeper_id crosswalk", async () => {
    const csv = [
      HEADER,
      row({ gsis_id: "00-A", sleeper_id: "sleeper_1" }),
      row({ gsis_id: "00-B", sleeper_id: "sleeper_2", week: "2" }),
    ].join("\n");
    fetchSpy = jest
      .spyOn(global, "fetch")
      .mockResolvedValue(new Response(csv, { status: 200 }));

    const calls: TxCalls = { deletes: 0, insertedBatches: [] };
    mockedGetSyncDb.mockReturnValue(
      buildSyncDb(calls) as unknown as ReturnType<typeof getSyncDb>
    );
    const readState: ReadDbState = {
      countRows: 0,
      executeCalls: [{ rowCount: 1 }, { rowCount: 0 }],
    };
    const readDb = buildReadDb(readState);
    mockedGetDb.mockReturnValue(readDb as unknown as ReturnType<typeof getDb>);

    await syncRosterStatus({ seasons: [2024] });
    // Two crosswalk rows -> two execute calls
    expect(readDb.execute).toHaveBeenCalledTimes(2);
  });

  it("returns 0 (no transaction) when CSV is empty after parsing", async () => {
    fetchSpy = jest
      .spyOn(global, "fetch")
      .mockResolvedValue(new Response(HEADER, { status: 200 }));

    const calls: TxCalls = { deletes: 0, insertedBatches: [] };
    mockedGetSyncDb.mockReturnValue(
      buildSyncDb(calls) as unknown as ReturnType<typeof getSyncDb>
    );
    mockedGetDb.mockReturnValue(
      buildReadDb({ countRows: 0, executeCalls: [] }) as unknown as ReturnType<
        typeof getDb
      >
    );

    const result = await syncRosterStatus({ seasons: [2024] });
    expect(result.seasonResults[2024]).toBe(0);
    expect(calls.deletes).toBe(0);
  });
});

describe("getPlayerRosterStatus", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns matching row's roster status", async () => {
    mockedGetDb.mockReturnValue({
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            limit: jest.fn(() =>
              Promise.resolve([
                { status: "Active", statusAbbr: "ACT", team: "KC" },
              ])
            ),
          })),
        })),
      })),
    } as unknown as ReturnType<typeof getDb>);

    const result = await getPlayerRosterStatus("00-X", 2024, 5);
    expect(result).toEqual({ status: "Active", statusAbbr: "ACT", team: "KC" });
  });

  it("returns null when no row matches", async () => {
    mockedGetDb.mockReturnValue({
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            limit: jest.fn(() => Promise.resolve([])),
          })),
        })),
      })),
    } as unknown as ReturnType<typeof getDb>);

    const result = await getPlayerRosterStatus("00-X", 2024, 5);
    expect(result).toBeNull();
  });
});
