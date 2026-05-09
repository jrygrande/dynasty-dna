/**
 * @jest-environment node
 *
 * Unit tests for the family-scoped sync lock (acquireSyncLock / releaseSyncLock).
 *
 * Coverage targets:
 *   - acquire returns null when a non-stale running job exists (collision)
 *   - acquire inserts a new running job + returns its id when none exists
 *   - acquire marks stale running jobs as failed before inserting
 *   - release flips a job to success or failed with the supplied error
 */

jest.mock("@/db", () => {
  const stubColumn = (name: string) => ({ name });
  return {
    schema: {
      syncJobs: {
        id: stubColumn("id"),
        ref: stubColumn("ref"),
        status: stubColumn("status"),
        startedAt: stubColumn("started_at"),
        finishedAt: stubColumn("finished_at"),
        error: stubColumn("error"),
        type: stubColumn("type"),
      },
    },
    getDb: jest.fn(),
  };
});

jest.mock("drizzle-orm", () => ({
  eq: (col: { name: string }, value: unknown) => ({ op: "eq", col, value }),
  and: (...args: unknown[]) => ({ op: "and", args }),
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

import { getDb } from "@/db";
import {
  acquireSyncLock,
  releaseSyncLock,
  incrementSyncJobApiCalls,
  updateSyncJobStage,
} from "../syncLock";

const mockedGetDb = getDb as jest.MockedFunction<typeof getDb>;

interface DbCalls {
  selectResults: Array<{ id: string }>;
  updateSets: Array<Record<string, unknown>>;
  insertedValues: Array<Record<string, unknown>>;
  insertReturning: Array<{ id: string }>;
}

function buildDb(calls: DbCalls) {
  return {
    select: jest.fn(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() => ({
          limit: jest.fn(() => Promise.resolve(calls.selectResults)),
        })),
      })),
    })),
    update: jest.fn(() => ({
      set: jest.fn((s: Record<string, unknown>) => {
        calls.updateSets.push(s);
        return {
          where: jest.fn(() => Promise.resolve()),
        };
      }),
    })),
    insert: jest.fn(() => ({
      values: jest.fn((v: Record<string, unknown>) => {
        calls.insertedValues.push(v);
        return {
          returning: jest.fn(() => Promise.resolve(calls.insertReturning)),
        };
      }),
    })),
  };
}

describe("acquireSyncLock", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns null when a non-stale running job already exists", async () => {
    const calls: DbCalls = {
      selectResults: [{ id: "existing_job" }],
      updateSets: [],
      insertedValues: [],
      insertReturning: [],
    };
    const db = buildDb(calls);
    mockedGetDb.mockReturnValue(db as unknown as ReturnType<typeof getDb>);

    const result = await acquireSyncLock("family_root_1");
    expect(result).toBeNull();
    // Insert path must not have been touched.
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("inserts a new running job and returns its id when no running job exists", async () => {
    const calls: DbCalls = {
      selectResults: [],
      updateSets: [],
      insertedValues: [],
      insertReturning: [{ id: "new_job_id" }],
    };
    const db = buildDb(calls);
    mockedGetDb.mockReturnValue(db as unknown as ReturnType<typeof getDb>);

    const result = await acquireSyncLock("family_root_2");
    expect(result).toBe("new_job_id");
    expect(calls.insertedValues).toHaveLength(1);
    expect(calls.insertedValues[0]).toMatchObject({
      type: "league_sync",
      ref: "family_root_2",
      status: "running",
    });
  });

  it("marks stale running jobs as failed before inserting a new one", async () => {
    // No collision -> select returns empty -> we still issue the cleanup
    // update for any rows older than the stale threshold.
    const calls: DbCalls = {
      selectResults: [],
      updateSets: [],
      insertedValues: [],
      insertReturning: [{ id: "fresh_job" }],
    };
    const db = buildDb(calls);
    mockedGetDb.mockReturnValue(db as unknown as ReturnType<typeof getDb>);

    await acquireSyncLock("family_root_3");

    // The cleanup write set status=failed with a "stale job" error string.
    expect(calls.updateSets).toHaveLength(1);
    const set = calls.updateSets[0];
    expect(set.status).toBe("failed");
    expect(typeof set.error).toBe("string");
    expect((set.error as string).toLowerCase()).toContain("stale");
    expect(set.finishedAt).toBeInstanceOf(Date);
  });
});

