/**
 * @jest-environment node
 */
import { notifyWaitlist, type NotifyDb } from "../notifyWaitlist";

interface TestRow {
  id: string;
  email: string;
  leagueId: string;
}

function makeDb(opts: {
  members: string[];
  pending: TestRow[];
  leagueNames?: Record<string, string>;
  markNotified?: (id: string) => Promise<void>;
}): NotifyDb {
  return {
    getMembers: async () => opts.members,
    getPending: async () => opts.pending,
    getLeagueName: async (lid) => opts.leagueNames?.[lid] ?? null,
    markNotified: opts.markNotified ?? (async () => {}),
  };
}

describe("notifyWaitlist", () => {
  it("resolves family_id to member league_ids and notifies all matching pending rows", async () => {
    const sent: Array<{ to: string; leagueName: string; familyId: string }> = [];
    const marked: string[] = [];
    const summary = await notifyWaitlist({
      familyId: "fam-1",
      db: makeDb({
        members: ["L1", "L2"],
        pending: [
          { id: "r1", email: "a@x.com", leagueId: "L1" },
          { id: "r2", email: "b@x.com", leagueId: "L2" },
        ],
        leagueNames: { L1: "Alpha", L2: "Beta" },
        markNotified: async (id) => {
          marked.push(id);
        },
      }),
      send: async (p) => {
        sent.push(p);
      },
      sleep: async () => {},
    });
    expect(sent).toHaveLength(2);
    expect(sent[0]).toEqual({
      to: "a@x.com",
      leagueName: "Alpha",
      familyId: "fam-1",
    });
    expect(sent[1]).toEqual({
      to: "b@x.com",
      leagueName: "Beta",
      familyId: "fam-1",
    });
    expect(marked).toEqual(["r1", "r2"]);
    expect(summary).toEqual({ notified: 2, unsent: [] });
  });

  it("skips already-notified rows because getPending only returns pending", async () => {
    const sent: Array<{ to: string }> = [];
    const summary = await notifyWaitlist({
      familyId: "fam-1",
      db: makeDb({
        members: ["L1"],
        pending: [], // notified rows excluded by query
      }),
      send: async (p) => {
        sent.push({ to: p.to });
      },
      sleep: async () => {},
    });
    expect(sent).toHaveLength(0);
    expect(summary.notified).toBe(0);
  });

  it("retries with exponential backoff on rate-limit errors", async () => {
    const sleeps: number[] = [];
    let attempts = 0;
    const summary = await notifyWaitlist({
      familyId: "fam-1",
      db: makeDb({
        members: ["L1"],
        pending: [{ id: "r1", email: "a@x.com", leagueId: "L1" }],
        leagueNames: { L1: "Alpha" },
      }),
      send: async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error("Too many requests (429)");
        }
        // Succeeds on attempt 3
      },
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    expect(attempts).toBe(3);
    expect(sleeps.slice(0, 2)).toEqual([1000, 2000]);
    expect(summary.notified).toBe(1);
  });

  it("after exhausting backoff, marks the row as unsent and continues", async () => {
    let attempts = 0;
    const summary = await notifyWaitlist({
      familyId: "fam-1",
      db: makeDb({
        members: ["L1"],
        pending: [
          { id: "r1", email: "a@x.com", leagueId: "L1" },
          { id: "r2", email: "b@x.com", leagueId: "L1" },
        ],
        leagueNames: { L1: "Alpha" },
      }),
      send: async (p) => {
        if (p.to === "a@x.com") {
          attempts++;
          throw new Error("429 Too Many Requests");
        }
      },
      sleep: async () => {},
    });
    // 1 initial + 4 backoff retries = 5 attempts
    expect(attempts).toBe(5);
    expect(summary.notified).toBe(1);
    expect(summary.unsent).toEqual(["r1"]);
  });

  it("on daily-cap exhaustion logs unsent IDs and exits cleanly", async () => {
    let calls = 0;
    const summary = await notifyWaitlist({
      familyId: "fam-1",
      db: makeDb({
        members: ["L1"],
        pending: [
          { id: "r1", email: "a@x.com", leagueId: "L1" },
          { id: "r2", email: "b@x.com", leagueId: "L1" },
          { id: "r3", email: "c@x.com", leagueId: "L1" },
        ],
        leagueNames: { L1: "Alpha" },
      }),
      send: async () => {
        calls++;
        throw new Error("Daily cap exceeded — quota reached");
      },
      sleep: async () => {},
    });
    expect(calls).toBe(1);
    expect(summary.notified).toBe(0);
    expect(summary.unsent).toEqual(["r1", "r2", "r3"]);
  });

  it("re-running with same family_id only processes still-pending rows", async () => {
    const sent: string[] = [];
    const summary = await notifyWaitlist({
      familyId: "fam-1",
      db: makeDb({
        members: ["L1", "L2"],
        // Only r2 is pending; r1 was already notified so excluded by query.
        pending: [{ id: "r2", email: "b@x.com", leagueId: "L2" }],
        leagueNames: { L1: "Alpha", L2: "Beta" },
      }),
      send: async (p) => {
        sent.push(p.to);
      },
      sleep: async () => {},
    });
    expect(sent).toEqual(["b@x.com"]);
    expect(summary.notified).toBe(1);
  });

  it("returns early when family has no member leagues", async () => {
    let sendCalls = 0;
    const summary = await notifyWaitlist({
      familyId: "fam-1",
      db: makeDb({ members: [], pending: [] }),
      send: async () => {
        sendCalls++;
      },
      sleep: async () => {},
    });
    expect(sendCalls).toBe(0);
    expect(summary).toEqual({ notified: 0, unsent: [] });
  });

  it("partial failure: rows sent before a failure stay marked", async () => {
    const marked: string[] = [];
    const summary = await notifyWaitlist({
      familyId: "fam-1",
      db: makeDb({
        members: ["L1"],
        pending: [
          { id: "r1", email: "a@x.com", leagueId: "L1" },
          { id: "r2", email: "b@x.com", leagueId: "L1" },
          { id: "r3", email: "c@x.com", leagueId: "L1" },
        ],
        leagueNames: { L1: "Alpha" },
        markNotified: async (id) => {
          marked.push(id);
        },
      }),
      send: async (p) => {
        if (p.to === "b@x.com") {
          throw new Error("Daily quota cap hit");
        }
      },
      sleep: async () => {},
    });
    // r1 sent + marked. r2 hits daily cap → exit cleanly, r2/r3 unsent.
    expect(marked).toEqual(["r1"]);
    expect(summary.notified).toBe(1);
    expect(summary.unsent).toEqual(["r2", "r3"]);
  });
});
