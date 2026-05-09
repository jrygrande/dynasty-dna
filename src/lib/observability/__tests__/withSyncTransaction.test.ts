/**
 * @jest-environment node
 */

jest.mock("@sentry/nextjs", () => ({
  startSpan: jest.fn((_opts: unknown, fn: () => unknown) => fn()),
}));

import * as Sentry from "@sentry/nextjs";
import { withSyncTransaction } from "../withSyncTransaction";

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

describe("withSyncTransaction", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetDsn();
  });

  afterEach(() => {
    restoreDsn();
  });

  it("passes through the return value when no DSN is configured (sync)", () => {
    const result = withSyncTransaction("sync.sleeper", "sync", () => 42);
    expect(result).toBe(42);
    expect(mockedSentry.startSpan).not.toHaveBeenCalled();
  });

  it("passes through the resolved value when no DSN is configured (async)", async () => {
    const result = await withSyncTransaction("sync.sleeper", "sync", async () => "done");
    expect(result).toBe("done");
    expect(mockedSentry.startSpan).not.toHaveBeenCalled();
  });

  it("rethrows from fn when no DSN is configured", () => {
    expect(() =>
      withSyncTransaction("sync.sleeper", "sync", () => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
  });

  it("wraps the call in Sentry.startSpan when DSN is set and returns the value", () => {
    process.env.SENTRY_DSN = "https://example@sentry.io/123";

    const result = withSyncTransaction(
      "sync.fantasycalc",
      "sync",
      () => "ok",
    );

    expect(result).toBe("ok");
    expect(mockedSentry.startSpan).toHaveBeenCalledTimes(1);
    expect(mockedSentry.startSpan.mock.calls[0][0]).toMatchObject({
      name: "sync.fantasycalc",
      op: "sync",
    });
  });

  it("wraps async fn in Sentry.startSpan and returns the resolved value", async () => {
    process.env.SENTRY_DSN = "https://example@sentry.io/123";

    const result = await withSyncTransaction(
      "sync.nflverse",
      "sync",
      async () => 99,
    );

    expect(result).toBe(99);
    expect(mockedSentry.startSpan).toHaveBeenCalledTimes(1);
  });
});
