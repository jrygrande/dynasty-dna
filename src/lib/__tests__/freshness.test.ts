/**
 * @jest-environment node
 *
 * Tests the lazy-on-visit freshness gate (#150).
 *
 * Strategy: mock the DB layer, the `resolveFamily` lookup, the syncLock
 * helpers, and `syncLeagueFamily` so we can drive `ensureLeagueFresh`
 * through every state and observe:
 *
 *   - Fresh (in-window): no sync call
 *   - Stale (past window): sync runs, lock acquired and released
 *   - Cold (never synced): jobId returned, sync NOT awaited
 *   - Concurrent visitors: only one sync runs (lock contention)
 *   - In-season vs off-season window thresholds
 */

// ---- Mocks (must be declared before importing module under test) ---------

const resolveFamilyMock = jest.fn();
jest.mock("@/lib/familyResolution", () => ({
  resolveFamily: (id: string) => resolveFamilyMock(id),
}));

const syncLeagueFamilyMock = jest.fn();
jest.mock("@/services/sync", () => ({
  syncLeagueFamily: (...args: unknown[]) => syncLeagueFamilyMock(...args),
}));

const acquireSyncLockMock = jest.fn();
const releaseSyncLockMock = jest.fn();
jest.mock("@/services/syncLock", () => ({
  acquireSyncLock: (ref: string, opts?: unknown) =>
    acquireSyncLockMock(ref, opts),
  releaseSyncLock: (
    jobId: string,
    status: string,
    error?: string,
    audit?: unknown
  ) => releaseSyncLockMock(jobId, status, error, audit),
}));

const recordBreadcrumbMock = jest.fn();
jest.mock("@/lib/observability/syncBreadcrumb", () => ({
  recordSyncBreadcrumb: (payload: unknown) => recordBreadcrumbMock(payload),
}));

jest.mock("@/lib/observability/withSyncTransaction", () => ({
  withSyncTransaction: (
    _name: string,
    _op: string,
    fn: () => Promise<unknown> | unknown
  ) => fn(),
}));

// Minimal fake DB. Each `select().from(table).where(...)` resolves to a
// configurable array. Tests poke `dbState` to seed responses per-call.
type SelectFn = () => Promise<unknown[]>;
const dbState: {
  members: unknown[]; // leagueFamilyMembers rows
  leagues: unknown[]; // leagues rows (used twice — for getFamilyLastSyncedAt + ordering)
  family: unknown[]; // leagueFamilies rows
  syncJobs: unknown[]; // running syncJobs rows
} = {
  members: [],
  leagues: [],
  family: [],
  syncJobs: [],
};

function makeFakeSelect(rows: unknown[]): {
  from: () => {
    where: (..._args: unknown[]) => {
      limit: (_n: number) => Promise<unknown[]>;
      orderBy: (..._a: unknown[]) => { limit: (_n: number) => Promise<unknown[]> };
    } & Promise<unknown[]>;
  };
} {
  return {
    from: () => ({
      where: () => {
        const p: Promise<unknown[]> & {
          limit?: (_n: number) => Promise<unknown[]>;
          orderBy?: (..._a: unknown[]) => {
            limit: (_n: number) => Promise<unknown[]>;
          };
        } = Promise.resolve(rows) as Promise<unknown[]> & {
          limit?: (_n: number) => Promise<unknown[]>;
          orderBy?: (..._a: unknown[]) => {
            limit: (_n: number) => Promise<unknown[]>;
          };
        };
        p.limit = () => Promise.resolve(rows);
        p.orderBy = () => ({
          limit: () => Promise.resolve(rows),
        });
        return p as unknown as ReturnType<SelectFn> & {
          limit: (_n: number) => Promise<unknown[]>;
          orderBy: (..._a: unknown[]) => {
            limit: (_n: number) => Promise<unknown[]>;
          };
        };
      },
    }),
  };
}

const selectQueue: Array<keyof typeof dbState> = [];

const fakeDb = {
  select: (cols?: Record<string, unknown>) => {
    // Disambiguate which table the caller is reading by inspecting the
    // requested columns. The freshness module reads in this order:
    //   1. members (leagueFamilyMembers.leagueId)
    //   2. leagues  (leagues.lastSyncedAt)
    //   3. family   (leagueFamilies.rootLeagueId)
    //   4. syncJobs (syncJobs.id) for findRunningJobId
    //   5. members again (oldest-first list) for stale path
    if (!cols) return makeFakeSelect([]);
    const keys = Object.keys(cols);
    let key: keyof typeof dbState = "members";
    if (keys.includes("lastSyncedAt") && keys.length === 1) key = "leagues";
    else if (keys.includes("rootLeagueId")) key = "family";
    else if (keys.includes("id") && keys.length === 1) key = "syncJobs";
    else if (keys.includes("leagueId")) key = "members";
    selectQueue.push(key);
    return makeFakeSelect(dbState[key] as unknown[]);
  },
};

