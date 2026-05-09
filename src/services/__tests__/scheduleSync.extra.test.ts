/**
 * @jest-environment node
 *
 * Coverage fill-ins for scheduleSync.ts:
 *   - getTeamByeWeeks: difference of "all schedule weeks" and "weeks the
 *     team played" — exercises the empty schedule short-circuit too.
 *   - early return when the CSV is empty.
 *   - early return when no REG rows match a season.
 */

jest.mock("@/db", () => {
  const stubColumn = (name: string) => ({ name });
  return {
    schema: {
      nflSchedule: {
        season: stubColumn("season"),
        week: stubColumn("week"),
        homeTeam: stubColumn("home_team"),
        awayTeam: stubColumn("away_team"),
        homeScore: stubColumn("home_score"),
        awayScore: stubColumn("away_score"),
        gameDate: stubColumn("game_date"),
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
  getTeamByeWeeks,
  syncSchedule,
  __resetScheduleCsvCache,
  __setScheduleCsvNow,
} from "../scheduleSync";

const mockedGetDb = getDb as jest.MockedFunction<typeof getDb>;
const mockedGetSyncDb = getSyncDb as jest.MockedFunction<typeof getSyncDb>;

describe("getTeamByeWeeks", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns the set of weeks the team did not play", async () => {
    let selectCallIdx = 0;
    const fakeDb = {
      select: jest.fn(() => {
        const idx = selectCallIdx++;
        return {
          from: jest.fn(() => ({
            where: jest.fn(() => {
              if (idx === 0) {
                // All weeks in the league schedule
                return Promise.resolve(
                  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map((w) => ({
                    week: w,
                  }))
                );
              }
              // Weeks the team played (missing 9 — bye week)
              return Promise.resolve(
                [1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14].map((w) => ({
                  week: w,
                }))
              );
            }),
          })),
        };
      }),
    };
    mockedGetDb.mockReturnValue(fakeDb as unknown as ReturnType<typeof getDb>);

    const byes = await getTeamByeWeeks(2024, "DAL");
    expect(byes).toEqual(new Set([9]));
  });

  it("returns an empty set when the schedule has no rows", async () => {
    const fakeDb = {
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => Promise.resolve([])),
        })),
      })),
    };
    mockedGetDb.mockReturnValue(fakeDb as unknown as ReturnType<typeof getDb>);

    const byes = await getTeamByeWeeks(2024, "DAL");
    expect(byes.size).toBe(0);
  });
});

describe("syncSchedule — early-exit branches", () => {
  let fetchSpy: jest.SpyInstance;
  const realFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    __resetScheduleCsvCache();
    __setScheduleCsvNow(null);
  });

  afterEach(() => {
    if (fetchSpy) fetchSpy.mockRestore();
    global.fetch = realFetch;
    __resetScheduleCsvCache();
  });

  it("returns empty results when the CSV is just a header line", async () => {
    fetchSpy = jest
      .spyOn(global, "fetch")
      .mockResolvedValue(new Response("season,game_type,week", { status: 200 }));

    mockedGetDb.mockReturnValue({
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => Promise.resolve([{ count: 0 }])),
        })),
      })),
    } as unknown as ReturnType<typeof getDb>);

    mockedGetSyncDb.mockReturnValue({
      transaction: jest.fn(),
    } as unknown as ReturnType<typeof getSyncDb>);

    const result = await syncSchedule({ seasons: [2024] });
    expect(result.total).toBe(0);
    expect(result.seasonResults).toEqual({});
  });

  it("returns 0 for a season with no REG rows (early return inside the loop)", async () => {
    // Header + one PRE row — filtered out, no REG rows match.
    const csv = [
      "season,game_type,week,home_team,away_team,home_score,away_score,gameday",
      "2024,PRE,1,KC,BAL,30,20,2024-08-15",
    ].join("\n");
    fetchSpy = jest
      .spyOn(global, "fetch")
      .mockResolvedValue(new Response(csv, { status: 200 }));

    mockedGetDb.mockReturnValue({
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => Promise.resolve([{ count: 0 }])),
        })),
      })),
    } as unknown as ReturnType<typeof getDb>);

    const tx = {
      delete: jest.fn(() => ({ where: jest.fn(() => Promise.resolve()) })),
      insert: jest.fn(() => ({
        values: jest.fn(() => ({
          onConflictDoNothing: jest.fn(() => Promise.resolve()),
          onConflictDoUpdate: jest.fn(() => Promise.resolve()),
        })),
      })),
    };
    mockedGetSyncDb.mockReturnValue({
      transaction: jest.fn(async (cb: (t: typeof tx) => Promise<void>) => {
        await cb(tx);
      }),
    } as unknown as ReturnType<typeof getSyncDb>);

    const result = await syncSchedule({ seasons: [2024] });
    expect(result.seasonResults[2024]).toBe(0);
    // Transaction should NOT have run for the empty REG case (early return).
    expect(tx.delete).not.toHaveBeenCalled();
  });
});
