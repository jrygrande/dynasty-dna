/**
 * @jest-environment node
 *
 * Auth coverage for /api/sync/injuries. Admin-only — no in-app caller,
 * bearer-required.
 */

const syncInjuriesMock = jest.fn();

jest.mock("@/services/injurySync", () => ({
  syncInjuries: (...args: unknown[]) => syncInjuriesMock(...args),
}));

import { POST } from "../route";

function makeRequest(headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/sync/injuries", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({}),
  }) as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
  syncInjuriesMock.mockReset();
  process.env.CRON_SECRET = "test-cron-secret";
});

afterAll(() => {
  delete process.env.CRON_SECRET;
});

describe("POST /api/sync/injuries", () => {
  it("returns 401 without bearer", async () => {
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
    expect(syncInjuriesMock).not.toHaveBeenCalled();
  });

  it("returns 401 with wrong bearer", async () => {
    const res = await POST(makeRequest({ authorization: "Bearer wrong" }));
    expect(res.status).toBe(401);
    expect(syncInjuriesMock).not.toHaveBeenCalled();
  });

  it("returns 401 with same-origin only (admin route does NOT accept origin fallback)", async () => {
    const res = await POST(
      makeRequest({ origin: "https://localhost", host: "localhost" })
    );
    expect(res.status).toBe(401);
    expect(syncInjuriesMock).not.toHaveBeenCalled();
  });

  it("returns 200 with valid bearer", async () => {
    syncInjuriesMock.mockResolvedValueOnce({ total: 0, seasonResults: {} });
    const res = await POST(
      makeRequest({ authorization: "Bearer test-cron-secret" })
    );
    expect(res.status).toBe(200);
    expect(syncInjuriesMock).toHaveBeenCalled();
  });
});

describe("POST /api/sync/injuries — fail-closed when CRON_SECRET unset", () => {
  beforeEach(() => {
    delete process.env.CRON_SECRET;
  });

  it("rejects all callers", async () => {
    const res = await POST(
      makeRequest({ authorization: "Bearer anything" })
    );
    expect(res.status).toBe(401);
    expect(syncInjuriesMock).not.toHaveBeenCalled();
  });
});
