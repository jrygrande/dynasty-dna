/**
 * @jest-environment node
 */

import { run } from "../backfill-slot-to-roster-id";

interface FakeDraftRow {
  id: string;
  season: string;
  status: string | null;
  slotToRosterId: Record<string, number> | null;
}

function makeFakeDb(initial: FakeDraftRow[]) {
  // The script issues two SELECTs (full + null-only) and one UPDATE per
  // backfilled row. Drizzle's `.from()` and `.from().where()` are both
  // thenables; mirror that with PromiseLike so `await select(...).from(...)`
  // and `await select(...).from(...).where(...)` both resolve.
  const rows = initial.map((r) => ({ ...r }));
  const updates: Array<{ id: string; slotToRosterId: Record<string, number> }> = [];

  const thenable = <T,>(value: T): PromiseLike<T> => ({
    then: (onfulfilled, onrejected) => Promise.resolve(value).then(onfulfilled, onrejected),
  });

  return {
    db: {
      select: () => ({
        from: () => {
          const fullRows = rows.map((r) => ({ ...r }));
          return {
            ...thenable(fullRows),
            where: () => thenable(rows.filter((r) => r.slotToRosterId === null)),
          };
        },
      }),
      update: () => ({
        set: (s: { slotToRosterId: Record<string, number> }) => ({
          where: () => {
            const target = rows.find((r) => r.slotToRosterId === null);
            if (target) {
              target.slotToRosterId = s.slotToRosterId;
              updates.push({ id: target.id, slotToRosterId: s.slotToRosterId });
            }
            return Promise.resolve();
          },
        }),
      }),
    },
    rows,
    updates,
  };
}

describe("backfill-slot-to-roster-id", () => {
  it("dry-run does not call update; reports counts", async () => {
    const fake = makeFakeDb([
      { id: "D1", season: "2022", status: "complete", slotToRosterId: null },
      { id: "D2", season: "2023", status: "complete", slotToRosterId: { "1": 1 } },
    ]);
    const fetchDraft = jest.fn().mockResolvedValue({ slot_to_roster_id: { "1": 7 } });
    const logs: string[] = [];

    const stats = await run([], {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db: fake.db as any,
      fetchDraft,
      log: (m) => logs.push(m),
    });

    expect(stats.total).toBe(2);
    expect(stats.alreadyPopulated).toBe(1);
    expect(stats.fetched).toBe(1);
    expect(stats.updated).toBe(1);
    expect(stats.failed).toBe(0);
    expect(fetchDraft).toHaveBeenCalledWith("D1");
    expect(fake.updates).toHaveLength(0); // dry-run: no DB write
  });

  it("--apply persists slot_to_roster_id only for null rows", async () => {
    const fake = makeFakeDb([
      { id: "D1", season: "2022", status: "complete", slotToRosterId: null },
      { id: "D2", season: "2023", status: "complete", slotToRosterId: { "1": 1 } },
    ]);
    const fetchDraft = jest.fn().mockResolvedValue({ slot_to_roster_id: { "1": 7, "2": 8 } });

    const stats = await run(["--apply"], {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db: fake.db as any,
      fetchDraft,
      log: () => undefined,
    });

    expect(stats.updated).toBe(1);
    expect(fake.updates).toEqual([{ id: "D1", slotToRosterId: { "1": 7, "2": 8 } }]);
    expect(fetchDraft).toHaveBeenCalledTimes(1);
    expect(fetchDraft).toHaveBeenCalledWith("D1");
  });

  it("counts but does not write when API returns no slot_to_roster_id (pre-draft)", async () => {
    const fake = makeFakeDb([
      { id: "D1", season: "2027", status: "pre_draft", slotToRosterId: null },
    ]);
    const fetchDraft = jest.fn().mockResolvedValue({}); // no slot map yet

    const stats = await run(["--apply"], {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db: fake.db as any,
      fetchDraft,
      log: () => undefined,
    });

    expect(stats.fetched).toBe(1);
    expect(stats.updated).toBe(0);
    expect(stats.skippedNoMap).toBe(1);
    expect(fake.updates).toHaveLength(0);
  });

  it("isolates fetch failures and continues", async () => {
    const fake = makeFakeDb([
      { id: "D1", season: "2022", status: "complete", slotToRosterId: null },
      { id: "D2", season: "2023", status: "complete", slotToRosterId: null },
    ]);
    const fetchDraft = jest
      .fn()
      .mockRejectedValueOnce(new Error("Sleeper 503"))
      .mockResolvedValueOnce({ slot_to_roster_id: { "1": 5 } });

    const stats = await run(["--apply"], {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db: fake.db as any,
      fetchDraft,
      log: () => undefined,
    });

    expect(stats.failed).toBe(1);
    expect(stats.updated).toBe(1);
    expect(fake.updates).toHaveLength(1);
  });

  it("--help prints usage and returns zero counts", async () => {
    const fetchDraft = jest.fn();
    const logs: string[] = [];

    const stats = await run(["--help"], {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db: undefined as any,
      fetchDraft,
      log: (m) => logs.push(m),
    });

    expect(stats.total).toBe(0);
    expect(fetchDraft).not.toHaveBeenCalled();
    expect(logs.some((m) => m.includes("Usage"))).toBe(true);
  });
});
