/**
 * @jest-environment node
 */

// Mock @sentry/nextjs before importing the module under test so the helper
// picks up our spies.
jest.mock("@sentry/nextjs", () => ({
  addBreadcrumb: jest.fn(),
  captureMessage: jest.fn(),
}));

import * as Sentry from "@sentry/nextjs";
import { recordSyncBreadcrumb } from "../syncBreadcrumb";

const mockedSentry = Sentry as jest.Mocked<typeof Sentry>;

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

describe("recordSyncBreadcrumb", () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    resetDsn();
    consoleSpy = jest.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    restoreDsn();
  });

  it("falls back to console.info when no DSN is configured", () => {
    recordSyncBreadcrumb({
      source: "sleeper",
      trigger: "cron",
      scope: "all-leagues",
      outcome: "success",
      durationMs: 1234,
      apiCalls: 12,
    });

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalledWith(
      "[sync]",
      expect.objectContaining({
        source: "sleeper",
        trigger: "cron",
        scope: "all-leagues",
        outcome: "success",
        durationMs: 1234,
        apiCalls: 12,
      }),
    );
    expect(mockedSentry.addBreadcrumb).not.toHaveBeenCalled();
    expect(mockedSentry.captureMessage).not.toHaveBeenCalled();
  });

  it("calls Sentry.addBreadcrumb when DSN is set", () => {
    process.env.SENTRY_DSN = "https://example@sentry.io/123";

    recordSyncBreadcrumb({
      source: "fantasycalc",
      trigger: "manual",
      scope: "fam-7",
      outcome: "success",
    });

    expect(mockedSentry.addBreadcrumb).toHaveBeenCalledTimes(1);
    const arg = mockedSentry.addBreadcrumb.mock.calls[0][0];
    expect(arg).toMatchObject({
      category: "sync",
      level: "info",
      message: "sync.fantasycalc.success",
      data: expect.objectContaining({
        source: "fantasycalc",
        trigger: "manual",
        scope: "fam-7",
        outcome: "success",
      }),
    });
    expect(mockedSentry.captureMessage).not.toHaveBeenCalled();
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it("captures a message when outcome is failed", () => {
    process.env.SENTRY_DSN = "https://example@sentry.io/123";

    recordSyncBreadcrumb({
      source: "sleeper",
      trigger: "cron",
      scope: "fam-99",
      outcome: "failed",
      error: "ECONNRESET",
    });

    expect(mockedSentry.addBreadcrumb).toHaveBeenCalledTimes(1);
    const breadcrumb = mockedSentry.addBreadcrumb.mock.calls[0][0];
    expect(breadcrumb).toMatchObject({
      level: "error",
      type: "error",
    });

    expect(mockedSentry.captureMessage).toHaveBeenCalledTimes(1);
    const [message, options] = mockedSentry.captureMessage.mock.calls[0];
    expect(message).toContain("sleeper");
    expect(message).toContain("fam-99");
    expect(options).toMatchObject({
      level: "error",
      extra: expect.objectContaining({ error: "ECONNRESET" }),
    });
  });

  it("uses warning level for partial outcome", () => {
    process.env.SENTRY_DSN = "https://example@sentry.io/123";

    recordSyncBreadcrumb({
      source: "nflverse",
      trigger: "lazy",
      scope: "week-3",
      outcome: "partial",
    });

    expect(mockedSentry.addBreadcrumb).toHaveBeenCalledTimes(1);
    expect(mockedSentry.addBreadcrumb.mock.calls[0][0]).toMatchObject({
      level: "warning",
    });
    expect(mockedSentry.captureMessage).not.toHaveBeenCalled();
  });

  it("does not throw if Sentry throws internally", () => {
    process.env.SENTRY_DSN = "https://example@sentry.io/123";
    mockedSentry.addBreadcrumb.mockImplementationOnce(() => {
      throw new Error("sentry boom");
    });

    expect(() =>
      recordSyncBreadcrumb({
        source: "sleeper",
        trigger: "cron",
        scope: "fam-1",
        outcome: "success",
      }),
    ).not.toThrow();
  });
});
