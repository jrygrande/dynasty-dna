import {
  benchmarkSeason,
  discoverFamily,
  makeContext,
  makeFixtureFetch,
  makeRecordingFetch,
  runBenchmark,
} from "../benchmark-cold-sync";

const SLEEPER = "https://api.sleeper.app/v1";

/**
 * A minimal fixture for a 2-season league family. Covers every URL the
 * benchmark touches per season: league/users/rosters/drafts/draft picks/
 * traded picks/18 transactions/18 matchups/winners_bracket.
 */
function buildFixture(): Record<string, unknown> {
  const fixture: Record<string, unknown> = {};
  const seasons = [
    { id: "L_2024", season: "2024", previous: "L_2023" },
    { id: "L_2023", season: "2023", previous: null as string | null },
  ];

  // League family chain — discoverFamily walks previous_league_id.
  for (const s of seasons) {
    fixture[`${SLEEPER}/league/${s.id}`] = {
      league_id: s.id,
      season: s.season,
      previous_league_id: s.previous,
    };
  }

  // Per-season cold-sync calls.
  for (const s of seasons) {
    fixture[`${SLEEPER}/league/${s.id}/users`] = [];
    fixture[`${SLEEPER}/league/${s.id}/rosters`] = [];
    fixture[`${SLEEPER}/league/${s.id}/drafts`] = [{ draft_id: `D_${s.season}` }];
    fixture[`${SLEEPER}/draft/D_${s.season}/picks`] = [];
    fixture[`${SLEEPER}/draft/D_${s.season}/traded_picks`] = [];
    fixture[`${SLEEPER}/league/${s.id}/traded_picks`] = [];
    for (let w = 1; w <= 18; w++) {
      fixture[`${SLEEPER}/league/${s.id}/transactions/${w}`] = [];
      fixture[`${SLEEPER}/league/${s.id}/matchups/${w}`] = [];
    }
    fixture[`${SLEEPER}/league/${s.id}/winners_bracket`] = [];
  }

  return fixture;
}

describe("makeFixtureFetch", () => {
  it("returns recorded body for known URLs (status 200)", async () => {
    const fetchImpl = makeFixtureFetch({
      "https://example.com/a": { hello: "world" },
    });
    const res = await fetchImpl("https://example.com/a");
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ hello: "world" });
  });

  it("treats null entries as 404 (matches liveFetch contract)", async () => {
    const fetchImpl = makeFixtureFetch({
      "https://example.com/missing": null,
    });
    const res = await fetchImpl("https://example.com/missing");
    expect(res.ok).toBe(false);
    expect(res.status).toBe(404);
  });

  it("throws on unknown URLs so missing fixture entries fail loudly", async () => {
    const fetchImpl = makeFixtureFetch({});
    await expect(fetchImpl("https://example.com/unknown")).rejects.toThrow(
      /Fixture missing entry/,
    );
  });

  it("never invokes global fetch", async () => {
    const realFetch = global.fetch;
    const fetchSpy = jest.fn();
    // @ts-expect-error narrowing
    global.fetch = fetchSpy;
    try {
      const fetchImpl = makeFixtureFetch({ "https://example.com/x": [] });
      await fetchImpl("https://example.com/x");
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      global.fetch = realFetch;
    }
  });
});

describe("benchmark with fixture fetch", () => {
  it("discoverFamily walks previous_league_id and returns chronological order", async () => {
    const fixture = buildFixture();
    const ctx = makeContext(makeFixtureFetch(fixture));
    const chain = await discoverFamily(ctx, "L_2024");
    expect(chain.map((c) => c.season)).toEqual(["2023", "2024"]);
  });

  it("benchmarkSeason makes the expected call count for one season", async () => {
    const fixture = buildFixture();
    const ctx = makeContext(makeFixtureFetch(fixture));
    const league = { league_id: "L_2024", season: "2024", previous_league_id: "L_2023" };
    // Seed the call count to 0 by using a fresh ctx (already at 0).
    const result = await benchmarkSeason(ctx, league);
    // Expected: users + rosters + drafts(1) + 1 draft picks + 1 traded picks
    //         + traded_picks + 18 transactions + 18 matchups + winners_bracket
    //         = 1 + 1 + 1 + 1 + 1 + 1 + 18 + 18 + 1 = 43
    expect(result.calls).toBe(43);
    expect(result.season).toBe("2024");
    expect(result.leagueId).toBe("L_2024");
    expect(typeof result.wall_time_ms).toBe("number");
  });

  it("runBenchmark produces a stable, fully populated summary", async () => {
    const fixture = buildFixture();
    const summary = await runBenchmark(makeFixtureFetch(fixture), "L_2024");
    expect(summary.leagueId).toBe("L_2024");
    expect(summary.seasons).toHaveLength(2);
    // Per season = 43; family discovery adds 2 league lookups (2024, 2023, then
    // discoverFamily probes the null previous and bails before a 3rd call).
    // benchmarkSeason calls = 43 each → total_calls counts those 86.
    expect(summary.total_calls).toBe(86);
    expect(summary.avg_calls_per_season).toBe(43);
    expect(summary.wall_time_ms).toBeGreaterThanOrEqual(0);
  });
});

describe("makeRecordingFetch", () => {
  it("captures successful responses into the recording map", async () => {
    const recording: Record<string, unknown> = {};
    const inner = makeFixtureFetch({
      "https://example.com/a": { ok: true },
    });
    const wrapped = makeRecordingFetch(inner, recording);
    const res = await wrapped("https://example.com/a");
    await res.json();
    expect(recording["https://example.com/a"]).toEqual({ ok: true });
  });

  it("captures 404s as null", async () => {
    const recording: Record<string, unknown> = {};
    const inner = makeFixtureFetch({
      "https://example.com/missing": null,
    });
    const wrapped = makeRecordingFetch(inner, recording);
    await wrapped("https://example.com/missing");
    expect(recording["https://example.com/missing"]).toBeNull();
  });
});
