/**
 * @jest-environment node
 *
 * Auth + first-Sunday-of-month gate for /api/cron/nflverse-historical.
 *
 * The route is registered as `0 9 * * 0` (every Sunday) on Vercel because
 * the Hobby plan caps at daily granularity; the route gates internally so
 * real work runs only on the first Sunday of each month.
 */

const syncInjuriesMock = jest.fn();
const syncRosterStatusMock = jest.fn();
const syncScheduleMock = jest.fn();
const recordSyncBreadcrumbMock = jest.fn();

jest.mock("@/services/injurySync", () => ({
  syncInjuries: (...args: unknown[]) => syncInjuriesMock(...args),
}));
jest.mock("@/services/rosterStatusSync", () => ({
  syncRosterStatus: (...args: unknown[]) => syncRosterStatusMock(...args),
}));
jest.mock("@/services/scheduleSync", () => ({
  syncSchedule: (...args: unknown[]) => syncScheduleMock(...args),
}));
jest.mock("@/services/nflverseWatermark", () => ({
  currentSeason: () => 2025,
}));
jest.mock("@/lib/observability/syncBreadcrumb", () => ({
  recordSyncBreadcrumb: (...args: unknown[]) => recordSyncBreadcrumbMock(...args),
}));

import { GET } from "../route";
import { isFirstSundayOfMonth } from "../../_lib/cronSchedule";

function makeRequest(headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/cron/nflverse-historical", {
    method: "GET",
    headers,
  }) as unknown as Parameters<typeof GET>[0];
}

beforeEach(() => {
  syncInjuriesMock.mockReset();
  syncRosterStatusMock.mockReset();
  syncScheduleMock.mockReset();
  recordSyncBreadcrumbMock.mockReset();
  process.env.CRON_SECRET = "test-cron-secret";
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

afterAll(() => {
  delete process.env.CRON_SECRET;
});

describe("isFirstSundayOfMonth", () => {
  it("returns true for the 1st-7th of the month on a Sunday", () => {
    // 2026-03-01 is a Sunday
    expect(isFirstSundayOfMonth(new Date(Date.UTC(2026, 2, 1, 9)))).toBe(true);
    // 2026-03-08 is a Sunday but not first-of-month
    expect(isFirstSundayOfMonth(new Date(Date.UTC(2026, 2, 8, 9)))).toBe(false);
  });

  it("returns false on non-Sunday dates", () => {
    // 2026-03-02 is a Monday
    expect(isFirstSundayOfMonth(new Date(Date.UTC(2026, 2, 2, 9)))).toBe(false);
  });
});

describe("GET /api/cron/nflverse-historical", () => {
  it("returns 401 without bearer token", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    expect(syncInjuriesMock).not.toHaveBeenCalled();
  });

  it("skips work when not first-Sunday-of-month and returns 200", async () => {
    // 2026-03-15 is a Sunday but not first-of-month
    jest.setSystemTime(new Date(Date.UTC(2026, 2, 15, 9)));
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    try {
      const res = await GET(
        makeRequest({ authorization: "Bearer test-cron-secret" })
      );
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.summary.ranWork).toBe(false);
      expect(syncInjuriesMock).not.toHaveBeenCalled();
      expect(syncRosterStatusMock).not.toHaveBeenCalled();
      expect(syncScheduleMock).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });

  it("runs all sources on first-Sunday-of-month with valid bearer", async () => {
    // 2026-03-01 is the first Sunday of March 2026
    jest.setSystemTime(new Date(Date.UTC(2026, 2, 1, 9)));
    syncInjuriesMock.mockResolvedValueOnce({ total: 0, seasonResults: {} });
    syncRosterStatusMock.mockResolvedValueOnce({ total: 0, seasonResults: {} });
    syncScheduleMock.mockResolvedValueOnce({ total: 0, seasonResults: {} });

    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    try {
      const res = await GET(
        makeRequest({ authorization: "Bearer test-cron-secret" })
      );
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.summary.ranWork).toBe(true);
      expect(json.summary.seasonRange).toEqual([2002, 2024]);
      expect(json.callsMade).toBe(3);

      // Historical seasons must NOT be forced — the watermark fast-path
      // is the entire point of running 23 seasons cheaply each month.
      const injuriesCall = syncInjuriesMock.mock.calls[0][0];
      expect(injuriesCall.force).toBeUndefined();
      expect(injuriesCall.seasons).toHaveLength(23);
      expect(injuriesCall.seasons[0]).toBe(2002);
      expect(injuriesCall.seasons[injuriesCall.seasons.length - 1]).toBe(2024);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("fires entry breadcrumb when work runs", async () => {
    jest.setSystemTime(new Date(Date.UTC(2026, 2, 1, 9)));
    syncInjuriesMock.mockResolvedValueOnce({ total: 0, seasonResults: {} });
    syncRosterStatusMock.mockResolvedValueOnce({ total: 0, seasonResults: {} });
    syncScheduleMock.mockResolvedValueOnce({ total: 0, seasonResults: {} });

    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    try {
      await GET(makeRequest({ authorization: "Bearer test-cron-secret" }));
      const calls = recordSyncBreadcrumbMock.mock.calls.map((c) => c[0]);
      expect(
        calls.some((c) => c.source === "nflverse" && c.trigger === "cron")
      ).toBe(true);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("does not call sync helpers on auth failure even on first-Sunday", async () => {
    jest.setSystemTime(new Date(Date.UTC(2026, 2, 1, 9)));
    const res = await GET(makeRequest({ authorization: "Bearer wrong" }));
    expect(res.status).toBe(401);
    expect(syncInjuriesMock).not.toHaveBeenCalled();
  });
});