describe("releaseSyncLock", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("updates the job to success and clears error", async () => {
    const calls: DbCalls = {
      selectResults: [],
      updateSets: [],
      insertedValues: [],
      insertReturning: [],
    };
    const db = buildDb(calls);
    mockedGetDb.mockReturnValue(db as unknown as ReturnType<typeof getDb>);

    await releaseSyncLock("job_1", "success");

    expect(calls.updateSets).toHaveLength(1);
    const set = calls.updateSets[0];
    expect(set.status).toBe("success");
    expect(set.error).toBeNull();
    expect(set.finishedAt).toBeInstanceOf(Date);
  });

  it("updates the job to failed with the supplied error message", async () => {
    const calls: DbCalls = {
      selectResults: [],
      updateSets: [],
      insertedValues: [],
      insertReturning: [],
    };
    const db = buildDb(calls);
    mockedGetDb.mockReturnValue(db as unknown as ReturnType<typeof getDb>);

    await releaseSyncLock("job_2", "failed", "kaboom");

    expect(calls.updateSets).toHaveLength(1);
    const set = calls.updateSets[0];
    expect(set.status).toBe("failed");
    expect(set.error).toBe("kaboom");
  });

  it("normalizes a missing error to null", async () => {
    const calls: DbCalls = {
      selectResults: [],
      updateSets: [],
      insertedValues: [],
      insertReturning: [],
    };
    const db = buildDb(calls);
    mockedGetDb.mockReturnValue(db as unknown as ReturnType<typeof getDb>);

    await releaseSyncLock("job_3", "failed");

    expect(calls.updateSets[0].error).toBeNull();
  });

  it("records audit fields (apiCallsMade, stagesCompleted) when provided", async () => {
    const calls: DbCalls = {
      selectResults: [],
      updateSets: [],
      insertedValues: [],
      insertReturning: [],
    };
    const db = buildDb(calls);
    mockedGetDb.mockReturnValue(db as unknown as ReturnType<typeof getDb>);

    await releaseSyncLock("job_x", "success", undefined, {
      apiCallsMade: 17,
      stagesCompleted: 3,
    });

    const set = calls.updateSets[0];
    expect(set.apiCallsMade).toBe(17);
    expect(set.stagesCompleted).toBe(3);
  });

  it("omits audit fields from the update when not provided", async () => {
    const calls: DbCalls = {
      selectResults: [],
      updateSets: [],
      insertedValues: [],
      insertReturning: [],
    };
    const db = buildDb(calls);
    mockedGetDb.mockReturnValue(db as unknown as ReturnType<typeof getDb>);

    await releaseSyncLock("job_y", "success");

    const set = calls.updateSets[0];
    expect("apiCallsMade" in set).toBe(false);
    expect("stagesCompleted" in set).toBe(false);
  });
});

describe("acquireSyncLock — trigger + stagesTotal options", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("defaults trigger to 'manual' and stagesTotal to null", async () => {
    const calls: DbCalls = {
      selectResults: [],
      updateSets: [],
      insertedValues: [],
      insertReturning: [{ id: "j1" }],
    };
    const db = buildDb(calls);
    mockedGetDb.mockReturnValue(db as unknown as ReturnType<typeof getDb>);

    await acquireSyncLock("family");
    expect(calls.insertedValues[0]).toMatchObject({
      trigger: "manual",
      stagesTotal: null,
    });
  });

  it("propagates trigger and stagesTotal when provided", async () => {
    const calls: DbCalls = {
      selectResults: [],
      updateSets: [],
      insertedValues: [],
      insertReturning: [{ id: "j2" }],
    };
    const db = buildDb(calls);
    mockedGetDb.mockReturnValue(db as unknown as ReturnType<typeof getDb>);

    await acquireSyncLock("family", { trigger: "cron", stagesTotal: 7 });
    expect(calls.insertedValues[0]).toMatchObject({
      trigger: "cron",
      stagesTotal: 7,
    });
  });
});

describe("incrementSyncJobApiCalls", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("issues an UPDATE with a sql expression bumping the counter", async () => {
    const calls: DbCalls = {
      selectResults: [],
      updateSets: [],
      insertedValues: [],
      insertReturning: [],
    };
    const db = buildDb(calls);
    mockedGetDb.mockReturnValue(db as unknown as ReturnType<typeof getDb>);

    await incrementSyncJobApiCalls("job_a", 3);
    expect(db.update).toHaveBeenCalledTimes(1);
    expect(calls.updateSets[0]).toHaveProperty("apiCallsMade");
  });

  it("noops on an empty jobId", async () => {
    const calls: DbCalls = {
      selectResults: [],
      updateSets: [],
      insertedValues: [],
      insertReturning: [],
    };
    const db = buildDb(calls);
    mockedGetDb.mockReturnValue(db as unknown as ReturnType<typeof getDb>);

    await incrementSyncJobApiCalls("");
    expect(db.update).not.toHaveBeenCalled();
  });

  it("swallows db errors so observability never breaks the caller", async () => {
    const failingDb = {
      update: jest.fn(() => ({
        set: jest.fn(() => ({
          where: jest.fn(() => Promise.reject(new Error("db down"))),
        })),
      })),
    };
    mockedGetDb.mockReturnValue(
      failingDb as unknown as ReturnType<typeof getDb>
    );

    await expect(incrementSyncJobApiCalls("job_x", 1)).resolves.toBeUndefined();
  });
});

