/**
 * @jest-environment node
 *
 * Unit tests for the shouldSkipSeasonSync branching logic that fixes #146.
 * The previous implementation skipped any season that had at least one row
 * in the destination table — which silently dropped new weekly data during
 * the in-progress season. The new logic only skips _historical_ seasons.
 */

import { shouldSkipSeasonSync } from "../nflverseWatermark";

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
