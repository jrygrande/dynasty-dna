/**
 * @jest-environment node
 *
 * Verifies the Sleeper rate-limit utilization gauge:
 *   - records each call into the rolling 60s window
 *   - prunes timestamps older than 60s
 *   - emits the gauge to the console when no DSN configured
 *   - emits the gauge to Sentry.metrics when a DSN is set
 *   - falls back to addBreadcrumb when Sentry.metrics is unavailable
 *   - flushes once per 60s interval (not on every call)
 */

jest.mock("@sentry/nextjs", () => ({
  metrics: {
    gauge: jest.fn(),
  },
  addBreadcrumb: jest.fn(),
  captureMessage: jest.fn(),
}));

import * as Sentry from "@sentry/nextjs";
import {
  recordSleeperCall,
  flushSleeperRateGauge,
  getCurrentCallsPerMinute,
  getCurrentUtilizationPct,
  getTotalSleeperCalls,
  __resetSleeperRateState,
  __getLastFlushAt,
  SLEEPER_LIMIT_PER_MINUTE,
} from "../rateLimit";

const mockedSentry = Sentry as unknown as {
  metrics: { gauge: jest.Mock };
  addBreadcrumb: jest.Mock;
  captureMessage: jest.Mock;
};

const ORIGINAL_DSN = process.env.SENTRY_DSN;
const ORIGINAL_PUBLIC_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

function resetDsn() {
  delete process.env.SENTRY_DSN;
  delete process.env.NEXT_PUBLIC_SENTRY_DSN;
}

function restoreDsn() {
  if (ORIGINAL_DSN === undefined) delete process.env.SENTRY_DSN;
  else process.env.SENTRY_DSN = ORIGINAL_DSN;
  if (ORIGINAL_PUBLIC_DSN === undefined)
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
  else process.env.NEXT_PUBLIC_SENTRY_DSN = ORIGINAL_PUBLIC_DSN;
}

describe("Sleeper rate-limit gauge", () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    __resetSleeperRateState();
    resetDsn();
    consoleSpy = jest.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    restoreDsn();
  });

  it("records calls into the rolling window", () => {
    const t0 = 1_700_000_000_000;
    recordSleeperCall(t0);
    recordSleeperCall(t0 + 100);
    recordSleeperCall(t0 + 200);
    expect(getCurrentCallsPerMinute(t0 + 300)).toBe(3);
  });

  it("prunes timestamps older than 60s", () => {
    const t0 = 1_700_000_000_000;
    recordSleeperCall(t0);
    recordSleeperCall(t0 + 1000);
    // Advance past the rolling window — earlier calls should be evicted.
    expect(getCurrentCallsPerMinute(t0 + 60_000 + 1)).toBe(1);
    expect(getCurrentCallsPerMinute(t0 + 120_000)).toBe(0);
  });

  it("computes utilization as percent of the 1000 RPM limit", () => {
    const t0 = 1_700_000_000_000;
    for (let i = 0; i < 100; i++) recordSleeperCall(t0 + i);
    // 100 calls in window -> 10% of 1000 RPM
    expect(getCurrentUtilizationPct(t0 + 200)).toBe(10);
    expect(SLEEPER_LIMIT_PER_MINUTE).toBe(1000);
  });

  it("caps utilization at 100% when calls exceed the documented limit", () => {
    const t0 = 1_700_000_000_000;
    for (let i = 0; i < 1500; i++) recordSleeperCall(t0 + i);
    expect(getCurrentUtilizationPct(t0 + 2000)).toBe(100);
  });

  it("emits to console.info when no DSN is configured", () => {
    const t0 = 1_700_000_000_000;
    for (let i = 0; i < 5; i++) recordSleeperCall(t0 + i);
    flushSleeperRateGauge(t0 + 100);

    expect(consoleSpy).toHaveBeenCalledWith(
      "[sleeper.rate]",
      expect.objectContaining({
        callsPerMinute: 5,
        utilizationPct: 1, // 5 / 1000 = 0.5%, rounded -> 1 (Math.round behavior on .5)
        limit: 1000,
      }),
    );
    expect(mockedSentry.metrics.gauge).not.toHaveBeenCalled();
  });

  it("emits to Sentry.metrics.gauge when DSN is set", () => {
    process.env.SENTRY_DSN = "https://example@sentry.io/123";

    const t0 = 1_700_000_000_000;
    for (let i = 0; i < 50; i++) recordSleeperCall(t0 + i);
    flushSleeperRateGauge(t0 + 100);

    expect(mockedSentry.metrics.gauge).toHaveBeenCalledWith(
      "sleeper.rate_utilization_pct",
      5, // 50 calls / 1000 RPM = 5%
      expect.objectContaining({ unit: "percent" }),
    );
    expect(mockedSentry.metrics.gauge).toHaveBeenCalledWith(
      "sleeper.calls_per_minute",
      50,
      expect.any(Object),
    );
  });

  it("only flushes once per 60s window from recordCall", () => {
    process.env.SENTRY_DSN = "https://example@sentry.io/123";

    const t0 = 1_700_000_000_000;
    // First call triggers a flush (lastFlushAt was 0).
    recordSleeperCall(t0);
    expect(mockedSentry.metrics.gauge).toHaveBeenCalled();

    mockedSentry.metrics.gauge.mockClear();

    // 30 seconds later — still inside the flush window, no new flush.
    recordSleeperCall(t0 + 30_000);
    expect(mockedSentry.metrics.gauge).not.toHaveBeenCalled();

    // 61 seconds in — past the window, flush again.
    recordSleeperCall(t0 + 61_000);
    expect(mockedSentry.metrics.gauge).toHaveBeenCalled();
  });

  it("updates lastFlushAt on every flush", () => {
    process.env.SENTRY_DSN = "https://example@sentry.io/123";

    const t0 = 1_700_000_000_000;
    flushSleeperRateGauge(t0);
    expect(__getLastFlushAt()).toBe(t0);

    flushSleeperRateGauge(t0 + 100_000);
    expect(__getLastFlushAt()).toBe(t0 + 100_000);
  });

  it("never throws if Sentry.metrics.gauge throws", () => {
    process.env.SENTRY_DSN = "https://example@sentry.io/123";
    mockedSentry.metrics.gauge.mockImplementationOnce(() => {
      throw new Error("metrics boom");
    });

    expect(() => {
      recordSleeperCall(1_700_000_000_000);
    }).not.toThrow();
  });

  it("getTotalSleeperCalls is monotonic across the rolling-window prune", () => {
    const t0 = 1_700_000_000_000;
    expect(getTotalSleeperCalls()).toBe(0);
    recordSleeperCall(t0);
    recordSleeperCall(t0 + 1000);
    expect(getTotalSleeperCalls()).toBe(2);
    // Advance well past the rolling window — pruning the window must not
    // touch the lifetime counter (the counter is what attribution snapshots).
    recordSleeperCall(t0 + 120_000);
    expect(getCurrentCallsPerMinute(t0 + 120_000)).toBe(1);
    expect(getTotalSleeperCalls()).toBe(3);
  });
});
