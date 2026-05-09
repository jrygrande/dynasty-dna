/**
 * @jest-environment node
 *
 * Auth coverage for /api/sync/roster-status. Admin-only — no in-app caller,
 * bearer-required.
 */

const syncRosterStatusMock = jest.fn();

jest.mock("@/services/rosterStatusSync", () => ({
  syncRosterStatus: (...args: unknown[]) => syncRosterStatusMock(...args),
}));

import { POST } from "../route";

function makeRequest(headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/sync/roster-status", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({}),
  }) as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
  syncRosterStatusMock.mockReset();
  process.env.CRON_SECRET = "test-cron-secret";
});

afterAll(() => {
  delete process.env.CRON_SECRET;
});

describe("POST /api/sync/roster-status", () => {
  it("returns 401 without bearer", async () => {
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
    expect(syncRosterStatusMock).not.toHaveBeenCalled();
  });

  it("returns 401 with wrong bearer", async () => {
    const res = await POST(makeRequest({ authorization: "Bearer wrong" }));
    expect(res.status).toBe(401);
  });

  it("returns 401 with same-origin only (admin route does NOT accept origin fallback)", async () => {
    const res = await POST(
      makeRequest({ origin: "https://localhost", host: "localhost" })
    );
    expect(res.status).toBe(401);
  });

  it("returns 200 with valid bearer", async () => {
    syncRosterStatusMock.mockResolvedValueOnce({ total: 0, seasonResults: {} });
    const res = await POST(
      makeRequest({ authorization: "Bearer test-cron-secret" })
    );
    expect(res.status).toBe(200);
    expect(syncRosterStatusMock).toHaveBeenCalled();
  });
});
