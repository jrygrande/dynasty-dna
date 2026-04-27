/**
 * @jest-environment node
 *
 * Basic sanity coverage for the analytics stub. The sink itself is a
 * no-op in node and a console.debug in the browser, so these tests
 * mostly assert that the function never throws and that the server-side
 * branch is safe.
 *
 * When Phase 0.5 Jest setup lands (see jest.config.js in this repo),
 * this file becomes runnable via `npm test`. Until @types/jest is
 * installed, the minimal ambient declarations below keep this file
 * compiling under the project's strict tsconfig.
 */

import { trackEvent } from "../analytics";

// Minimal ambient declarations so this file typechecks before
// @types/jest is installed as part of Phase 0.5 Jest setup.
// These are shadowed by the real @types/jest when it lands.
declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (value: unknown) => {
  not: { toThrow: () => void };
  toBe: (expected: unknown) => void;
};

describe("trackEvent", () => {
  it("does not throw for a known event name", () => {
    expect(() =>
      trackEvent("graph_view_opened", {
        familyId: "x",
        from: "overview",
        nodeCount: 0,
        edgeCount: 0,
        season: "2025",
      })
    ).not.toThrow();
  });

  it("does not throw for an unknown event name", () => {
    // String-typed fallback exists for non-graph callers; must not throw.
    expect(() => trackEvent("some_other_event", { foo: "bar" })).not.toThrow();
  });

  it("is a no-op on the server (window undefined)", () => {
    // jest-environment node → window is undefined.
    // trackEvent should return without logging or throwing.
    expect(typeof window).toBe("undefined");
    expect(() => trackEvent("graph_link_copied")).not.toThrow();
  });

  it("accepts calls with no props argument", () => {
    expect(() => trackEvent("graph_mobile_bounce")).not.toThrow();
  });
});
