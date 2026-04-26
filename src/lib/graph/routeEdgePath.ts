/**
 * Custom edge path routing that avoids node obstacles.
 *
 * Computes a smooth SVG path from source to target handle positions,
 * routing through the gutters between card columns to avoid crossing
 * over transaction card bodies.
 *
 * The layout is strictly left-to-right (source.x < target.x), so
 * routing is predictable: exit right, traverse gutters, enter left.
 */

export interface Obstacle {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Compute an SVG path string from source to target, routing around obstacles.
 *
 * For adjacent cards, draws a simple smooth bezier.
 * For non-adjacent cards, routes through the gutters between intermediate
 * cards to avoid crossing over card bodies.
 *
 * @param sx - Source handle X (right edge of source card)
 * @param sy - Source handle Y
 * @param tx - Target handle X (left edge of target card)
 * @param ty - Target handle Y
 * @param obstacles - Bounding boxes of all visible nodes between source and target
 * @param gutterOffset - Y offset in gutters to separate overlapping edges
 * @returns SVG path string + label position
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
  const dy = ty - sy;

  // Filter to only obstacles between source and target X range
  const between = obstacles.filter(
    (o) => o.x + o.width > sx && o.x < tx,
  );

  // Find gutters: gaps between card right-edges and next card left-edges
  // within the source→target X range
  const gutterXs = findGutters(sx, tx, between);

  // No intermediate cards — direct bezier
  if (gutterXs.length === 0 || Math.abs(dx) < 80) {
    return directBezier(sx, sy, tx, ty, gutterOffset);
  }

  // Route through gutters with waypoints
  return routeThroughGutters(sx, sy, tx, ty, gutterXs, between, gutterOffset);
}

/**
 * Find X coordinates of gutters (gaps between cards) in the source→target range.
 */
function findGutters(sx: number, tx: number, obstacles: Obstacle[]): number[] {
  if (obstacles.length === 0) return [];

  // Collect all card right-edges within range, sorted
  const rightEdges = obstacles
    .map((o) => o.x + o.width)
    .filter((rx) => rx > sx + 10 && rx < tx - 10)
    .sort((a, b) => a - b);

  // For each right-edge, the gutter center is midway to the next card's left-edge
  const gutters: number[] = [];
  for (const rx of rightEdges) {
    // Find the next obstacle whose left edge is to the right of this right edge
    const nextLeft = obstacles
      .map((o) => o.x)
      .filter((lx) => lx > rx + 1)
      .sort((a, b) => a - b)[0];

    if (nextLeft != null) {
      gutters.push((rx + nextLeft) / 2);
    } else {
      // No next card — gutter extends to target
      gutters.push(rx + 30);
    }
  }

  // Deduplicate gutters that are very close together
  const deduped: number[] = [];
  for (const g of gutters) {
    if (deduped.length === 0 || Math.abs(g - deduped[deduped.length - 1]) > 20) {
      deduped.push(g);
    }
  }

  return deduped;
}

/**
 * Simple smooth bezier for adjacent cards or short distances.
 */
function directBezier(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  gutterOffset: number,
): { path: string; labelX: number; labelY: number } {
  const dx = tx - sx;
  const midX = sx + dx / 2;
  const midY = (sy + ty) / 2 + gutterOffset;

  if (Math.abs(ty - sy) < 5) {
    // Nearly horizontal
    const cpOffset = Math.min(dx * 0.3, 40);
    const path = `M ${sx},${sy} C ${sx + cpOffset},${sy} ${tx - cpOffset},${ty} ${tx},${ty}`;
    return { path, labelX: midX, labelY: midY };
  }

  // S-curve for different Y positions
  const cpX = Math.min(dx * 0.4, 60);
  const path = `M ${sx},${sy} C ${sx + cpX},${sy} ${tx - cpX},${ty} ${tx},${ty}`;
  return { path, labelX: midX, labelY: midY };
}

/**
 * Route through intermediate gutters to avoid card collisions.
 * Creates a smooth polyline through gutter waypoints.
 */
function routeThroughGutters(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  gutterXs: number[],
  obstacles: Obstacle[],
  gutterOffset: number,
): { path: string; labelX: number; labelY: number } {
  // Build waypoints: at each gutter, compute a safe Y that avoids cards
  const waypoints: Array<{ x: number; y: number }> = [{ x: sx, y: sy }];

  // Linearly interpolate Y from source to target, with adjustments at each gutter
  const totalDx = tx - sx;

  for (const gx of gutterXs) {
    const t = (gx - sx) / totalDx;
    let gy = sy + (ty - sy) * t + gutterOffset;

    // Check if this Y would pass through any card at this X position
    // If so, route above or below the card
    for (const obs of obstacles) {
      if (gx >= obs.x - 5 && gx <= obs.x + obs.width + 5) {
        // The gutter is inside this card's X range — shouldn't happen
        // but route around if it does
        const cardTop = obs.y - 10;
        const cardBottom = obs.y + obs.height + 10;
        if (gy >= cardTop && gy <= cardBottom) {
          // Route above or below — pick whichever is closer
          const toTop = gy - cardTop;
          const toBottom = cardBottom - gy;
          gy = toTop < toBottom ? cardTop : cardBottom;
        }
      }
    }

    waypoints.push({ x: gx, y: gy });
  }

  waypoints.push({ x: tx, y: ty });

  // Build a smooth path through the waypoints using cubic bezier segments
  const path = smoothPathThroughPoints(waypoints);
  const mid = waypoints[Math.floor(waypoints.length / 2)];

  return { path, labelX: mid.x, labelY: mid.y };
}

/**
 * Create a smooth SVG path through a series of points using cubic bezier curves.
 * Each segment has control points that create smooth transitions.
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

    // Control points: extend horizontally from each endpoint
    // This creates smooth transitions that enter/exit each waypoint horizontally
    const cpLen = Math.min(dx * 0.35, 50);
    const cp1x = p0.x + cpLen;
    const cp1y = p0.y;
    const cp2x = p1.x - cpLen;
    const cp2y = p1.y;

    parts.push(`C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p1.x},${p1.y}`);
  }

  return parts.join(" ");
}
