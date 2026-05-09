/**
 * Pure helpers for the sync benchmark — no env, no DB, no I/O. Lives in its
 * own module so unit tests can import it without triggering benchmark-sync.ts's
 * side-effecting dotenv loaders.
 */

export interface RunSummary {
  wallTimeMs: number;
  apiCalls: number;
}

/**
 * Best-of-N selection: returns the run with the lowest wall time. Stable on
 * ties (returns the first occurrence). Throws if `runs` is empty.
 */
export function pickBest<R extends RunSummary>(runs: R[]): R {
  if (runs.length === 0) throw new Error("pickBest: no runs");
  return runs.reduce((a, b) => (b.wallTimeMs < a.wallTimeMs ? b : a));
}

export interface CheckResult {
  apiOk: boolean;
  wallOk: boolean;
  apiCalls: number;
  baselineApiCalls: number;
  wallTimeMs: number;
  baselineWallMs: number;
  toleranceMs: number;
  /** When wall_time falls under `floorMs`, treat the wall comparison as a pass
   *  regardless of percent — small absolute diffs are dominated by noise. */
  withinFloor: boolean;
}

export interface CheckOpts {
  /** Wall-time tolerance multiplier; CI fails when actual > baseline * tolerance.
   *  Default 1.20 (20% slowdown allowed). */
  tolerance?: number;
  /** Wall-time floor (ms). When BOTH actual and baseline are below this, the
   *  wall check auto-passes. Default 5ms. */
  floorMs?: number;
}

/**
 * Compare a benchmark run against the baseline. Pure function so we can
 * unit-test the tolerance + floor logic without spinning up Sleeper or the DB.
 */
export function checkAgainstBaseline(
  best: RunSummary,
  baseline: { wall_time_ms: number; api_calls: number },
  opts: CheckOpts = {},
): CheckResult {
  const tolerance = opts.tolerance ?? 1.2;
  const floorMs = opts.floorMs ?? 5;
  const toleranceMs = baseline.wall_time_ms * tolerance;

  const withinFloor =
    best.wallTimeMs < floorMs && baseline.wall_time_ms < floorMs;
  const wallOk = withinFloor || best.wallTimeMs <= toleranceMs;
  const apiOk = best.apiCalls === baseline.api_calls;

  return {
    apiOk,
    wallOk,
    apiCalls: best.apiCalls,
    baselineApiCalls: baseline.api_calls,
    wallTimeMs: best.wallTimeMs,
    baselineWallMs: baseline.wall_time_ms,
    toleranceMs,
    withinFloor,
  };
}