jest.mock("@/db", () => ({
  getDb: () => fakeDb,
  schema: {
    leagueFamilyMembers: {
      leagueId: "leagueId",
      season: "season",
      familyId: "familyId",
    },
    leagues: { id: "id", lastSyncedAt: "lastSyncedAt" },
    leagueFamilies: { id: "id", rootLeagueId: "rootLeagueId" },
    syncJobs: {
      id: "id",
      ref: "ref",
      status: "status",
      startedAt: "startedAt",
    },
  },
}));

// ---- Imports (after mocks) ------------------------------------------------

import {
  ensureLeagueFresh,
  freshnessWindowMs,
  isInSeason,
  IN_SEASON_FRESHNESS_MS,
  OFF_SEASON_FRESHNESS_MS,
} from "../freshness";

// ---- Test setup -----------------------------------------------------------

const FAMILY_ID = "11111111-1111-1111-1111-111111111111";
const ROOT_LEAGUE = "root-league-1";
const MEMBERS = [
  { leagueId: "lg-2024", season: "2024" },
  { leagueId: "lg-2025", season: "2025" },
];

beforeEach(() => {
  jest.clearAllMocks();
  resolveFamilyMock.mockReset();
  syncLeagueFamilyMock.mockReset();
  acquireSyncLockMock.mockReset();
  releaseSyncLockMock.mockReset();
  recordBreadcrumbMock.mockReset();
  selectQueue.length = 0;

  // Default happy-path resolution.
  resolveFamilyMock.mockResolvedValue(FAMILY_ID);
  // Default sync result — tests can override per case.
  syncLeagueFamilyMock.mockResolvedValue({ apiCallsMade: 0 });
  // Default: family row + members exist.
  dbState.family = [{ rootLeagueId: ROOT_LEAGUE }];
  dbState.members = MEMBERS;
  dbState.leagues = [];
  dbState.syncJobs = [];
});

// ---- isInSeason / windowMs ------------------------------------------------

describe("isInSeason", () => {
  it("Sept 1 is in-season (boundary, inclusive)", () => {
    expect(isInSeason(new Date("2025-09-01T12:00:00Z"))).toBe(true);
  });

  it("Aug 31 is off-season (just before boundary)", () => {
    expect(isInSeason(new Date("2025-08-31T12:00:00Z"))).toBe(false);
  });

  it("Jan 7 is in-season (boundary, inclusive)", () => {
    expect(isInSeason(new Date("2025-01-07T12:00:00Z"))).toBe(true);
  });

  it("Jan 8 is off-season", () => {
    expect(isInSeason(new Date("2025-01-08T12:00:00Z"))).toBe(false);
  });

  it("July is off-season", () => {
    expect(isInSeason(new Date("2025-07-15T12:00:00Z"))).toBe(false);
  });

  it("November is in-season", () => {
    expect(isInSeason(new Date("2025-11-15T12:00:00Z"))).toBe(true);
  });
});

describe("freshnessWindowMs", () => {
  it("returns 30 minutes in-season", () => {
    expect(freshnessWindowMs(new Date("2025-10-15T00:00:00Z"))).toBe(
      IN_SEASON_FRESHNESS_MS
    );
  });
  it("returns 1 hour off-season", () => {
    expect(freshnessWindowMs(new Date("2025-04-15T00:00:00Z"))).toBe(
      OFF_SEASON_FRESHNESS_MS
    );
  });
});

// ---- ensureLeagueFresh: state machine -------------------------------------

