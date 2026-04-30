/**
 * Custom edge path routing that avoids node obstacles.
 *
 * Computes a smooth SVG path from source to target handle positions,
 * routing around (over or under) intermediate card rectangles so the
 * stroke never paints across a card body.
 *
 * The layout is strictly left-to-right (source.x < target.x). Obstacles
 * are expected to be sorted by `x` ascending — `AssetGraph` sorts them
 * once at the source so each per-edge call doesn't re-sort.
 */

export interface Obstacle {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Compute an SVG path string from source to target, routing around
 * obstacles. Obstacles must already be sorted by `x` ascending.
 */
export function routeEdgePath(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  obstacles: Obstacle[] = [],
  gutterOffset = 0,
): { path: string; labelX: number; labelY: number } {
  const dx = tx - sx;

  // 4px padding excludes the source/target cards themselves: their
  // right/left edges sit ~at sx/tx and would otherwise self-trigger
  // a detour.
  const between = obstacles.filter(
    (o) => o.x + o.width > sx + 4 && o.x < tx - 4,
  );

  if (between.length === 0 || Math.abs(dx) < 80) {
    return directBezier(sx, sy, tx, ty, between, gutterOffset);
  }
  return routeThroughObstacles(sx, sy, tx, ty, between, gutterOffset);
}

/**
 * Liang–Barsky line clip against an axis-aligned box, expanded by `pad`.
 * Returns the first obstacle the segment crosses, or null.
 */
function segmentCrossesObstacle(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  obstacles: Obstacle[],
  pad = 8,
): Obstacle | null {
  const dx = tx - sx;
  const dy = ty - sy;
  for (const o of obstacles) {
    const p = [-dx, dx, -dy, dy];
    const q = [sx - (o.x - pad), o.x + o.width + pad - sx, sy - (o.y - pad), o.y + o.height + pad - sy];
    let t0 = 0;
    let t1 = 1;
    let crosses = true;
    for (let i = 0; i < 4; i++) {
      if (p[i] === 0) {
        if (q[i] < 0) { crosses = false; break; }
        continue;
      }
      const r = q[i] / p[i];
      if (p[i] < 0) {
        if (r > t1) { crosses = false; break; }
        if (r > t0) t0 = r;
      } else {
        if (r < t0) { crosses = false; break; }
        if (r < t1) t1 = r;
      }
    }
    if (crosses) return o;
  }
  return null;
}

/** Pick a Y above or below the obstacle, whichever is closer to `refY`. */
function pickDetourY(obs: Obstacle, refY: number, margin: number): number {
  const overY = obs.y - margin;
  const underY = obs.y + obs.height + margin;
  return Math.abs(refY - overY) <= Math.abs(refY - underY) ? overY : underY;
}

/**
 * Smooth bezier between two endpoints. If a card sits directly between
 * them, bracket the obstacle with two waypoints at the detour Y so the
 * curve can't dive back into it on its descent to the target.
 */
function directBezier(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  obstacles: Obstacle[],
  gutterOffset: number,
): { path: string; labelX: number; labelY: number } {
  const dx = tx - sx;
  const midX = sx + dx / 2;
  const midY = (sy + ty) / 2 + gutterOffset;

  const blocker = segmentCrossesObstacle(sx, sy, tx, ty, obstacles);
  if (blocker) {
    const margin = 18;
    const detourY = pickDetourY(blocker, (sy + ty) / 2, margin) + gutterOffset;
    const leftX = Math.max(sx + 10, blocker.x - margin);
    const rightX = Math.min(tx - 10, blocker.x + blocker.width + margin);
    const waypoints = [
      { x: sx, y: sy },
      { x: leftX, y: detourY },
      { x: rightX, y: detourY },
      { x: tx, y: ty },
    ];
    return {
      path: smoothPathThroughPoints(waypoints),
      labelX: (leftX + rightX) / 2,
      labelY: detourY,
    };
  }

  if (Math.abs(ty - sy) < 5) {
    const cpOffset = dx * 0.4;
    const path = `M ${sx},${sy} C ${sx + cpOffset},${sy} ${tx - cpOffset},${ty} ${tx},${ty}`;
    return { path, labelX: midX, labelY: midY };
  }

  // S-curve. Control reach scales with both dx and dy — capping at 60
  // (the prior value) made long sweeps kink.
  const cpX = Math.max(dx * 0.5, Math.abs(ty - sy) * 0.4);
  const path = `M ${sx},${sy} C ${sx + cpX},${sy} ${tx - cpX},${ty} ${tx},${ty}`;
  return { path, labelX: midX, labelY: midY };
}

/**
 * For each obstacle whose vertical band overlaps the linearly-interpolated
 * source→target path, drop a pair of waypoints at the obstacle's left and
 * right edges. Bracketing both edges keeps the bezier between waypoints
 * clear of the obstacle — a single midpoint waypoint dives back through
 * when source and target share a Y inside the obstacle's vertical range.
 */
function routeThroughObstacles(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  obstacles: Obstacle[],
  gutterOffset: number,
): { path: string; labelX: number; labelY: number } {
  const waypoints: Array<{ x: number; y: number }> = [{ x: sx, y: sy }];
  const totalDx = tx - sx;
  const margin = 18;

  for (const obs of obstacles) {
    const midX = obs.x + obs.width / 2;
    const tMid = (midX - sx) / totalDx;
    const interpY = sy + (ty - sy) * tMid + gutterOffset;
    if (interpY < obs.y - 4 || interpY > obs.y + obs.height + 4) continue;

    const detourY = pickDetourY(obs, interpY, margin);
    const leftX = obs.x - margin;
    const rightX = obs.x + obs.width + margin;
    const last = waypoints[waypoints.length - 1]!;
    if (leftX > last.x + 2) waypoints.push({ x: leftX, y: detourY });
    waypoints.push({ x: rightX, y: detourY });
  }

  waypoints.push({ x: tx, y: ty });

  const path = smoothPathThroughPoints(waypoints);
  const mid = waypoints[Math.floor(waypoints.length / 2)]!;

  return { path, labelX: mid.x, labelY: mid.y };
}

/**
 * Cubic-bezier polyline through a series of points. Each segment's
 * control points extend horizontally from each endpoint so adjacent
 * segments join smoothly.
 */
function smoothPathThroughPoints(points: Array<{ x: number; y: number }>): string {
  if (points.length < 2) return "";
  if (points.length === 2) {
    const [a, b] = points;
    const dx = b.x - a.x;
    const cpX = Math.min(dx * 0.4, 60);
    return `M ${a.x},${a.y} C ${a.x + cpX},${a.y} ${b.x - cpX},${b.y} ${b.x},${b.y}`;
  }

  const parts: string[] = [`M ${points[0].x},${points[0].y}`];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;

    // Control reach scales with both dx and dy — the prior cap of 50 made
    // long, vertical-offset sweeps look kinked.
    const cpLen = Math.max(dx * 0.5, Math.abs(dy) * 0.4);
    parts.push(
      `C ${p0.x + cpLen},${p0.y} ${p1.x - cpLen},${p1.y} ${p1.x},${p1.y}`,
    );
  }

  return parts.join(" ");
}
