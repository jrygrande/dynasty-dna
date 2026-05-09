/**
 * @jest-environment node
 *
 * Unit tests for the Sleeper API client (src/lib/sleeper.ts).
 *
 * Coverage targets:
 *   - rate limiter: every request flows through the queue (verified by
 *     observing the gap between consecutive fetches under load).
 *   - retry on 429/5xx: backoff retries up to 3 times, then surfaces the
 *     final error.
 *   - non-retryable status (e.g. 404): throws immediately on first failure.
 *   - method surface: each named API method maps to the correct URL path.
 *
 * Strategy: mock global.fetch at the module boundary. The module retains
 * state (queue, lastRequestTime) across tests, but resetModules() between
 * suites isolates the rate-limiter timing assertion from the cheaper
 * URL-routing assertions.
 */

const realFetch = global.fetch;

afterAll(() => {
  global.fetch = realFetch;
});

function jsonResponse(body: unknown, init: ResponseInit = { status: 200 }): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

describe("Sleeper API method routing", () => {
  // Each test resets modules so the queue/timing state is fresh.
  beforeEach(() => {
    jest.resetModules();
  });

  it("getUserByUsername hits /v1/user/:username", async () => {
    const fetchMock = jest.fn(() => Promise.resolve(jsonResponse({ user_id: "u1" })));
    global.fetch = fetchMock as unknown as typeof fetch;
    const { Sleeper } = await import("../sleeper");
    await Sleeper.getUserByUsername("ryan");
    expect(fetchMock).toHaveBeenCalledWith("https://api.sleeper.app/v1/user/ryan");
  });

  it("getUserById hits /v1/user/:id", async () => {
    const fetchMock = jest.fn(() => Promise.resolve(jsonResponse({})));
    global.fetch = fetchMock as unknown as typeof fetch;
    const { Sleeper } = await import("../sleeper");
    await Sleeper.getUserById("uid_123");
    expect(fetchMock).toHaveBeenCalledWith("https://api.sleeper.app/v1/user/uid_123");
  });

  it("getLeaguesByUser hits /v1/user/:id/leagues/nfl/:season", async () => {
    const fetchMock = jest.fn(() => Promise.resolve(jsonResponse([])));
    global.fetch = fetchMock as unknown as typeof fetch;
    const { Sleeper } = await import("../sleeper");
    await Sleeper.getLeaguesByUser("uid", "2024");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.sleeper.app/v1/user/uid/leagues/nfl/2024"
    );
  });

  it("getLeague hits /v1/league/:id", async () => {
    const fetchMock = jest.fn(() => Promise.resolve(jsonResponse({})));
    global.fetch = fetchMock as unknown as typeof fetch;
    const { Sleeper } = await import("../sleeper");
    await Sleeper.getLeague("L1");
    expect(fetchMock).toHaveBeenCalledWith("https://api.sleeper.app/v1/league/L1");
  });

  it("getRosters hits /v1/league/:id/rosters", async () => {
    const fetchMock = jest.fn(() => Promise.resolve(jsonResponse([])));
    global.fetch = fetchMock as unknown as typeof fetch;
    const { Sleeper } = await import("../sleeper");
    await Sleeper.getRosters("L1");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.sleeper.app/v1/league/L1/rosters"
    );
  });

  it("getLeagueUsers hits /v1/league/:id/users", async () => {
    const fetchMock = jest.fn(() => Promise.resolve(jsonResponse([])));
    global.fetch = fetchMock as unknown as typeof fetch;
    const { Sleeper } = await import("../sleeper");
    await Sleeper.getLeagueUsers("L1");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.sleeper.app/v1/league/L1/users"
    );
  });

  it("getMatchups hits /v1/league/:id/matchups/:week", async () => {
    const fetchMock = jest.fn(() => Promise.resolve(jsonResponse([])));
    global.fetch = fetchMock as unknown as typeof fetch;
    const { Sleeper } = await import("../sleeper");
    await Sleeper.getMatchups("L1", 5);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.sleeper.app/v1/league/L1/matchups/5"
    );
  });

  it("getTransactions hits /v1/league/:id/transactions/:week", async () => {
    const fetchMock = jest.fn(() => Promise.resolve(jsonResponse([])));
    global.fetch = fetchMock as unknown as typeof fetch;
    const { Sleeper } = await import("../sleeper");
    await Sleeper.getTransactions("L1", 7);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.sleeper.app/v1/league/L1/transactions/7"
    );
  });

  it("getDrafts hits /v1/league/:id/drafts", async () => {
    const fetchMock = jest.fn(() => Promise.resolve(jsonResponse([])));
    global.fetch = fetchMock as unknown as typeof fetch;
    const { Sleeper } = await import("../sleeper");
    await Sleeper.getDrafts("L1");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.sleeper.app/v1/league/L1/drafts"
    );
  });

  it("getDraft hits /v1/draft/:id (returns slot_to_roster_id)", async () => {
    const fetchMock = jest.fn(() => Promise.resolve(jsonResponse({})));
    global.fetch = fetchMock as unknown as typeof fetch;
    const { Sleeper } = await import("../sleeper");
    await Sleeper.getDraft("D1");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.sleeper.app/v1/draft/D1"
    );
  });

  it("getDraftPicks hits /v1/draft/:id/picks", async () => {
    const fetchMock = jest.fn(() => Promise.resolve(jsonResponse([])));
    global.fetch = fetchMock as unknown as typeof fetch;
    const { Sleeper } = await import("../sleeper");
    await Sleeper.getDraftPicks("D1");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.sleeper.app/v1/draft/D1/picks"
    );
  });

  it("getTradedPicks hits /v1/league/:id/traded_picks", async () => {
    const fetchMock = jest.fn(() => Promise.resolve(jsonResponse([])));
    global.fetch = fetchMock as unknown as typeof fetch;
    const { Sleeper } = await import("../sleeper");
    await Sleeper.getTradedPicks("L1");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.sleeper.app/v1/league/L1/traded_picks"
    );
  });

  it("getPlayers hits /v1/players/nfl", async () => {
    const fetchMock = jest.fn(() => Promise.resolve(jsonResponse({})));
    global.fetch = fetchMock as unknown as typeof fetch;
    const { Sleeper } = await import("../sleeper");
    await Sleeper.getPlayers();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.sleeper.app/v1/players/nfl"
    );
  });

  it("getNFLState hits /v1/state/nfl", async () => {
    const fetchMock = jest.fn(() =>
      Promise.resolve(jsonResponse({ season: 2024, week: 1 }))
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const { Sleeper } = await import("../sleeper");
    const result = await Sleeper.getNFLState();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.sleeper.app/v1/state/nfl"
    );
    expect(result).toEqual({ season: 2024, week: 1 });
  });

  it("getWinnersBracket hits /v1/league/:id/winners_bracket", async () => {
    const fetchMock = jest.fn(() => Promise.resolve(jsonResponse([])));
    global.fetch = fetchMock as unknown as typeof fetch;
    const { Sleeper } = await import("../sleeper");
    await Sleeper.getWinnersBracket("L1");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.sleeper.app/v1/league/L1/winners_bracket"
    );
  });
});