describe("ensureLeagueFresh — fresh path", () => {
  it("returning visitor in-window: no sync call", async () => {
    // Off-season: 1-hour window. Sync 5 minutes ago = fresh.
    const now = new Date("2025-04-15T12:00:00Z");
    const recent = new Date(now.getTime() - 5 * 60 * 1000);
    dbState.leagues = [
      { lastSyncedAt: recent },
      { lastSyncedAt: recent },
    ];

    const result = await ensureLeagueFresh(FAMILY_ID, { now });

    expect(result).toEqual({ ready: true, familyId: FAMILY_ID });
    expect(syncLeagueFamilyMock).not.toHaveBeenCalled();
    expect(acquireSyncLockMock).not.toHaveBeenCalled();
    expect(releaseSyncLockMock).not.toHaveBeenCalled();
  });

  it("in-season uses 30-minute window: 25min ago is fresh", async () => {
    const now = new Date("2025-10-15T12:00:00Z");
    const recent = new Date(now.getTime() - 25 * 60 * 1000);
    dbState.leagues = [{ lastSyncedAt: recent }];

    const result = await ensureLeagueFresh(FAMILY_ID, { now });

    expect(result.ready).toBe(true);
    expect(syncLeagueFamilyMock).not.toHaveBeenCalled();
  });

  it("in-season 35min ago is stale (window exceeded)", async () => {
    const now = new Date("2025-10-15T12:00:00Z");
    const stale = new Date(now.getTime() - 35 * 60 * 1000);
    dbState.leagues = [{ lastSyncedAt: stale }];
    acquireSyncLockMock.mockResolvedValue("job-stale-1");

    const result = await ensureLeagueFresh(FAMILY_ID, { now });

    expect(result.ready).toBe(true);
    expect(syncLeagueFamilyMock).toHaveBeenCalledTimes(1);
    expect(releaseSyncLockMock).toHaveBeenCalledWith(
      "job-stale-1",
      "success",
      undefined,
      { apiCallsMade: 0 }
    );
  });

  it("off-season 90min ago is stale (1-hour window exceeded)", async () => {
    const now = new Date("2025-04-15T12:00:00Z");
    const stale = new Date(now.getTime() - 90 * 60 * 1000);
    dbState.leagues = [{ lastSyncedAt: stale }];
    acquireSyncLockMock.mockResolvedValue("job-stale-2");

    const result = await ensureLeagueFresh(FAMILY_ID, { now });

    expect(result.ready).toBe(true);
    expect(syncLeagueFamilyMock).toHaveBeenCalledTimes(1);
  });
});

describe("ensureLeagueFresh — stale path", () => {
  it("past window: sync runs synchronously, then returns ready", async () => {
    const now = new Date("2025-04-15T12:00:00Z");
    const stale = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    dbState.leagues = [{ lastSyncedAt: stale }];
    acquireSyncLockMock.mockResolvedValue("job-1");

    const result = await ensureLeagueFresh(FAMILY_ID, { now });

    expect(result).toEqual({ ready: true, familyId: FAMILY_ID });
    expect(acquireSyncLockMock).toHaveBeenCalledWith(ROOT_LEAGUE, {
      trigger: "lazy",
    });
    expect(syncLeagueFamilyMock).toHaveBeenCalledTimes(1);
    expect(syncLeagueFamilyMock).toHaveBeenCalledWith(
      [MEMBERS[0].leagueId, MEMBERS[1].leagueId],
      undefined,
      FAMILY_ID,
      { trigger: "lazy" }
    );
    expect(releaseSyncLockMock).toHaveBeenCalledWith(
      "job-1",
      "success",
      undefined,
      { apiCallsMade: 0 }
    );
    expect(recordBreadcrumbMock).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "league-family",
        trigger: "lazy",
        scope: FAMILY_ID,
        outcome: "success",
      })
    );
  });

  it("threads apiCallsMade from syncLeagueFamily into releaseSyncLock + breadcrumb", async () => {
    const now = new Date("2025-04-15T12:00:00Z");
    const stale = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    dbState.leagues = [{ lastSyncedAt: stale }];
    acquireSyncLockMock.mockResolvedValue("job-counted-1");
    syncLeagueFamilyMock.mockResolvedValue({ apiCallsMade: 42 });

    await ensureLeagueFresh(FAMILY_ID, { now });

    expect(releaseSyncLockMock).toHaveBeenCalledWith(
      "job-counted-1",
      "success",
      undefined,
      { apiCallsMade: 42 }
    );
    expect(recordBreadcrumbMock).toHaveBeenCalledWith(
      expect.objectContaining({ apiCalls: 42, outcome: "success" })
    );
  });

  it("stale + sync throws: lock released as failed, page still renders", async () => {
    const now = new Date("2025-04-15T12:00:00Z");
    const stale = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    dbState.leagues = [{ lastSyncedAt: stale }];
    acquireSyncLockMock.mockResolvedValue("job-fail-1");
    syncLeagueFamilyMock.mockRejectedValue(new Error("boom"));

    const result = await ensureLeagueFresh(FAMILY_ID, { now });

    expect(result.ready).toBe(true);
    expect(releaseSyncLockMock).toHaveBeenCalledWith(
      "job-fail-1",
      "failed",
      "boom",
      { apiCallsMade: 0 }
    );
    expect(recordBreadcrumbMock).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "failed", error: "boom" })
    );
  });
});

