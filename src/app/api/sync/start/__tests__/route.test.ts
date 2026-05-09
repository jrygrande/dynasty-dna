/**
 * @jest-environment node
 *
 * Tests for `POST /api/sync/start` (#151).
 *
 * The route is a thin idempotent wrapper around the existing
 * `acquireSyncLock` helper — it just makes sure a `syncJobs` row exists
 * for the family so the cold-sync loading screen has something to poll.
 *
 * Coverage:
 *   - 400 on missing / invalid body
 *   - 404 on unknown familyId
 *   - 200 + new jobId on success
 *   - 200 + existing jobId on a non-stale running job (reuse semantics)
 */

const stubColumn = (name: string) => ({ name });

jest.mock("@/db", () => ({
  schema: {
    syncJobs: {
      id: stubColumn("id"),
      ref: stubColumn("ref"),
      status: stubColumn("status"),
      startedAt: stubColumn("started_at"),
    },
    leagueFamilies: {
      id: stubColumn("id"),
      rootLeagueId: stubColumn("root_league_id"),
    },
    leagueFamilyMembers: {
      familyId: stubColumn("family_id"),
      leagueId: stubColumn("league_id"),
      season: stubColumn("season"),
    },
  },
  getDb: jest.fn(),
}));

jest.mock("drizzle-orm", () => ({
  eq: (col: { name: string }, value: unknown) => ({ op: "eq", col, value }),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({
      op: "sql",
      strings: Array.from(strings),
      values,
    }),
    {
      raw: (s: string) => s,
    }
  ),
}));

const resolveFamilyMock = jest.fn();
jest.mock("@/lib/familyResolution", () => ({
  resolveFamily: (id: string) => resolveFamilyMock(id),
}));

const acquireSyncLockMock = jest.fn();
jest.mock("@/services/syncLock", () => ({
  acquireSyncLock: (...args: unknown[]) => acquireSyncLockMock(...args),
}));

import { getDb } from "@/db";
import { POST } from "../route";

const mockedGetDb = getDb as jest.MockedFunction<typeof getDb>;

interface DbScript {
  /** Sequential responses for `select(...).from(...).where(...).limit(...)` chains. */
  selectResponses: unknown[][];
}

function makeMockDb(script: DbScript) {
  const queue = [...script.selectResponses];
  const dbStub = {
    select: jest.fn(() => ({
      from: () => ({
        where: () => {
          const limitFn = () => Promise.resolve(queue.shift() ?? []);
          return {
            limit: limitFn,
            orderBy: () => ({ limit: limitFn }),
          };
        },
      }),
    })),
  };
  mockedGetDb.mockReturnValue(dbStub as unknown as ReturnType<typeof getDb>);
}

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/sync/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/sync/start", () => {
  beforeEach(() => {
    resolveFamilyMock.mockReset();
    acquireSyncLockMock.mockReset();
    mockedGetDb.mockReset();
  });

  test("400 when body is missing familyId", async () => {
    const res = await POST(makeRequest({}) as never);
    expect(res.status).toBe(400);
  });

  test("400 when body is invalid JSON", async () => {
    const res = await POST(makeRequest("not-json{") as never);
    expect(res.status).toBe(400);
  });

  test("404 when family cannot be resolved", async () => {
    resolveFamilyMock.mockResolvedValue(null);
    const res = await POST(
      makeRequest({ familyId: "unknown-id" }) as never
    );
    expect(res.status).toBe(404);
  });

  test("200 + new jobId on cold path", async () => {
    resolveFamilyMock.mockResolvedValue("fam-uuid");
    makeMockDb({
      selectResponses: [
        // getFamilyRootRef -> family lookup returns rootLeagueId
        [{ rootLeagueId: "root-league-1" }],
        // findRunningJobId -> no in-flight job
        [],
      ],
    });
    acquireSyncLockMock.mockResolvedValue("new-job-id");

    const res = await POST(
      makeRequest({ familyId: "root-league-1" }) as never
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      jobId: "new-job-id",
      familyId: "fam-uuid",
      reused: false,
    });
    expect(acquireSyncLockMock).toHaveBeenCalledWith("root-league-1", {
      trigger: "lazy",
    });
  });

  test("200 + existing jobId when an in-flight job is found (reuse)", async () => {
    resolveFamilyMock.mockResolvedValue("fam-uuid");
    makeMockDb({
      selectResponses: [
        [{ rootLeagueId: "root-league-2" }],
        [{ id: "in-flight-job" }],
      ],
    });

    const res = await POST(
      makeRequest({ familyId: "root-league-2" }) as never
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      jobId: "in-flight-job",
      familyId: "fam-uuid",
      reused: true,
    });
    // Did NOT acquire a fresh lock — we reused.
    expect(acquireSyncLockMock).not.toHaveBeenCalled();
  });

  test("falls back to most-recent member when family has no rootLeagueId", async () => {
    resolveFamilyMock.mockResolvedValue("fam-uuid");
    makeMockDb({
      selectResponses: [
        // family row exists but rootLeagueId is null
        [{ rootLeagueId: null }],
        // member fallback returns the most-recent league
        [{ leagueId: "most-recent-league", season: "2024" }],
        // findRunningJobId
        [],
      ],
    });
    acquireSyncLockMock.mockResolvedValue("job-from-fallback");

    const res = await POST(
      makeRequest({ familyId: "fam-uuid" }) as never
    );
    expect(res.status).toBe(200);
    expect(acquireSyncLockMock).toHaveBeenCalledWith("most-recent-league", {
      trigger: "lazy",
    });
  });

  test("404 when family has no member leagues at all", async () => {
    resolveFamilyMock.mockResolvedValue("fam-uuid");
    makeMockDb({
      selectResponses: [
        [{ rootLeagueId: null }],
        [], // no members
      ],
    });
    const res = await POST(
      makeRequest({ familyId: "fam-uuid" }) as never
    );
    expect(res.status).toBe(404);
  });
});
