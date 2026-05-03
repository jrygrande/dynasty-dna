import {
  buildDemoMap,
  COACHES_ELITE,
  COACHES_FALLBACK_POOL,
  COACHES_FLAMEOUT,
  COACHES_MID,
  initialsFromName,
  mulberry32,
  seedToInt,
  shuffle,
  TEAM_NAMES,
  TEAM_NAMES_TAIL,
  tierSplit,
} from "../demoAnonymize";

describe("mulberry32", () => {
  it("is deterministic for a given seed", () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    for (let i = 0; i < 10; i++) expect(a()).toBe(b());
  });

  it("yields different sequences for different seeds", () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    let identical = true;
    for (let i = 0; i < 5; i++) {
      if (a() !== b()) identical = false;
    }
    expect(identical).toBe(false);
  });
});

describe("seedToInt", () => {
  it("produces stable ints across calls", () => {
    expect(seedToInt("abc123")).toBe(seedToInt("abc123"));
  });
  it("differs across different strings", () => {
    expect(seedToInt("a")).not.toBe(seedToInt("b"));
  });
});

describe("shuffle", () => {
  it("returns a permutation of the input", () => {
    const rand = mulberry32(42);
    const out = shuffle([1, 2, 3, 4, 5], rand);
    expect(out.slice().sort()).toEqual([1, 2, 3, 4, 5]);
  });
  it("does not mutate the input", () => {
    const input = [1, 2, 3];
    const rand = mulberry32(7);
    shuffle(input, rand);
    expect(input).toEqual([1, 2, 3]);
  });
});

describe("initialsFromName", () => {
  it("returns first letters of two tokens", () => {
    expect(initialsFromName("Bill Belichick")).toBe("BB");
    expect(initialsFromName("Vince Lombardi")).toBe("VL");
  });
  it("handles single names", () => {
    expect(initialsFromName("Pele")).toBe("PE");
  });
  it("handles extra whitespace", () => {
    expect(initialsFromName("  Tom  Landry  ")).toBe("TL");
  });
  it("handles empty input", () => {
    expect(initialsFromName("")).toBe("??");
  });
});

describe("tierSplit", () => {
  it("12 teams => 4/4/4", () => {
    expect(tierSplit(12)).toEqual([4, 4, 4]);
  });
  it("11 teams => 3/5/3", () => {
    expect(tierSplit(11)).toEqual([3, 5, 3]);
  });
  it("10 teams => 3/4/3", () => {
    expect(tierSplit(10)).toEqual([3, 4, 3]);
  });
  it("9 teams => 3/3/3", () => {
    expect(tierSplit(9)).toEqual([3, 3, 3]);
  });
});

