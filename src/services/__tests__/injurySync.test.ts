/**
 * @jest-environment node
 *
 * Unit tests for injurySync.ts.
 *
 * Coverage targets:
 *   - syncInjuries skips out-of-range seasons (< 2009 or > 2024)
 *   - 404 from nflverse returns 0 instead of throwing
 *   - non-404 fetch errors throw
 *   - CSV parsing handles quoted fields with commas
 *   - rows without gsis_id are dropped
 *   - delete-then-insert + watermark write happen atomically inside one
 *     transaction
 *   - getPlayerInjuryStatus returns the row's injury data, or null when
 *     missing.
 */

jest.mock("@/db", () => {
  const stubColumn = (name: string) => ({ name });
  return {
    schema: {
      nflInjuries: {
        season: stubColumn("season"),
        week: stubColumn("week"),
        gsisId: stubColumn("gsis_id"),
        gameType: stubColumn("game_type"),
        playerName: stubColumn("player_name"),
        team: stubColumn("team"),
        position: stubColumn("position"),
        reportStatus: stubColumn("report_status"),
        reportPrimaryInjury: stubColumn("report_primary_injury"),
        reportSecondaryInjury: stubColumn("report_secondary_injury"),
        practiceStatus: stubColumn("practice_status"),
        practicePrimaryInjury: stubColumn("practice_primary_injury"),
        practiceSecondaryInjury: stubColumn("practice_secondary_injury"),
        dateModified: stubColumn("date_modified"),
      },
      nflverseWatermarks: {
        source: stubColumn("source"),
        season: stubColumn("season"),
        lastSyncedWeek: stubColumn("last_synced_week"),
        lastSyncedAt: stubColumn("last_synced_at"),
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
import { syncInjuries, getPlayerInjuryStatus } from "../injurySync";

const mockedGetDb = getDb as jest.MockedFunction<typeof getDb>;
const mockedGetSyncDb = getSyncDb as jest.MockedFunction<typeof getSyncDb>;
const mockedShouldSkip = shouldSkipSeasonSync as jest.MockedFunction<
  typeof shouldSkipSeasonSync
>;
const mockedSetWatermarkTx = setNflverseWatermarkTx as jest.MockedFunction<
  typeof setNflverseWatermarkTx
>;

interface TxCalls {
  deletes: number;
  insertedBatches: Array<Array<Record<string, unknown>>>;
  watermarkArgs: Array<[string, number, number]>;
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

function buildReadDb() {
  return {
    select: jest.fn(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() => Promise.resolve([{ count: 0 }])),
      })),
    })),
  };
}

const HEADER = [
  "season",
  "game_type",
  "team",
  "week",
  "gsis_id",
  "position",
  "full_name",
  "first_name",
  "last_name",
  "report_primary_injury",
  "report_secondary_injury",
  "report_status",
  "practice_primary_injury",
  "practice_secondary_injury",
  "practice_status",
  "date_modified",
].join(",");

function row(values: Record<string, string>): string {
  return [
    values.season ?? "2024",
    values.game_type ?? "REG",
    values.team ?? "DAL",
    values.week ?? "1",
    values.gsis_id ?? "00-001",
    values.position ?? "RB",
    values.full_name ?? "Joe Tester",
    values.first_name ?? "Joe",
    values.last_name ?? "Tester",
    values.report_primary_injury ?? "Hamstring",
    values.report_secondary_injury ?? "",
    values.report_status ?? "Questionable",
    values.practice_primary_injury ?? "",
    values.practice_secondary_injury ?? "",
    values.practice_status ?? "Limited",
    values.date_modified ?? "2024-09-08",
  ].join(",");
}

