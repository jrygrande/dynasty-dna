/**
 * @jest-environment node
 *
 * Coverage fill-ins for nflverseWatermark.ts:
 *   - setNflverseWatermark (non-transaction form, lines ~100-116)
 *   - getNflverseWatermark (lines ~120-140)
 *
 * The transaction-scoped writes + shouldSkipSeasonSync branching are covered
 * by `nflverseWatermark.test.ts`; this file just exercises the two helpers
 * the main test doesn't touch.
 */

jest.mock("@/db", () => {
  const stubColumn = (name: string) => ({ name });
  return {
    schema: {
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
}));

import { getDb } from "@/db";
import {
  setNflverseWatermark,
  getNflverseWatermark,
} from "../nflverseWatermark";

const mockedGetDb = getDb as jest.MockedFunction<typeof getDb>;

describe("setNflverseWatermark (non-transaction form)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("upserts via getDb() when no transaction handle is supplied", async () => {
    const inserted: Array<Record<string, unknown>> = [];
    const fakeDb = {
      insert: jest.fn().mockImplementation(() => ({
        values: jest.fn((v: Record<string, unknown>) => {
          inserted.push(v);
          return {
            onConflictDoUpdate: jest.fn(() => Promise.resolve()),
          };
        }),
      })),
    };
    mockedGetDb.mockReturnValue(fakeDb as unknown as ReturnType<typeof getDb>);

    await setNflverseWatermark("schedule", 2024, 18);

    expect(fakeDb.insert).toHaveBeenCalledTimes(1);
    expect(inserted).toEqual([
      { source: "schedule", season: 2024, lastSyncedWeek: 18 },
    ]);
  });
});

describe("getNflverseWatermark", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns the lastSyncedWeek when a row exists", async () => {
    const fakeDb = {
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            limit: jest.fn(() => Promise.resolve([{ lastSyncedWeek: 12 }])),
          })),
        })),
      })),
    };
    mockedGetDb.mockReturnValue(fakeDb as unknown as ReturnType<typeof getDb>);

    const week = await getNflverseWatermark("injuries", 2023);
    expect(week).toBe(12);
  });

  it("returns 0 when no watermark row exists yet", async () => {
    const fakeDb = {
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            limit: jest.fn(() => Promise.resolve([])),
          })),
        })),
      })),
    };
    mockedGetDb.mockReturnValue(fakeDb as unknown as ReturnType<typeof getDb>);

    const week = await getNflverseWatermark("roster_status", 2024);
    expect(week).toBe(0);
  });
});
