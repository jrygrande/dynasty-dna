/**
 * @jest-environment node
 *
 * Unit tests for the shouldSkipSeasonSync branching logic that fixes #146.
 * The previous implementation skipped any season that had at least one row
 * in the destination table — which silently dropped new weekly data during
 * the in-progress season. The new logic only skips _historical_ seasons.
 */

import {
  currentSeason,
  setNflverseWatermarkTx,
  shouldSkipSeasonSync,
} from "../nflverseWatermark";

const CURRENT = 2026;

function makeHasRows(populated: Set<number>) {
  return jest.fn(async (season: number) => populated.has(season));
}

describe("shouldSkipSeasonSync", () => {
  it("skips a historical season that already has rows", async () => {
    const hasRows = makeHasRows(new Set([2023]));
    const skip = await shouldSkipSeasonSync(2023, {
      now: CURRENT,
      hasRows,
    });
    expect(skip).toBe(true);
    expect(hasRows).toHaveBeenCalledWith(2023);
  });

  it("does not skip a historical season with no rows yet", async () => {
    const hasRows = makeHasRows(new Set());
    const skip = await shouldSkipSeasonSync(2023, {
      now: CURRENT,
      hasRows,
    });
    expect(skip).toBe(false);
  });

  it("never skips the current season even if rows exist", async () => {
    // This is the bug fix. Pre-fix, this returned true and silently dropped
    // every subsequent week of in-progress data.
    const hasRows = makeHasRows(new Set([CURRENT]));
    const skip = await shouldSkipSeasonSync(CURRENT, {
      now: CURRENT,
      hasRows,
    });
    expect(skip).toBe(false);
  });

  it("never skips a future season even if rows exist", async () => {
    // Defensive: if the clock somehow drifts or a season is queued early,
    // err on the side of fetching.
    const hasRows = makeHasRows(new Set([CURRENT + 1]));
    const skip = await shouldSkipSeasonSync(CURRENT + 1, {
      now: CURRENT,
      hasRows,
    });
    expect(skip).toBe(false);
  });

  it("never skips when force is true, regardless of season age", async () => {
    const hasRows = makeHasRows(new Set([2010]));
    const skip = await shouldSkipSeasonSync(2010, {
      force: true,
      now: CURRENT,
      hasRows,
    });
    expect(skip).toBe(false);
    // Existence check should be short-circuited — no need to query.
    expect(hasRows).not.toHaveBeenCalled();
  });

  it("does not call hasRows for the current season (avoids wasted query)", async () => {
    const hasRows = makeHasRows(new Set([CURRENT]));
    await shouldSkipSeasonSync(CURRENT, { now: CURRENT, hasRows });
    expect(hasRows).not.toHaveBeenCalled();
  });

  it("handles boundary: prior season with rows is historical and skipped", async () => {
    const hasRows = makeHasRows(new Set([CURRENT - 1]));
    const skip = await shouldSkipSeasonSync(CURRENT - 1, {
      now: CURRENT,
      hasRows,
    });
    expect(skip).toBe(true);
  });
});

describe("currentSeason", () => {
  // The NFL season N runs Sept of year N to early Feb of year N+1, so we
  // treat months Aug-Dec as season=year and Jan-July as season=year-1.
  // Pre-fix, `new Date().getFullYear()` returned year-roll on Jan 1 — which
  // would prematurely flip the in-progress 2025 season to "historical" on
  // Jan 1, 2026 and short-circuit playoff-week injury/roster fetches.
  //
  // Note: we construct dates with local-time fields (year, month, day)
  // because `currentSeason()` reads `getMonth()` / `getFullYear()` in the
  // local TZ. ISO-Z strings would shift to the runner's TZ and flip months
  // at boundaries.

  // Helper: noon local time on Y-M-D (M is 1-12 here for readability).
  const local = (y: number, m: number, d: number) =>
    new Date(y, m - 1, d, 12, 0, 0);

  it("treats August 1 as the start of the new season", () => {
    expect(currentSeason(local(2025, 8, 1))).toBe(2025);
  });

  it("treats December 31 as still inside the current season", () => {
    expect(currentSeason(local(2025, 12, 31))).toBe(2025);
  });

  it("does NOT roll the season forward on January 1", () => {
    // The Jan 1, 2026 case is the bug: pre-fix, the 2025 season would be
    // labeled 2026 — making it >= currentSeason and forcing skip-if-rows.
    expect(currentSeason(local(2026, 1, 1))).toBe(2025);
  });

  it("keeps mid-February inside the prior season (Super Bowl week)", () => {
    expect(currentSeason(local(2026, 2, 15))).toBe(2025);
  });

  it("treats the end of July as still the prior season", () => {
    // July 31 is the last day before training camps / preseason; the
    // upcoming season hasn't started.
    expect(currentSeason(local(2026, 7, 31))).toBe(2025);
  });
});

