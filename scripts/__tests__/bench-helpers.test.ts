/**
 * @jest-environment node
 *
 * Pure-logic tests for the benchmark's best-of-N picker and baseline
 * comparator. No env, no DB.
 */

import { pickBest, checkAgainstBaseline } from "../bench-helpers";

describe("pickBest", () => {
  it("returns the run with the lowest wall time", () => {
    const runs = [
      { wallTimeMs: 1200, apiCalls: 216 },
      { wallTimeMs: 800, apiCalls: 216 },
      { wallTimeMs: 1100, apiCalls: 216 },
    ];
    expect(pickBest(runs)).toEqual({ wallTimeMs: 800, apiCalls: 216 });
  });

  it("is stable on ties — returns first occurrence", () => {
    const runs = [
      { wallTimeMs: 500, apiCalls: 1 },
      { wallTimeMs: 500, apiCalls: 2 },
      { wallTimeMs: 500, apiCalls: 3 },
    ];
    expect(pickBest(runs).apiCalls).toBe(1);
  });

  it("throws on empty input", () => {
    expect(() => pickBest([])).toThrow();
  });
});

describe("checkAgainstBaseline", () => {
  const baseline = { wall_time_ms: 1000, api_calls: 216 };

  it("passes when wall time is within 20% tolerance and api_calls match", () => {
    const r = checkAgainstBaseline({ wallTimeMs: 1100, apiCalls: 216 }, baseline);
    expect(r.wallOk).toBe(true);
    expect(r.apiOk).toBe(true);
  });

  it("passes exactly at the 20% boundary", () => {
    const r = checkAgainstBaseline({ wallTimeMs: 1200, apiCalls: 216 }, baseline);
    expect(r.wallOk).toBe(true);
  });

  it("fails when wall time exceeds the tolerance", () => {
    const r = checkAgainstBaseline({ wallTimeMs: 1201, apiCalls: 216 }, baseline);
    expect(r.wallOk).toBe(false);
    expect(r.toleranceMs).toBe(1200);
  });

  it("fails when api_calls differ — even by 1", () => {
    const r = checkAgainstBaseline({ wallTimeMs: 900, apiCalls: 215 }, baseline);
    expect(r.apiOk).toBe(false);
    expect(r.wallOk).toBe(true);
  });

  it("respects custom tolerance", () => {
    const r = checkAgainstBaseline(
      { wallTimeMs: 1500, apiCalls: 216 },
      baseline,
      { tolerance: 1.5 },
    );
    expect(r.wallOk).toBe(true);
    expect(r.toleranceMs).toBe(1500);
  });

  it("auto-passes wall when both actual and baseline are under the floor", () => {
    const r = checkAgainstBaseline(
      { wallTimeMs: 4, apiCalls: 1 },
      { wall_time_ms: 1, api_calls: 1 },
      { floorMs: 5 },
    );
    // Without floor: 4 > 1*1.2=1.2 -> would fail. With floor: passes.
    expect(r.wallOk).toBe(true);
    expect(r.withinFloor).toBe(true);
  });

  it("does NOT apply the floor when only one side is under it", () => {
    // Actual is over the floor; tolerance still applies.
    const r = checkAgainstBaseline(
      { wallTimeMs: 100, apiCalls: 1 },
      { wall_time_ms: 1, api_calls: 1 },
      { floorMs: 5 },
    );
    expect(r.withinFloor).toBe(false);
    expect(r.wallOk).toBe(false);
  });
});
