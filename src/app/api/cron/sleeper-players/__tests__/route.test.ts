/**
 * @jest-environment node
 *
 * Cron auth + happy-path coverage for /api/cron/sleeper-players. The sync
 * service is mocked at the module boundary so tests are deterministic and
 * don't touch Sleeper.
 */

const syncPlayersMock = jest.fn();
const recordSyncBreadcrumbMock = jest.fn();

jest.mock("@/services/playerSync", () => ({
  syncPlayers: (...args: unknown[]) => syncPlayersMock(...args),
}));

jest.mock("@/lib/observability/syncBreadcrumb", () => ({
  recordSyncBreadcrumb: (...args: unknown[]) => recordSyncBreadcrumbMock(...args),
}));

import { GET } from "../route";

function makeRequest(headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/cron/sleeper-players", {
    method: "GET",
    headers,
  }) as unknown as Parameters<typeof GET>[0];
}

beforeEach(() => {
  syncPlayersMock.mockReset();
  recordSyncBreadcrumbMock.mockReset();
  process.env.CRON_SECRET = "test-cron-secret";
});

afterAll(() => {
  delete process.env.CRON_SECRET;
});

describe("GET /api/cron/sleeper-players", () => {
  it("returns 401 without bearer token", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    expect(syncPlayersMock).not.toHaveBeenCalled();
  });

  it("returns 401 with wrong bearer token", async () => {
    const res = await GET(makeRequest({ authorization: "Bearer wrong" }));
    expect(res.status).toBe(401);
    expect(syncPlayersMock).not.toHaveBeenCalled();
  });

  it("returns 401 when CRON_SECRET is unset (fail closed)", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(
      makeRequest({ authorization: "Bearer test-cron-secret" })
    );
    expect(res.status).toBe(401);
  });

  it("returns 200 + summary with valid bearer", async () => {
    syncPlayersMock.mockResolvedValueOnce(123);
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    try {
      const res = await GET(
        makeRequest({ authorization: "Bearer test-cron-secret" })
      );
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.summary).toEqual({ synced: 123 });
      expect(json.callsMade).toBe(1);
      expect(typeof json.durationMs).toBe("number");
      // syncPlayers must be called with force=true so the daily refresh
      // never gets short-circuited by the staleness gate.
      expect(syncPlayersMock).toHaveBeenCalledWith(true);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("fires breadcrumbs for entry + success", async () => {
    syncPlayersMock.mockResolvedValueOnce(7);
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    try {
      await GET(makeRequest({ authorization: "Bearer test-cron-secret" }));
      expect(recordSyncBreadcrumbMock).toHaveBeenCalled();
      const calls = recordSyncBreadcrumbMock.mock.calls.map((c) => c[0]);
      expect(calls.some((c) => c.source === "sleeper" && c.trigger === "cron")).toBe(true);
      // Final breadcrumb should record success outcome with duration.
      const successCall = calls.find(
        (c) => c.outcome === "success" && typeof c.durationMs === "number"
      );
      expect(successCall).toBeDefined();
    } finally {
      logSpy.mockRestore();
    }
  });

  it("returns 500 + failure breadcrumb when syncPlayers throws", async () => {
    syncPlayersMock.mockRejectedValueOnce(new Error("sleeper down"));
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await GET(
        makeRequest({ authorization: "Bearer test-cron-secret" })
      );
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toBe("sleeper down");
      const calls = recordSyncBreadcrumbMock.mock.calls.map((c) => c[0]);
      expect(calls.some((c) => c.outcome === "failed" && c.error === "sleeper down")).toBe(true);
    } finally {
      errSpy.mockRestore();
    }
  });
});