describe("setNflverseWatermarkTx (transaction-scoped writes)", () => {
  // The previous code wrote the watermark via getDb() AFTER the data
  // transaction committed. That left two failure modes:
  //   1. Data transaction rolls back, but the watermark write was never
  //      reached — fine, but only because the post-commit ordering was
  //      load-bearing.
  //   2. Data transaction commits, then the watermark write fails — the
  //      next run re-does the work because no watermark was stamped.
  // Worse, if the order were ever flipped, a rolled-back data write could
  // leave a stamped watermark that skips the season forever. Moving the
  // watermark write inside the same transaction makes both writes atomic.

  it("writes the watermark via the supplied tx (not getDb())", async () => {
    const inserted: Array<Record<string, unknown>> = [];
    const fakeTx = {
      insert: jest.fn().mockReturnValue({
        values: jest.fn().mockImplementation((v) => {
          inserted.push(v);
          return {
            onConflictDoUpdate: jest.fn().mockResolvedValue(undefined),
          };
        }),
      }),
    };

    // Cast through unknown — we deliberately don't depend on drizzle's
    // PgTransaction generic surface; we only care that the tx's insert()
    // path is the one used.
    await setNflverseWatermarkTx(
      fakeTx as unknown as Parameters<typeof setNflverseWatermarkTx>[0],
      "injuries",
      2025,
      14
    );

    expect(fakeTx.insert).toHaveBeenCalledTimes(1);
    expect(inserted).toEqual([
      { source: "injuries", season: 2025, lastSyncedWeek: 14 },
    ]);
  });

  it("propagates errors so the surrounding transaction rolls back", async () => {
    // Verifies the rollback path: if the watermark insert throws, the
    // caller's `await syncDb.transaction(async (tx) => { ... })` rejects
    // and drizzle issues ROLLBACK — meaning a failed watermark write
    // takes the data write down with it. Pre-fix this couldn't happen:
    // the watermark was written on a separate connection after commit.
    const boom = new Error("constraint violation");
    const fakeTx = {
      insert: jest.fn().mockReturnValue({
        values: jest.fn().mockReturnValue({
          onConflictDoUpdate: jest.fn().mockRejectedValue(boom),
        }),
      }),
    };

    await expect(
      setNflverseWatermarkTx(
        fakeTx as unknown as Parameters<typeof setNflverseWatermarkTx>[0],
        "schedule",
        2025,
        18
      )
    ).rejects.toBe(boom);
  });

  it("a failed watermark write rejects the surrounding transaction callback", async () => {
    // End-to-end shape: data inserts succeed, watermark insert throws,
    // the surrounding `db.transaction(async tx => ...)` callback rejects
    // — drizzle issues ROLLBACK on rejection, so neither write persists.
    // Rejection IS rollback at the drizzle layer; we just need to verify
    // the rejection propagates out of the callback.
    let dataWritten = false;
    let watermarkAttempted = false;

    const fakeTx = {
      insert: jest.fn().mockImplementation(() => ({
        values: () => ({
          onConflictDoNothing: jest.fn().mockImplementation(() => {
            dataWritten = true;
            return Promise.resolve(undefined);
          }),
          onConflictDoUpdate: jest.fn().mockImplementation(() => {
            watermarkAttempted = true;
            return Promise.reject(new Error("watermark conflict"));
          }),
        }),
      })),
    };

    const fakeDb = {
      transaction: async (
        cb: (tx: typeof fakeTx) => Promise<unknown>
      ): Promise<unknown> => cb(fakeTx),
    };

    const run = async () => {
      await fakeDb.transaction(async (tx) => {
        // Simulated data insert (succeeds in our mock).
        await tx.insert({}).values().onConflictDoNothing();
        // Watermark insert (rejects).
        await setNflverseWatermarkTx(
          tx as unknown as Parameters<typeof setNflverseWatermarkTx>[0],
          "roster_status",
          2025,
          14
        );
      });
    };

    await expect(run()).rejects.toThrow("watermark conflict");
    expect(dataWritten).toBe(true);
    expect(watermarkAttempted).toBe(true);
  });
});