describe("ensureLeagueFresh — cold path", () => {
  it("no row at all: jobId created, ready false, sync NOT awaited", async () => {
    const now = new Date("2025-04-15T12:00:00Z");
    // No member-leagues rows means cold.
    dbState.leagues = [];
    acquireSyncLockMock.mockResolvedValue("cold-job-1");

    const result = await ensureLeagueFresh(FAMILY_ID, { now });

    expect(result).toEqual({
      ready: false,
      familyId: FAMILY_ID,
      jobId: "cold-job-1",
    });
    // Cold path leaves the sync to the chunked executor (#151) — we do NOT
    // call syncLeagueFamily inline.
    expect(syncLeagueFamilyMock).not.toHaveBeenCalled();
    expect(releaseSyncLockMock).not.toHaveBeenCalled();
  });

  it("any league missing lastSyncedAt: treated as cold", async () => {
    const now = new Date("2025-04-15T12:00:00Z");
    dbState.leagues = [
      { lastSyncedAt: new Date(now.getTime() - 5 * 60 * 1000) },
      { lastSyncedAt: null },
    ];
    acquireSyncLockMock.mockResolvedValue("cold-job-2");

    const result = await ensureLeagueFresh(FAMILY_ID, { now });

    expect(result.ready).toBe(false);
    expect(result.jobId).toBe("cold-job-2");
    expect(syncLeagueFamilyMock).not.toHaveBeenCalled();
  });
});

describe("ensureLeagueFresh — concurrency", () => {
  it("cold + lock contended: returns the in-flight jobId", async () => {
    const now = new Date("2025-04-15T12:00:00Z");
    dbState.leagues = [];
    dbState.syncJobs = [{ id: "in-flight-1" }];
    acquireSyncLockMock.mockResolvedValue(null); // Lock contended

    const result = await ensureLeagueFresh(FAMILY_ID, { now });

    expect(result).toEqual({
      ready: false,
      familyId: FAMILY_ID,
      jobId: "in-flight-1",
    });
    expect(syncLeagueFamilyMock).not.toHaveBeenCalled();
  });

  it("stale + lock contended: degrades to ready (don't block on someone else)", async () => {
    const now = new Date("2025-04-15T12:00:00Z");
    const stale = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    dbState.leagues = [{ lastSyncedAt: stale }];
    acquireSyncLockMock.mockResolvedValue(null); // Lock contended

    const result = await ensureLeagueFresh(FAMILY_ID, { now });

    expect(result).toEqual({ ready: true, familyId: FAMILY_ID });
    expect(syncLeagueFamilyMock).not.toHaveBeenCalled();
  });

  it("two concurrent stale visitors: only one sync runs (lock honored)", async () => {
    const now = new Date("2025-04-15T12:00:00Z");
    const stale = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    dbState.leagues = [{ lastSyncedAt: stale }];

    // First call gets the lock; second is contended.
    acquireSyncLockMock
      .mockResolvedValueOnce("job-a")
      .mockResolvedValueOnce(null);

    const [a, b] = await Promise.all([
      ensureLeagueFresh(FAMILY_ID, { now }),
      ensureLeagueFresh(FAMILY_ID, { now }),
    ]);

    expect(a.ready).toBe(true);
    expect(b.ready).toBe(true);
    expect(syncLeagueFamilyMock).toHaveBeenCalledTimes(1);
    expect(releaseSyncLockMock).toHaveBeenCalledTimes(1);
  });
});

describe("ensureLeagueFresh — resolution", () => {
  it("unknown family resolves to null: ready=true, familyId=null (caller handles 404)", async () => {
    resolveFamilyMock.mockResolvedValue(null);

    const result = await ensureLeagueFresh("unknown-id");

    expect(result).toEqual({ ready: true, familyId: null });
    expect(acquireSyncLockMock).not.toHaveBeenCalled();
    expect(syncLeagueFamilyMock).not.toHaveBeenCalled();
  });
});