describe("updateSyncJobStage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("records the new currentStage", async () => {
    const calls: DbCalls = {
      selectResults: [],
      updateSets: [],
      insertedValues: [],
      insertReturning: [],
    };
    const db = buildDb(calls);
    mockedGetDb.mockReturnValue(db as unknown as ReturnType<typeof getDb>);

    await updateSyncJobStage("job_a", "matchups");
    expect(calls.updateSets[0].currentStage).toBe("matchups");
    expect("stagesCompleted" in calls.updateSets[0]).toBe(false);
  });

  it("records stagesCompleted alongside currentStage when provided", async () => {
    const calls: DbCalls = {
      selectResults: [],
      updateSets: [],
      insertedValues: [],
      insertReturning: [],
    };
    const db = buildDb(calls);
    mockedGetDb.mockReturnValue(db as unknown as ReturnType<typeof getDb>);

    await updateSyncJobStage("job_a", "complete", 5);
    expect(calls.updateSets[0]).toMatchObject({
      currentStage: "complete",
      stagesCompleted: 5,
    });
  });

  it("uses a CAS-style WHERE when stagesCompleted is provided (concurrent-tick safety)", async () => {
    // bug_005 from ultrareview: concurrent ticks against the same jobId
    // both pass `if (status === "running")` and run runChunk in parallel.
    // A slow tick that finished stage 4 must NOT overwrite the cursor when
    // a fast tick already advanced it to 5. The CAS predicate
    // (`stages_completed IS NULL OR stages_completed < new`) makes Postgres
    // reject the late write atomically.
    const whereArgs: unknown[] = [];
    const failingDb = {
      update: jest.fn(() => ({
        set: jest.fn(() => ({
          where: jest.fn((arg: unknown) => {
            whereArgs.push(arg);
            return Promise.resolve();
          }),
        })),
      })),
    };
    mockedGetDb.mockReturnValue(
      failingDb as unknown as ReturnType<typeof getDb>
    );

    await updateSyncJobStage("job_a", "season 4 of 5", 4);

    // The where predicate must NOT be a plain eq(id) — it carries the
    // additional CAS clause as a tagged sql template.
    expect(whereArgs).toHaveLength(1);
    // The drizzle-orm mock at the top of this file produces `{ op: "sql",
    // strings, values }` for sql-tagged templates and `{ op: "eq", col,
    // value }` for eq(). The CAS path uses sql; the eq() path doesn't.
    const predicate = whereArgs[0] as { op: string; strings?: string[] };
    expect(predicate.op).toBe("sql");
    const text = (predicate.strings ?? []).join("?");
    expect(text).toContain(" < ");
    expect(text).toContain("IS NULL");
  });

  it("currentStage-only update (no stagesCompleted) uses simple eq() WHERE — no CAS overhead", async () => {
    // The label-only path is for slightly-stale stage labels. CAS would be
    // overkill there. Confirm it stays on the simple eq() predicate.
    const whereArgs: unknown[] = [];
    const db = {
      update: jest.fn(() => ({
        set: jest.fn(() => ({
          where: jest.fn((arg: unknown) => {
            whereArgs.push(arg);
            return Promise.resolve();
          }),
        })),
      })),
    };
    mockedGetDb.mockReturnValue(
      db as unknown as ReturnType<typeof getDb>
    );

    await updateSyncJobStage("job_a", "season 4 of 5");

    expect(whereArgs).toHaveLength(1);
    // Label-only updates take the cheap eq(id) path, not sql.
    const predicate = whereArgs[0] as { op: string };
    expect(predicate.op).toBe("eq");
  });

  it("noops on an empty jobId", async () => {
    const calls: DbCalls = {
      selectResults: [],
      updateSets: [],
      insertedValues: [],
      insertReturning: [],
    };
    const db = buildDb(calls);
    mockedGetDb.mockReturnValue(db as unknown as ReturnType<typeof getDb>);

    await updateSyncJobStage("", "matchups");
    expect(db.update).not.toHaveBeenCalled();
  });

  it("swallows db errors", async () => {
    const failingDb = {
      update: jest.fn(() => ({
        set: jest.fn(() => ({
          where: jest.fn(() => Promise.reject(new Error("db down"))),
        })),
      })),
    };
    mockedGetDb.mockReturnValue(
      failingDb as unknown as ReturnType<typeof getDb>
    );

    await expect(updateSyncJobStage("job_x", "stage")).resolves.toBeUndefined();
  });
});