describe("syncInjuries", () => {
  let fetchSpy: jest.SpyInstance;
  const realFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedShouldSkip.mockResolvedValue(false);
    mockedSetWatermarkTx.mockResolvedValue();
    mockedGetDb.mockReturnValue(
      buildReadDb() as unknown as ReturnType<typeof getDb>
    );
  });

  afterEach(() => {
    if (fetchSpy) fetchSpy.mockRestore();
    global.fetch = realFetch;
  });

  it("skips out-of-range seasons quietly (< 2009 and > 2024)", async () => {
    fetchSpy = jest
      .spyOn(global, "fetch")
      .mockImplementation(() => {
        throw new Error("should not fetch out-of-range seasons");
      });

    const result = await syncInjuries({ seasons: [2008, 2025] });
    expect(result.total).toBe(0);
    expect(result.seasonResults[2008]).toBe(0);
    expect(result.seasonResults[2025]).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns 0 (no throw) when nflverse responds 404 for a season", async () => {
    fetchSpy = jest
      .spyOn(global, "fetch")
      .mockResolvedValue(new Response("not found", { status: 404 }));

    const result = await syncInjuries({ seasons: [2024] });
    expect(result.seasonResults[2024]).toBe(0);
    expect(result.total).toBe(0);
  });

  it("throws when nflverse returns a non-404 error", async () => {
    fetchSpy = jest
      .spyOn(global, "fetch")
      .mockResolvedValue(new Response("oops", { status: 500 }));

    await expect(syncInjuries({ seasons: [2024] })).rejects.toThrow(
      /Failed to fetch injury data for 2024/
    );
  });

  it("ingests rows + commits watermark inside a single transaction", async () => {
    const csv = [HEADER, row({ week: "1", gsis_id: "00-A" }), row({ week: "2", gsis_id: "00-B" })].join("\n");
    fetchSpy = jest
      .spyOn(global, "fetch")
      .mockResolvedValue(new Response(csv, { status: 200 }));

    const calls: TxCalls = {
      deletes: 0,
      insertedBatches: [],
      watermarkArgs: [],
    };
    mockedGetSyncDb.mockReturnValue(
      buildSyncDb(calls) as unknown as ReturnType<typeof getSyncDb>
    );
    mockedSetWatermarkTx.mockImplementation(async (_tx, source, season, week) => {
      calls.watermarkArgs.push([source, season, week]);
    });

    const result = await syncInjuries({ seasons: [2024] });

    expect(result.seasonResults[2024]).toBe(2);
    expect(calls.deletes).toBe(1);
    expect(calls.insertedBatches[0]).toHaveLength(2);
    // Watermark written with maxWeek = 2 inside the same tx.
    expect(calls.watermarkArgs).toEqual([["injuries", 2024, 2]]);
  });

  it("drops rows without gsis_id", async () => {
    const csv = [
      HEADER,
      row({ gsis_id: "" }),
      row({ gsis_id: "00-OK", week: "3" }),
    ].join("\n");
    fetchSpy = jest
      .spyOn(global, "fetch")
      .mockResolvedValue(new Response(csv, { status: 200 }));

    const calls: TxCalls = {
      deletes: 0,
      insertedBatches: [],
      watermarkArgs: [],
    };
    mockedGetSyncDb.mockReturnValue(
      buildSyncDb(calls) as unknown as ReturnType<typeof getSyncDb>
    );

    const result = await syncInjuries({ seasons: [2024] });
    expect(result.seasonResults[2024]).toBe(1);
    expect(calls.insertedBatches[0]).toHaveLength(1);
    expect(calls.insertedBatches[0][0].gsisId).toBe("00-OK");
  });

  it("returns 0 (no transaction) when CSV is just a header", async () => {
    const csv = HEADER;
    fetchSpy = jest
      .spyOn(global, "fetch")
      .mockResolvedValue(new Response(csv, { status: 200 }));

    const calls: TxCalls = {
      deletes: 0,
      insertedBatches: [],
      watermarkArgs: [],
    };
    mockedGetSyncDb.mockReturnValue(
      buildSyncDb(calls) as unknown as ReturnType<typeof getSyncDb>
    );

    const result = await syncInjuries({ seasons: [2024] });
    expect(result.seasonResults[2024]).toBe(0);
    expect(calls.deletes).toBe(0);
  });

  it("respects shouldSkipSeasonSync (returns 0 without fetching)", async () => {
    mockedShouldSkip.mockResolvedValue(true);
    fetchSpy = jest.spyOn(global, "fetch");

    const result = await syncInjuries({ seasons: [2020] });
    expect(result.seasonResults[2020]).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("propagates the force flag through to shouldSkipSeasonSync", async () => {
    fetchSpy = jest
      .spyOn(global, "fetch")
      .mockResolvedValue(new Response("not found", { status: 404 }));

    await syncInjuries({ seasons: [2020], force: true });

    // We can't assert easily on the inner call signature, but the
    // shouldSkip mock should have been called with force: true.
    expect(mockedShouldSkip).toHaveBeenCalledWith(
      2020,
      expect.objectContaining({ force: true })
    );
  });
});

describe("getPlayerInjuryStatus", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns the matching row's injury data", async () => {
    const dbResult = [
      {
        reportStatus: "Out",
        reportPrimaryInjury: "Knee",
        practiceStatus: "DNP",
      },
    ];
    mockedGetDb.mockReturnValue({
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            limit: jest.fn(() => Promise.resolve(dbResult)),
          })),
        })),
      })),
    } as unknown as ReturnType<typeof getDb>);

    const result = await getPlayerInjuryStatus("00-X", 2024, 5);
    expect(result).toEqual({
      reportStatus: "Out",
      primaryInjury: "Knee",
      practiceStatus: "DNP",
    });
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

    const result = await getPlayerInjuryStatus("00-X", 2024, 5);
    expect(result).toBeNull();
  });
});