describe("Sleeper retry + error handling", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it("retries on 429 then succeeds", async () => {
    let calls = 0;
    const fetchMock = jest.fn(() => {
      calls++;
      if (calls === 1) {
        return Promise.resolve(new Response("rate limited", { status: 429 }));
      }
      return Promise.resolve(jsonResponse({ ok: true }));
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const { Sleeper } = await import("../sleeper");
    const result = await Sleeper.getLeague("L1");
    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries on 5xx then succeeds", async () => {
    let calls = 0;
    const fetchMock = jest.fn(() => {
      calls++;
      if (calls < 3) {
        return Promise.resolve(new Response("oops", { status: 503 }));
      }
      return Promise.resolve(jsonResponse({ ok: true }));
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const { Sleeper } = await import("../sleeper");
    const result = await Sleeper.getLeague("L1");
    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does NOT retry on 404 (non-retryable client error)", async () => {
    const fetchMock = jest.fn(() =>
      Promise.resolve(new Response("not found", { status: 404 }))
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const { Sleeper } = await import("../sleeper");
    await expect(Sleeper.getLeague("L_missing")).rejects.toThrow(/404/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives up after 4 attempts on persistent 5xx", async () => {
    const fetchMock = jest.fn(() =>
      Promise.resolve(new Response("internal", { status: 500 }))
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const { Sleeper } = await import("../sleeper");
    // Note: 1 initial + 3 retries = 4 attempts, exponential 1s/2s/4s waits.
    // We override Date.now-based timing? No — fetchWithRetry uses setTimeout
    // with literal ms values. To keep this test fast, we install fake timers.
    jest.useFakeTimers();

    const promise = Sleeper.getLeague("L1").catch((e) => e);
    // Advance through the 3 backoff sleeps (1s, 2s, 4s).
    await jest.advanceTimersByTimeAsync(1_000);
    await jest.advanceTimersByTimeAsync(2_000);
    await jest.advanceTimersByTimeAsync(4_000);
    const err = await promise;

    jest.useRealTimers();

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/500/);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});

describe("Sleeper rate limiter", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it("paces sequential requests to honor the 15 RPS cap (>=66ms gap)", async () => {
    // The limiter computes MIN_INTERVAL_MS = ceil(1000/15) = 67ms.
    // We sample wall-clock timestamps at the moment fetch is invoked and
    // verify each request after the first lags >=66ms behind its predecessor.
    const callTimes: number[] = [];
    const fetchMock = jest.fn(() => {
      callTimes.push(Date.now());
      return Promise.resolve(jsonResponse({ ok: true }));
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const { Sleeper } = await import("../sleeper");

    // Issue 4 sequential requests. With the limiter, each call after the
    // first is forced to wait ~67ms. 4 calls means ~200ms minimum total.
    await Sleeper.getLeague("L1");
    await Sleeper.getLeague("L2");
    await Sleeper.getLeague("L3");
    await Sleeper.getLeague("L4");

    expect(callTimes).toHaveLength(4);
    for (let i = 1; i < callTimes.length; i++) {
      const gap = callTimes[i] - callTimes[i - 1];
      // Allow 1ms slop for clock granularity.
      expect(gap).toBeGreaterThanOrEqual(66);
    }
  }, 10_000);

  it("queues concurrent callers behind the rate limit (in-flight bound applies)", async () => {
    const callTimes: number[] = [];
    const fetchMock = jest.fn(() => {
      callTimes.push(Date.now());
      return Promise.resolve(jsonResponse({ ok: true }));
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const { Sleeper } = await import("../sleeper");

    // Fire 3 concurrent calls. The limiter must still serialize them.
    await Promise.all([
      Sleeper.getLeague("L1"),
      Sleeper.getLeague("L2"),
      Sleeper.getLeague("L3"),
    ]);

    expect(callTimes).toHaveLength(3);
    expect(callTimes[1] - callTimes[0]).toBeGreaterThanOrEqual(66);
    expect(callTimes[2] - callTimes[1]).toBeGreaterThanOrEqual(66);
  }, 10_000);
});
