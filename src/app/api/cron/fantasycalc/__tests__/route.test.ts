/**
 * @jest-environment node
 *
 * Auth + per-combo isolation coverage for /api/cron/fantasycalc.
 */

const getDistinctFantasyCalcConfigsMock = jest.fn();
const syncFantasyCalcValuesForConfigMock = jest.fn();
const recordSyncBreadcrumbMock = jest.fn();

jest.mock("@/services/fantasyCalcSync", () => ({
  getDistinctFantasyCalcConfigs: (...args: unknown[]) =>
    getDistinctFantasyCalcConfigsMock(...args),
  syncFantasyCalcValuesForConfig: (...args: unknown[]) =>
    syncFantasyCalcValuesForConfigMock(...args),
}));

jest.mock("@/lib/observability/syncBreadcrumb", () => ({
  recordSyncBreadcrumb: (...args: unknown[]) => recordSyncBreadcrumbMock(...args),
}));

import { GET } from "../route";

function makeRequest(headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/cron/fantasycalc", {
    method: "GET",
    headers,
  }) as unknown as Parameters<typeof GET>[0];
}

const COMBO_A = { isSuperFlex: true, ppr: 1, numTeams: 12, numQbs: 2 };
const COMBO_B = { isSuperFlex: false, ppr: 0.5, numTeams: 10, numQbs: 1 };

beforeEach(() => {
  getDistinctFantasyCalcConfigsMock.mockReset();
  syncFantasyCalcValuesForConfigMock.mockReset();
  recordSyncBreadcrumbMock.mockReset();
  process.env.CRON_SECRET = "test-cron-secret";
});

afterAll(() => {
  delete process.env.CRON_SECRET;
});

describe("GET /api/cron/fantasycalc", () => {
  it("returns 401 without bearer token", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    expect(getDistinctFantasyCalcConfigsMock).not.toHaveBeenCalled();
  });

  it("returns 200 + summary with valid bearer (all combos succeed)", async () => {
    getDistinctFantasyCalcConfigsMock.mockResolvedValueOnce([COMBO_A, COMBO_B]);
    syncFantasyCalcValuesForConfigMock.mockResolvedValue(new Date("2026-01-01"));
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    try {
      const res = await GET(
        makeRequest({ authorization: "Bearer test-cron-secret" })
      );
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.callsMade).toBe(2);
      expect(json.summary.combos).toBe(2);
      expect(json.summary.failures).toBe(0);
      // Force=true so the cron always re-fetches and the staleness gate
      // doesn't suppress it on a fast re-run.
      expect(syncFantasyCalcValuesForConfigMock).toHaveBeenCalledWith(
        COMBO_A,
        { force: true }
      );
    } finally {
      logSpy.mockRestore();
    }
  });

  it("isolates per-combo failures and returns 200 partial", async () => {
    getDistinctFantasyCalcConfigsMock.mockResolvedValueOnce([COMBO_A, COMBO_B]);
    syncFantasyCalcValuesForConfigMock
      .mockResolvedValueOnce(new Date("2026-01-01"))
      .mockRejectedValueOnce(new Error("rate limited"));
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    try {
      const res = await GET(
        makeRequest({ authorization: "Bearer test-cron-secret" })
      );
      expect(res.status).toBe(200); // partial = still 200
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.summary.combos).toBe(2);
      expect(json.summary.failures).toBe(1);
      const failed = json.summary.results.find(
        (r: { ok: boolean }) => !r.ok
      );
      expect(failed.error).toBe("rate limited");
      // partial breadcrumb fires
      const calls = recordSyncBreadcrumbMock.mock.calls.map((c) => c[0]);
      expect(calls.some((c) => c.outcome === "partial")).toBe(true);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("returns 500 when every combo fails", async () => {
    getDistinctFantasyCalcConfigsMock.mockResolvedValueOnce([COMBO_A]);
    syncFantasyCalcValuesForConfigMock.mockRejectedValueOnce(
      new Error("dead")
    );
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    try {
      const res = await GET(
        makeRequest({ authorization: "Bearer test-cron-secret" })
      );
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.ok).toBe(false);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("fires entry + completion breadcrumbs", async () => {
    getDistinctFantasyCalcConfigsMock.mockResolvedValueOnce([COMBO_A]);
    syncFantasyCalcValuesForConfigMock.mockResolvedValueOnce(new Date());
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    try {
      await GET(makeRequest({ authorization: "Bearer test-cron-secret" }));
      const calls = recordSyncBreadcrumbMock.mock.calls.map((c) => c[0]);
      expect(calls.some((c) => c.source === "fantasycalc" && c.trigger === "cron")).toBe(true);
    } finally {
      logSpy.mockRestore();
    }
  });
});
