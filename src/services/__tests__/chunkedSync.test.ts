/**
 * @jest-environment node
 *
 * Unit tests for the chunked sync executor (#151).
 *
 * Coverage targets:
 *   - `runChunk` advances stages until the deadline, then yields
 *   - `runChunk` resumes from `stagesCompleted` cursor (idempotent)
 *   - Stage failures throw — the cursor stays put so the next tick retries
 *   - When every stage has run, returns `status: "completed"`
 *   - On the very first tick we persist `stages_total` before any work
 */

const stubColumn = (name: string) => ({ name });

jest.mock("@/db", () => ({
  schema: {
    syncJobs: {
      id: stubColumn("id"),
      stagesCompleted: stubColumn("stages_completed"),
      stagesTotal: stubColumn("stages_total"),
      currentStage: stubColumn("current_stage"),
    },
    leagueFamilyMembers: {
      leagueId: stubColumn("league_id"),
      season: stubColumn("season"),
    },
  },
  getDb: jest.fn(),
}));

jest.mock("drizzle-orm", () => ({
  eq: (col: { name: string }, value: unknown) => ({ op: "eq", col, value }),
  inArray: (col: { name: string }, values: unknown[]) => ({
    op: "inArray",
    col,
    values,
  }),
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

const updateSyncJobStageMock = jest.fn();
jest.mock("@/services/syncLock", () => ({
  updateSyncJobStage: (...args: unknown[]) => updateSyncJobStageMock(...args),
}));

// Stub every downstream sync helper — the executor wires them, but we
// don't exercise them here.
jest.mock("@/services/sync", () => ({
  syncLeague: jest.fn(),
}));
jest.mock("@/services/playerSync", () => ({
  syncPlayers: jest.fn(),
}));
jest.mock("@/services/fantasyCalcSync", () => ({
  syncFantasyCalcValues: jest.fn(),
}));
jest.mock("@/services/rosterStatusSync", () => ({
  syncRosterStatus: jest.fn(),
}));
jest.mock("@/services/injurySync", () => ({
  syncInjuries: jest.fn(),
}));
jest.mock("@/services/scheduleSync", () => ({
  syncSchedule: jest.fn(),
}));
jest.mock("@/services/managerGrades", () => ({
  rollupManagerGrades: jest.fn(),
}));

import { getDb } from "@/db";
import { runChunk, type ChunkedStage } from "../chunkedSync";

const mockedGetDb = getDb as jest.MockedFunction<typeof getDb>;

interface DbState {
  cursor: number;
  updates: Array<Record<string, unknown>>;
}

function makeMockDb(initialCursor: number): DbState {
  const state: DbState = { cursor: initialCursor, updates: [] };
  const dbStub = {
    select: jest.fn(() => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([{ stagesCompleted: state.cursor }]),
        }),
      }),
    })),
    update: jest.fn(() => ({
      set: (values: Record<string, unknown>) => {
        state.updates.push(values);
        return {
          where: () => Promise.resolve(undefined),
        };
      },
    })),
  };
  mockedGetDb.mockReturnValue(
    dbStub as unknown as ReturnType<typeof getDb>
  );
  return state;
}

function makeStage(key: string, runImpl?: () => Promise<void>): ChunkedStage {
  return {
    key,
    label: `stage:${key}`,
    run: runImpl ?? jest.fn(async () => {}),
  };
}

describe("runChunk", () => {
  beforeEach(() => {
    updateSyncJobStageMock.mockReset();
    mockedGetDb.mockReset();
  });

  test("runs every stage to completion when budget is generous", async () => {
    const state = makeMockDb(0);
    const stages = [makeStage("a"), makeStage("b"), makeStage("c")];

    const result = await runChunk("job-1", stages, {
      deadlineAt: Date.now() + 60_000,
    });

    expect(result.status).toBe("completed");
    expect(result.stagesCompleted).toBe(3);
    expect(result.stagesTotal).toBe(3);
    expect(result.currentStageLabel).toBeNull();
    // Each stage gets a "started" + "finished" update.
    expect(updateSyncJobStageMock).toHaveBeenCalledTimes(stages.length * 2);
    // First update writes the total + initial label.
    expect(state.updates[0]).toMatchObject({
      stagesTotal: 3,
      currentStage: "stage:a",
    });
  });

  test("yields cleanly when the deadline is reached between stages", async () => {
    makeMockDb(0);
    const stages = [
      makeStage("a"),
      makeStage("b", async () => {
        // Push the clock past the deadline mid-execution so the loop
        // exits before the next stage starts.
        const real = Date.now;
        Date.now = () => real() + 30_000;
      }),
      makeStage("c"),
    ];

    const result = await runChunk("job-1", stages, {
      deadlineAt: Date.now() + 1_000,
    });

    expect(result.status).toBe("in_progress");
    expect(result.stagesCompleted).toBe(2);
    expect(result.currentStageKey).toBe("c");
    expect(result.currentStageLabel).toBe("stage:c");

    // restore Date.now
    Date.now = Date.now.bind(Date);
  });

  test("resumes from the persisted cursor on a follow-up tick", async () => {
    const state = makeMockDb(2); // first 2 stages already done
    const stages = [makeStage("a"), makeStage("b"), makeStage("c"), makeStage("d")];

    // Track which stages actually ran so we can assert idempotency.
    const ran: string[] = [];
    stages.forEach((s) => {
      const original = s.run;
      s.run = async () => {
        ran.push(s.key);
        await original();
      };
    });

    const result = await runChunk("job-1", stages, {
      deadlineAt: Date.now() + 60_000,
    });

    expect(ran).toEqual(["c", "d"]);
    expect(result.status).toBe("completed");
    expect(result.stagesCompleted).toBe(4);
    // Initial label set should be the *resumed* stage, not stage 'a'.
    expect(state.updates[0]).toMatchObject({ currentStage: "stage:c" });
  });

  test("rethrows on stage failure and leaves cursor untouched", async () => {
    makeMockDb(0);
    const stages = [
      makeStage("a"),
      makeStage("b", async () => {
        throw new Error("boom");
      }),
      makeStage("c"),
    ];

    await expect(
      runChunk("job-1", stages, { deadlineAt: Date.now() + 60_000 })
    ).rejects.toThrow(/boom/);

    // Stage A's `updateSyncJobStage` calls fired (started + finished),
    // and stage B's "started" call fired, but the post-stage-B
    // increment never happened because the run threw.
    const stageBumps = updateSyncJobStageMock.mock.calls.filter(
      (c) => c[1] === "stage:c"
    );
    expect(stageBumps).toHaveLength(0);
  });

  test("returns completed immediately when stages list is empty", async () => {
    makeMockDb(0);
    const result = await runChunk("job-1", [], {
      deadlineAt: Date.now() + 60_000,
    });
    expect(result.status).toBe("completed");
    expect(result.stagesTotal).toBe(0);
    expect(result.stagesCompleted).toBe(0);
  });

  test("uses startFromCursor override when supplied (test ergonomics)", async () => {
    makeMockDb(0);
    const stages = [makeStage("a"), makeStage("b"), makeStage("c")];
    const result = await runChunk("job-1", stages, {
      deadlineAt: Date.now() + 60_000,
      startFromCursor: 2,
    });
    expect(result.status).toBe("completed");
    expect(result.stagesCompleted).toBe(3);
  });
});
