/**
 * @jest-environment node
 *
 * Auth + per-source isolation for /api/cron/nflverse-current.
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

function makeRequest(headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/cron/nflverse-current", {
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
});

afterAll(() => {
  delete process.env.CRON_SECRET;
});

describe("GET /api/cron/nflverse-current", () => {
  it("returns 401 without bearer token", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    expect(syncInjuriesMock).not.toHaveBeenCalled();
  });

  it("returns 200 + summary with valid bearer (all sources succeed)", async () => {
    syncInjuriesMock.mockResolvedValueOnce({ total: 100, seasonResults: { 2025: 100 } });
    syncRosterStatusMock.mockResolvedValueOnce({ total: 200, seasonResults: { 2025: 200 } });
    syncScheduleMock.mockResolvedValueOnce({ total: 17, seasonResults: { 2025: 17 } });
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    try {
      const res = await GET(
        makeRequest({ authorization: "Bearer test-cron-secret" })
      );
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.callsMade).toBe(3);
      expect(json.summary.season).toBe(2025);
      expect(json.summary.results).toHaveLength(3);

      // Every source must be called with force=true so the new watermark
      // logic doesn't short-circuit mid-season weekly updates.
      expect(syncInjuriesMock).toHaveBeenCalledWith({ seasons: [2025], force: true });
      expect(syncRosterStatusMock).toHaveBeenCalledWith({ seasons: [2025], force: true });
      expect(syncScheduleMock).toHaveBeenCalledWith({ seasons: [2025], force: true });
    } finally {
      logSpy.mockRestore();
    }
  });

  it("isolates per-source failures (partial)", async () => {
    syncInjuriesMock.mockResolvedValueOnce({ total: 0, seasonResults: {} });
    syncRosterStatusMock.mockRejectedValueOnce(new Error("404 not yet"));
    syncScheduleMock.mockResolvedValueOnce({ total: 17, seasonResults: { 2025: 17 } });
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    try {
      const res = await GET(
        makeRequest({ authorization: "Bearer test-cron-secret" })
      );
      expect(res.status).toBe(200);
      const json = await res.json();
      const failed = json.summary.results.find(
        (r: { source: string; ok: boolean }) => r.source === "roster_status"
      );
      expect(failed.ok).toBe(false);
      expect(failed.error).toContain("404");
      const calls = recordSyncBreadcrumbMock.mock.calls.map((c) => c[0]);
      expect(calls.some((c) => c.outcome === "partial")).toBe(true);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("returns 500 when every source fails", async () => {
    syncInjuriesMock.mockRejectedValueOnce(new Error("a"));
    syncRosterStatusMock.mockRejectedValueOnce(new Error("b"));
    syncScheduleMock.mockRejectedValueOnce(new Error("c"));
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    try {
      const res = await GET(
        makeRequest({ authorization: "Bearer test-cron-secret" })
      );
      expect(res.status).toBe(500);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("fires entry breadcrumb on auth success", async () => {
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
});
