/**
 * @jest-environment node
 *
 * Verifies that the nflverse games CSV is downloaded at most once per
 * cron run / per request, even when syncSchedule is called multiple
 * times back-to-back (multi-family cron iteration).
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
    },
  ),
}));

import { getDb, getSyncDb } from "@/db";
import {
  syncSchedule,
  __resetScheduleCsvCache,
} from "../scheduleSync";

const mockedGetDb = getDb as jest.MockedFunction<typeof getDb>;
const mockedGetSyncDb = getSyncDb as jest.MockedFunction<typeof getSyncDb>;

const FIXTURE_CSV = [
  "season,game_type,week,home_team,away_team,home_score,away_score,gameday",
  "2024,REG,1,KC,BAL,27,20,2024-09-05",
  "2024,REG,1,GB,PHI,29,34,2024-09-06",
].join("\n");

function makeReadDb() {
  // Pretend the season hasn't been synced yet (count = 0) so the function
  // proceeds into the write path.
  return {
    select: jest.fn(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() => Promise.resolve([{ count: 0 }])),
      })),
    })),
  };
}

type SyncTx = {
  delete: jest.Mock;
  insert: jest.Mock;
};

function makeSyncDb() {
  // Capture the transaction callback execution so we can resolve cleanly.
  const tx: SyncTx = {
    delete: jest.fn(() => ({ where: jest.fn(() => Promise.resolve()) })),
    insert: jest.fn(() => ({
      values: jest.fn(() => ({
        onConflictDoNothing: jest.fn(() => Promise.resolve()),
      })),
    })),
  };
  return {
    transaction: jest.fn(async (cb: (tx: SyncTx) => Promise<void>) => {
      await cb(tx);
    }),
  };
}

describe("syncSchedule — CSV memoization", () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    __resetScheduleCsvCache();

    mockedGetDb.mockReturnValue(makeReadDb() as unknown as ReturnType<
      typeof getDb
    >);
    mockedGetSyncDb.mockReturnValue(makeSyncDb() as unknown as ReturnType<
      typeof getSyncDb
    >);

    fetchSpy = jest.spyOn(global, "fetch").mockImplementation(
      () =>
        Promise.resolve(
          new Response(FIXTURE_CSV, {
            status: 200,
            headers: { "content-type": "text/csv" },
          }),
        ) as unknown as Promise<Response>,
    );
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("downloads the games CSV only once across multiple syncSchedule calls", async () => {
    await syncSchedule({ seasons: [2024] });
    await syncSchedule({ seasons: [2024] });
    await syncSchedule({ seasons: [2024] });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("re-fetches once the cache is reset (simulates a new day / new cron run)", async () => {
    await syncSchedule({ seasons: [2024] });
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    __resetScheduleCsvCache();

    await syncSchedule({ seasons: [2024] });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("evicts cache entry on fetch failure so retries can recover", async () => {
    fetchSpy.mockReset();
    fetchSpy
      .mockResolvedValueOnce(
        new Response("nope", { status: 500 }) as unknown as Response,
      )
      .mockResolvedValueOnce(
        new Response(FIXTURE_CSV, { status: 200 }) as unknown as Response,
      );

    await expect(syncSchedule({ seasons: [2024] })).rejects.toThrow(
      /Failed to fetch schedule data/,
    );

    // Second call should re-fetch (cache was evicted on the failure)
    await syncSchedule({ seasons: [2024] });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("shares a single in-flight fetch across concurrent callers", async () => {
    let resolveFetch: (value: Response) => void = () => {};
    fetchSpy.mockReset();
    fetchSpy.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const a = syncSchedule({ seasons: [2024] });
    const b = syncSchedule({ seasons: [2024] });

    // Both are in-flight; only one fetch should have been issued.
    // Wait a tick to let the syncSchedule bodies start.
    await Promise.resolve();
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    resolveFetch(
      new Response(FIXTURE_CSV, { status: 200 }) as unknown as Response,
    );

    await Promise.all([a, b]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
