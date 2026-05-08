/**
 * @jest-environment node
 */
import { pMap, pMapSettled } from "../concurrency";

function defer<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("pMap", () => {
  it("preserves input order in results", async () => {
    const items = [10, 20, 30, 40, 50];
    const out = await pMap(
      items,
      async (n) => {
        // randomize completion order
        await new Promise((r) => setTimeout(r, Math.random() * 5));
        return n * 2;
      },
      3
    );
    expect(out).toEqual([20, 40, 60, 80, 100]);
  });

  it("never exceeds concurrency cap under stress (50 items, cap 5)", async () => {
    let inFlight = 0;
    let observedMax = 0;
    const N = 50;
    const items = Array.from({ length: N }, (_, i) => i);

    await pMap(
      items,
      async () => {
        inFlight++;
        observedMax = Math.max(observedMax, inFlight);
        await new Promise((r) => setTimeout(r, 5 + Math.random() * 5));
        inFlight--;
      },
      5
    );

    expect(observedMax).toBeLessThanOrEqual(5);
    expect(observedMax).toBeGreaterThan(1); // proof it actually parallelized
  });

  it("starts more than `cap` workers only after earlier ones complete", async () => {
    const cap = 3;
    const N = 6;
    const startedAt: number[] = [];
    const gates = Array.from({ length: N }, () => defer<void>());

    const promise = pMap(
      Array.from({ length: N }, (_, i) => i),
      async (i) => {
        startedAt.push(Date.now());
        await gates[i].promise;
        return i;
      },
      cap
    );

    // Yield once so the workers can start their first items.
    await new Promise((r) => setImmediate(r));
    expect(startedAt.length).toBe(cap);

    // Resolve the first item — frees one worker slot.
    gates[0].resolve();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(startedAt.length).toBe(cap + 1);

    // Resolve the rest.
    for (let i = 1; i < N; i++) gates[i].resolve();
    const result = await promise;
    expect(result).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("propagates errors via fail-fast", async () => {
    await expect(
      pMap(
        [1, 2, 3, 4],
        async (n) => {
          if (n === 2) throw new Error("boom");
          await new Promise((r) => setTimeout(r, 5));
          return n;
        },
        2
      )
    ).rejects.toThrow("boom");
  });
});

describe("pMapSettled", () => {
  it("returns one fulfilled/rejected entry per input, in order", async () => {
    const out = await pMapSettled(
      [1, 2, 3, 4],
      async (n) => {
        if (n === 2) throw new Error("nope");
        return n * 10;
      },
      2
    );

    expect(out).toHaveLength(4);
    expect(out[0]).toEqual({ status: "fulfilled", value: 10 });
    expect(out[1].status).toBe("rejected");
    expect((out[1] as { status: "rejected"; reason: Error }).reason.message).toBe("nope");
    expect(out[2]).toEqual({ status: "fulfilled", value: 30 });
    expect(out[3]).toEqual({ status: "fulfilled", value: 40 });
  });

  it("does not abort sibling work when one item fails", async () => {
    let completed = 0;
    const out = await pMapSettled(
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      async (n) => {
        if (n === 3) throw new Error("fail");
        await new Promise((r) => setTimeout(r, 1));
        completed++;
        return n;
      },
      3
    );

    expect(completed).toBe(9); // all but the failing one
    const failures = out.filter((r) => r.status === "rejected");
    expect(failures).toHaveLength(1);
  });

  it("respects concurrency cap under stress", async () => {
    let inFlight = 0;
    let observedMax = 0;

    await pMapSettled(
      Array.from({ length: 50 }, (_, i) => i),
      async () => {
        inFlight++;
        observedMax = Math.max(observedMax, inFlight);
        await new Promise((r) => setTimeout(r, 3));
        inFlight--;
        return null;
      },
      5
    );

    expect(observedMax).toBeLessThanOrEqual(5);
    expect(observedMax).toBeGreaterThan(1);
  });
});
