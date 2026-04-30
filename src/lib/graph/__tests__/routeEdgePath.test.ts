/**
 * @jest-environment node
 *
 * Routing invariants for `routeEdgePath`. These guard the wrap-around
 * cases called out by issue #78 — when a card sits between source and
 * target, the path must detour around it instead of slicing through.
 */

import { routeEdgePath, type Obstacle } from "../routeEdgePath";

declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (value: unknown) => {
  toBe: (expected: unknown) => void;
  toContain: (expected: string) => void;
  toBeLessThan: (expected: number) => void;
  toBeGreaterThan: (expected: number) => void;
  toBeGreaterThanOrEqual: (expected: number) => void;
  toBeLessThanOrEqual: (expected: number) => void;
};

/** Sample N points along the cubic-bezier path string and check none lands
 *  inside an obstacle's expanded box. Used as a coarse "edge does not
 *  cross card body" assertion. */
function pathSamples(d: string, n = 40): Array<{ x: number; y: number }> {
  // Parse the path: starts with "M sx,sy" then "C c1x,c1y c2x,c2y x,y" segments.
  const parts = d.trim().split(/\s+/);
  let i = 0;
  const segments: Array<{
    p0: { x: number; y: number };
    c1: { x: number; y: number };
    c2: { x: number; y: number };
    p1: { x: number; y: number };
  }> = [];
  let cur: { x: number; y: number } | null = null;
  while (i < parts.length) {
    const cmd = parts[i++]!;
    if (cmd === "M") {
      const [x, y] = parts[i++]!.split(",").map(Number);
      cur = { x: x!, y: y! };
    } else if (cmd === "C") {
      const [c1x, c1y] = parts[i++]!.split(",").map(Number);
      const [c2x, c2y] = parts[i++]!.split(",").map(Number);
      const [x, y] = parts[i++]!.split(",").map(Number);
      const p1 = { x: x!, y: y! };
      segments.push({
        p0: cur!,
        c1: { x: c1x!, y: c1y! },
        c2: { x: c2x!, y: c2y! },
        p1,
      });
      cur = p1;
    } else {
      i++;
    }
  }
  const out: Array<{ x: number; y: number }> = [];
  for (const seg of segments) {
    for (let s = 0; s < n; s++) {
      const t = s / (n - 1);
      const u = 1 - t;
      const x =
        u * u * u * seg.p0.x +
        3 * u * u * t * seg.c1.x +
        3 * u * t * t * seg.c2.x +
        t * t * t * seg.p1.x;
      const y =
        u * u * u * seg.p0.y +
        3 * u * u * t * seg.c1.y +
        3 * u * t * t * seg.c2.y +
        t * t * t * seg.p1.y;
      out.push({ x, y });
    }
  }
  return out;
}

function pointInObstacle(p: { x: number; y: number }, o: Obstacle, pad = 0): boolean {
  return (
    p.x >= o.x - pad &&
    p.x <= o.x + o.width + pad &&
    p.y >= o.y - pad &&
    p.y <= o.y + o.height + pad
  );
}

describe("routeEdgePath", () => {
  it("draws a direct curve when no obstacles are in the way", () => {
    const result = routeEdgePath(0, 0, 400, 0, []);
    expect(result.path).toContain("M 0,0");
  });

  it("detours around a card sitting directly between source and target", () => {
    // Source at (0, 100), target at (600, 100). A card sits between them
    // at x=200..460, y=60..160. A direct horizontal curve would slice
    // through it — the router must bend over or under.
    const blocker: Obstacle = { x: 200, y: 60, width: 260, height: 100 };
    const result = routeEdgePath(0, 100, 600, 100, [blocker]);
    const samples = pathSamples(result.path);
    const intrusions = samples.filter((p) => pointInObstacle(p, blocker, -2));
    expect(intrusions.length).toBe(0);
  });

  it("ignores obstacles that aren't in the source→target X range", () => {
    // Card sits to the left of source — should be a no-op.
    const offscreen: Obstacle = { x: -500, y: 0, width: 100, height: 100 };
    const result = routeEdgePath(0, 0, 400, 0, [offscreen]);
    expect(result.path).toContain("M 0,0");
  });

  it("does not treat the source/target cards themselves as obstacles", () => {
    // Source card occupies x=-260..0; target occupies x=400..660. Both
    // touch the source/target X boundary but should not trigger detours.
    const sourceCard: Obstacle = { x: -260, y: -50, width: 260, height: 100 };
    const targetCard: Obstacle = { x: 400, y: -50, width: 260, height: 100 };
    const result = routeEdgePath(0, 0, 400, 0, [sourceCard, targetCard]);
    // No detour — should be a plain bezier without an extra waypoint.
    // A direct bezier has exactly one C segment.
    const cCount = (result.path.match(/C/g) ?? []).length;
    expect(cCount).toBe(1);
  });

  it("avoids two cards lined up horizontally between source and target", () => {
    // Two blockers in a row at the same Y. The router must keep the path
    // above (or below) both, not weave through.
    const a: Obstacle = { x: 150, y: 60, width: 200, height: 100 };
    const b: Obstacle = { x: 400, y: 60, width: 200, height: 100 };
    const result = routeEdgePath(0, 100, 800, 100, [a, b]);
    const samples = pathSamples(result.path);
    const intrusions = samples.filter(
      (p) => pointInObstacle(p, a, -2) || pointInObstacle(p, b, -2),
    );
    expect(intrusions.length).toBe(0);
  });

  it("preserves edge endpoints exactly so React Flow's marker lines up", () => {
    // The path must start at (sx, sy) and end at (tx, ty). The cubic-bezier
    // endpoints are written verbatim into the path string, so this is a
    // string-shape assertion — guards against off-by-one drift in the
    // detour code that would leave the arrowhead floating away from the
    // target handle.
    const blocker: Obstacle = { x: 200, y: 60, width: 260, height: 100 };
    const { path } = routeEdgePath(0, 100, 600, 100, [blocker]);
    expect(path.startsWith("M 0,100")).toBe(true);
    expect(path.endsWith("600,100")).toBe(true);
  });
});
