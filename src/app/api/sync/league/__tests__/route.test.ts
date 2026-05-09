/**
 * @jest-environment node
 *
 * Auth + happy-path coverage for /api/sync/league. The route is the manual
 * debug entry point for triggering a family sync; it MUST 401 without a
 * valid bearer token (CRON_SECRET) so the public internet can't kick off
 * a sync. The internal services are mocked at the module boundary.
 */

const ensureLeagueFamilyMock = jest.fn();
const syncLeagueFamilyMock = jest.fn();
const acquireSyncLockMock = jest.fn();
const releaseSyncLockMock = jest.fn();
const dbSelectChain = jest.fn();

jest.mock("@/services/sync", () => ({
  syncLeagueFamily: (...args: unknown[]) => syncLeagueFamilyMock(...args),
}));

jest.mock("@/services/leagueFamily", () => ({
  ensureLeagueFamily: (...args: unknown[]) => ensureLeagueFamilyMock(...args),
}));

jest.mock("@/services/syncLock", () => ({
  acquireSyncLock: (...args: unknown[]) => acquireSyncLockMock(...args),
  releaseSyncLock: (...args: unknown[]) => releaseSyncLockMock(...args),
}));

jest.mock("@/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => dbSelectChain(),
      }),
    }),
  }),
  schema: {
    leagueFamilyMembers: {
      familyId: "familyId",
    },
  },
}));

jest.mock("drizzle-orm", () => ({
  eq: (a: unknown, b: unknown) => ({ a, b }),
}));

import { POST } from "../route";

function makeRequest(
  body: Record<string, unknown> = {},
  headers: Record<string, string> = {}
) {
  return new Request("http://localhost/api/sync/league", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  }) as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
  ensureLeagueFamilyMock.mockReset();
  syncLeagueFamilyMock.mockReset();
  acquireSyncLockMock.mockReset();
  releaseSyncLockMock.mockReset();
  dbSelectChain.mockReset();
  process.env.CRON_SECRET = "test-cron-secret";
});

afterAll(() => {
  delete process.env.CRON_SECRET;
});

describe("POST /api/sync/league", () => {
  it("returns 401 without bearer token", async () => {
    const res = await POST(makeRequest({ leagueId: "abc" }));
    expect(res.status).toBe(401);
    expect(ensureLeagueFamilyMock).not.toHaveBeenCalled();
    expect(syncLeagueFamilyMock).not.toHaveBeenCalled();
  });

  it("returns 401 with wrong bearer token", async () => {
    const res = await POST(
      makeRequest({ leagueId: "abc" }, { authorization: "Bearer wrong" })
    );
    expect(res.status).toBe(401);
    expect(ensureLeagueFamilyMock).not.toHaveBeenCalled();
  });

  it("returns 401 when CRON_SECRET is unset (fail closed)", async () => {
    delete process.env.CRON_SECRET;
    const res = await POST(
      makeRequest(
        { leagueId: "abc" },
        { authorization: "Bearer test-cron-secret" }
      )
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 when leagueId is missing", async () => {
    const res = await POST(
      makeRequest({}, { authorization: "Bearer test-cron-secret" })
    );
    expect(res.status).toBe(400);
    expect(ensureLeagueFamilyMock).not.toHaveBeenCalled();
  });

  it("returns 409 when sync lock is held", async () => {
    ensureLeagueFamilyMock.mockResolvedValueOnce("fam-1");
    acquireSyncLockMock.mockResolvedValueOnce(null);
    const res = await POST(
      makeRequest(
        { leagueId: "abc" },
        { authorization: "Bearer test-cron-secret" }
      )
    );
    expect(res.status).toBe(409);
    expect(syncLeagueFamilyMock).not.toHaveBeenCalled();
  });

  it("returns 200 on a clean run with valid bearer", async () => {
    ensureLeagueFamilyMock.mockResolvedValueOnce("fam-1");
    acquireSyncLockMock.mockResolvedValueOnce("job-1");
    dbSelectChain.mockResolvedValueOnce([
      { leagueId: "l-2024", season: "2024", familyId: "fam-1" },
      { leagueId: "l-2025", season: "2025", familyId: "fam-1" },
    ]);
    syncLeagueFamilyMock.mockResolvedValueOnce(undefined);

    const res = await POST(
      makeRequest(
        { leagueId: "abc" },
        { authorization: "Bearer test-cron-secret" }
      )
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.familyId).toBe("fam-1");
    expect(syncLeagueFamilyMock).toHaveBeenCalledWith(
      ["l-2024", "l-2025"],
      undefined,
      "fam-1",
      { trigger: "manual" }
    );
    expect(releaseSyncLockMock).toHaveBeenCalledWith("job-1", "success");
  });
});