describe("buildDemoMap", () => {
  function makeManagers(scores: Array<number | null>) {
    return scores.map((s, i) => ({
      userId: `user_${String(i).padStart(2, "0")}`,
      score: s,
    }));
  }
  function makeRosters(n: number, owners?: Array<string | null>) {
    return Array.from({ length: n }, (_, i) => ({
      rosterId: i + 1,
      ownerId: owners?.[i] ?? `user_${String(i).padStart(2, "0")}`,
    }));
  }

  it("is deterministic for a given seed", () => {
    const m = makeManagers([90, 80, 70, 60, 50, 40, 30, 20, 10, 5, 4, 3]);
    const r = makeRosters(12);
    const a = buildDemoMap(m, r, "seed-x");
    const b = buildDemoMap(m, r, "seed-x");
    for (const [uid, swap] of a.users) {
      expect(b.users.get(uid)).toEqual(swap);
    }
  });

  it("varies across seeds", () => {
    const m = makeManagers([90, 80, 70, 60, 50, 40, 30, 20, 10, 5, 4, 3]);
    const r = makeRosters(12);
    const a = buildDemoMap(m, r, "seed-a");
    const b = buildDemoMap(m, r, "seed-b");
    let differs = false;
    for (const [uid, swap] of a.users) {
      if (b.users.get(uid)?.displayName !== swap.displayName) differs = true;
    }
    expect(differs).toBe(true);
  });

  it("maps the top scorer to the elite tier and the bottom to flame-out", () => {
    const m = makeManagers([90, 80, 70, 60, 50, 40, 30, 20, 10, 5, 4, 3]);
    const r = makeRosters(12);
    const map = buildDemoMap(m, r, "seed-tier");
    const top = map.users.get("user_00")!;
    const bottom = map.users.get("user_11")!;
    expect((COACHES_ELITE as readonly string[])).toContain(top.displayName);
    expect((COACHES_FLAMEOUT as readonly string[])).toContain(
      bottom.displayName
    );
  });

  it("uses tiebreaker on userId ASC when scores collide", () => {
    const m = [
      { userId: "user_z", score: 50 },
      { userId: "user_a", score: 50 },
      { userId: "user_b", score: 50 },
    ];
    const r = [
      { rosterId: 1, ownerId: "user_z" },
      { rosterId: 2, ownerId: "user_a" },
      { rosterId: 3, ownerId: "user_b" },
    ];
    // 3 managers => tier sizes 1/1/1. user_a comes first by ASC tiebreaker,
    // then user_b, then user_z.
    const map = buildDemoMap(m, r, "tiebreak");
    expect((COACHES_ELITE as readonly string[])).toContain(
      map.users.get("user_a")!.displayName
    );
    expect((COACHES_FLAMEOUT as readonly string[])).toContain(
      map.users.get("user_z")!.displayName
    );
    expect((COACHES_MID as readonly string[])).toContain(
      map.users.get("user_b")!.displayName
    );
  });

  it("falls back to flat-pool when any manager is missing a score", () => {
    const m = [
      { userId: "user_00", score: 90 },
      { userId: "user_01", score: null }, // triggers fallback for the whole league
      { userId: "user_02", score: 60 },
    ];
    const r = [
      { rosterId: 1, ownerId: "user_00" },
      { rosterId: 2, ownerId: "user_01" },
      { rosterId: 3, ownerId: "user_02" },
    ];
    const map = buildDemoMap(m, r, "fallback-seed");
    for (const swap of map.users.values()) {
      expect((COACHES_FALLBACK_POOL as readonly string[])).toContain(
        swap.displayName
      );
    }
  });

  it("assigns teams in roster_id ASC order, stable across calls", () => {
    const m = makeManagers([90, 80, 70]);
    const r = [
      { rosterId: 3, ownerId: "user_02" },
      { rosterId: 1, ownerId: "user_00" },
      { rosterId: 2, ownerId: "user_01" },
    ];
    const a = buildDemoMap(m, r, "team-seed");
    const b = buildDemoMap(m, r, "team-seed");
    for (const [rid, val] of a.rosters) {
      expect(b.rosters.get(rid)).toEqual(val);
    }
    // All roster team names come from the curated team pool.
    for (const val of a.rosters.values()) {
      expect((TEAM_NAMES as readonly string[])).toContain(val.teamName);
    }
  });

  it("pads team pool with the tail for leagues larger than 12", () => {
    const m = makeManagers(Array.from({ length: 14 }, (_, i) => 100 - i));
    const r = makeRosters(14);
    const map = buildDemoMap(m, r, "big-league");
    const allTeams = Array.from(map.rosters.values()).map((v) => v.teamName);
    const distinct = new Set(allTeams);
    expect(distinct.size).toBe(14);
    const allowed = new Set<string>([...TEAM_NAMES, ...TEAM_NAMES_TAIL]);
    for (const t of allTeams) expect(allowed.has(t)).toBe(true);
  });

  it("populates byRoster with the matching coach swap", () => {
    const m = makeManagers([90, 80, 70]);
    const r = makeRosters(3);
    const map = buildDemoMap(m, r, "by-roster");
    for (const roster of r) {
      const expected = map.users.get(roster.ownerId)!;
      expect(map.byRoster.get(roster.rosterId)).toEqual(expected);
    }
  });
});
