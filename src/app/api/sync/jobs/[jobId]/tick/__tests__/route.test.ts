/**
 * @jest-environment node
 *
 * Tests for `POST /api/sync/jobs/[jobId]/tick` (#151).
 *
 * Coverage:
 *   - 404 when the job doesn't exist
 *   - returns terminal status when the job is already success/failed
 *   - in-progress -> drives runChunk and surfaces its result
 *   - completed   -> releases the lock + touches lastSyncedAt
 *   - stage failure caught -> 200 + status: "failed" + error string
 */

const stubColumn = (name: string) => ({ name });

jest.mock("@/db", () => ({
  schema: {
    syncJobs: {
      id: stubColumn("id"),
      ref: stubColumn("ref"),
      status: stubColumn("status"),
      stagesCompleted: stubColumn("stages_completed"),
      stagesTotal: stubColumn("stages_total"),
      currentStage: stubColumn("current_stage"),
      trigger: stubColumn("trigger"),
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
    leagues: {
      id: stubColumn("id"),
      lastSyncedAt: stubColumn("last_synced_at"),
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
      join: (parts: unknown[], sep: unknown) => ({
        op: "join",
        parts,
        sep,
      }),
    }
  ),
}));

const releaseSyncLockMock = jest.fn();
jest.mock("@/services/syncLock", () => ({
  releaseSyncLock: (...args: unknown[]) => releaseSyncLockMock(...args),
}));

const buildFamilyStagesMock = jest.fn();
const runChunkMock = jest.fn();
jest.mock("@/services/chunkedSync", () => ({
  buildFamilyStages: (...args: unknown[]) => buildFamilyStagesMock(...args),
  runChunk: (...args: unknown[]) => runChunkMock(...args),
}));

jest.mock("@/lib/observability/syncBreadcrumb", () => ({
  recordSyncBreadcrumb: jest.fn(),
}));

jest.mock("@/lib/observability/withSyncTransaction", () => ({
  withSyncTransaction: (
    _name: string,
    _op: string,
    fn: () => unknown
  ) => fn(),
}));

import { getDb } from "@/db";
import { POST } from "../route";

const mockedGetDb = getDb as jest.MockedFunction<typeof getDb>;

interface DbScript {
  selectResponses: unknown[][];
  /** Whether `update(...)` should resolve OK (default true). */
  updateOk?: boolean;
}

function makeMockDb(script: DbScript) {
  const queue = [...script.selectResponses];
  /**
   * Build a `where(...)` result that is BOTH a thenable (drizzle queries
   * are awaitable directly) AND exposes a `.limit()` for the chains that
   * need it. Each consumed chain pulls the next response off the queue.
   */
  const makeWhereResult = () => {
    const result: Record<string, unknown> = {
      then: (resolve: (v: unknown) => void) =>
        resolve(queue.shift() ?? []),
      limit: () => Promise.resolve(queue.shift() ?? []),
    };
    return result;
  };
  const dbStub = {
    select: jest.fn(() => ({
      from: () => ({
        where: () => makeWhereResult(),
      }),
    })),
    update: jest.fn(() => ({
      set: () => ({
        where: () => Promise.resolve(undefined),
      }),
    })),
  };
  mockedGetDb.mockReturnValue(dbStub as unknown as ReturnType<typeof getDb>);
  return dbStub;
}

function makeRequest(): Request {
  return new Request("http://localhost/api/sync/jobs/job-1/tick", {
    method: "POST",
  });
}

const ctx = (jobId: string) => ({ params: { jobId } });

describe("POST /api/sync/jobs/[jobId]/tick", () => {
  beforeEach(() => {
    releaseSyncLockMock.mockReset();
    buildFamilyStagesMock.mockReset();
    runChunkMock.mockReset();
    mockedGetDb.mockReset();
  });

  test("404 when job doesn't exist", async () => {
    makeMockDb({ selectResponses: [[]] });
    const res = await POST(makeRequest() as never, ctx("missing"));
    expect(res.status).toBe(404);
  });

  test("returns completed when job already succeeded", async () => {
    makeMockDb({
      selectResponses: [
        [
          {
            id: "j1",
            ref: "root",
            status: "success",
            stagesCompleted: 8,
            stagesTotal: 8,
            currentStage: null,
            trigger: "lazy",
          },
        ],
      ],
    });
    const res = await POST(makeRequest() as never, ctx("j1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      status: "completed",
      stagesCompleted: 8,
      stagesTotal: 8,
    });
    // Should not have rebuilt stages or kicked off chunked work.
    expect(buildFamilyStagesMock).not.toHaveBeenCalled();
  });

  test("returns failed when the job is already in failed state", async () => {
    makeMockDb({
      selectResponses: [
        [
          {
            id: "j1",
            ref: "root",
            status: "failed",
            stagesCompleted: 2,
            stagesTotal: 8,
            currentStage: "season 2 of 5",
            trigger: "lazy",
          },
        ],
      ],
    });
    const res = await POST(makeRequest() as never, ctx("j1"));
    const body = await res.json();
    expect(body.status).toBe("failed");
    expect(body.stagesCompleted).toBe(2);
  });

  test("happy in-progress tick -> surfaces runChunk progress", async () => {
    makeMockDb({
      selectResponses: [
        // job lookup
        [
          {
            id: "j1",
            ref: "root",
            status: "running",
            stagesCompleted: 0,
            stagesTotal: null,
            currentStage: null,
            trigger: "lazy",
          },
        ],
        // family-by-rootLeagueId
        [{ id: "fam-1" }],
        // members
        [
          { leagueId: "l-2022", season: "2022" },
          { leagueId: "l-2023", season: "2023" },
        ],
      ],
    });
    buildFamilyStagesMock.mockResolvedValue([
      { key: "players", label: "Refreshing player metadata", run: jest.fn() },
      { key: "season:2022", label: "season 1 of 2", run: jest.fn() },
    ]);
    runChunkMock.mockResolvedValue({
      status: "in_progress",
      stagesCompleted: 1,
      stagesTotal: 2,
      currentStageKey: "season:2022",
      currentStageLabel: "season 1 of 2",
    });

    const res = await POST(makeRequest() as never, ctx("j1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      status: "in_progress",
      stagesCompleted: 1,
      stagesTotal: 2,
      currentStageLabel: "season 1 of 2",
    });
    expect(releaseSyncLockMock).not.toHaveBeenCalled();
  });

  test("completed tick -> releases lock and returns completed status", async () => {
    makeMockDb({
      selectResponses: [
        [
          {
            id: "j1",
            ref: "root",
            status: "running",
            stagesCompleted: 7,
            stagesTotal: 8,
            currentStage: "manager-grades",
            trigger: "lazy",
          },
        ],
        [{ id: "fam-1" }],
        [
          { leagueId: "l-1", season: "2022" },
          { leagueId: "l-2", season: "2023" },
        ],
      ],
    });
    buildFamilyStagesMock.mockResolvedValue([{ key: "x", label: "x", run: jest.fn() }]);
    runChunkMock.mockResolvedValue({
      status: "completed",
      stagesCompleted: 8,
      stagesTotal: 8,
      currentStageKey: null,
      currentStageLabel: null,
    });

    const res = await POST(makeRequest() as never, ctx("j1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("completed");
    expect(releaseSyncLockMock).toHaveBeenCalledWith(
      "j1",
      "success",
      undefined,
      { stagesCompleted: 8 }
    );
  });

  test("stage failure -> caught, lock released as failed, 200 with error", async () => {
    makeMockDb({
      selectResponses: [
        [
          {
            id: "j1",
            ref: "root",
            status: "running",
            stagesCompleted: 0,
            stagesTotal: null,
            currentStage: null,
            trigger: "lazy",
          },
        ],
        [{ id: "fam-1" }],
        [{ leagueId: "l-1", season: "2022" }],
        // After failure: re-read for accurate progress.
        [
          {
            stagesCompleted: 1,
            stagesTotal: 8,
            currentStage: "season 2 of 2",
          },
        ],
      ],
    });
    buildFamilyStagesMock.mockResolvedValue([{ key: "x", label: "x", run: jest.fn() }]);
    runChunkMock.mockRejectedValue(new Error("Sleeper rate limit exceeded"));

    const res = await POST(makeRequest() as never, ctx("j1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("failed");
    expect(body.error).toMatch(/Sleeper/);
    expect(releaseSyncLockMock).toHaveBeenCalledWith(
      "j1",
      "failed",
      "Sleeper rate limit exceeded"
    );
  });

  test("missing ref -> fails fast and releases lock", async () => {
    makeMockDb({
      selectResponses: [
        [
          {
            id: "j1",
            ref: null,
            status: "running",
            stagesCompleted: 0,
            stagesTotal: null,
            currentStage: null,
            trigger: "lazy",
          },
        ],
      ],
    });
    const res = await POST(makeRequest() as never, ctx("j1"));
    const body = await res.json();
    expect(body.status).toBe("failed");
    expect(releaseSyncLockMock).toHaveBeenCalledWith(
      "j1",
      "failed",
      expect.stringMatching(/missing ref/i)
    );
  });

  test("family not found -> fails fast and releases lock", async () => {
    makeMockDb({
      selectResponses: [
        [
          {
            id: "j1",
            ref: "root",
            status: "running",
            stagesCompleted: 0,
            stagesTotal: null,
            currentStage: null,
            trigger: "lazy",
          },
        ],
        [], // family-by-rootLeagueId returns nothing
        [], // member fallback also returns nothing
      ],
    });
    const res = await POST(makeRequest() as never, ctx("j1"));
    const body = await res.json();
    expect(body.status).toBe("failed");
    expect(releaseSyncLockMock).toHaveBeenCalled();
  });
});
