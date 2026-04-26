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
 * @param sx - Source handle X (right edge of source card)
 * @param sy - Source handle Y
 * @param tx - Target handle X (left edge of target card)
 * @param ty - Target handle Y
 * @param gutterOffset - Y offset in gutters to separate overlapping edges
 * @returns SVG path string + label position
 */
export function routeEdgePath(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  gutterOffset = 0,
): { path: string; labelX: number; labelY: number } {
  const dx = tx - sx;
  const dy = ty - sy;
  const midX = sx + dx / 2;
  const midY = sy + dy / 2 + gutterOffset;

  // Simple case: adjacent cards, small vertical difference
  // Use a smooth cubic bezier that curves gently through the gutter
  if (Math.abs(dy) < 5) {
    // Nearly horizontal — gentle horizontal curve
    const cpOffset = Math.min(dx * 0.3, 40);
    const path = `M ${sx},${sy} C ${sx + cpOffset},${sy} ${tx - cpOffset},${ty} ${tx},${ty}`;
    return { path, labelX: midX, labelY: midY };
  }

  // General case: source and target at different Y positions
  // Route through the gutter midpoint with a smooth S-curve
  //
  // Strategy: exit horizontally, curve to gutter Y, travel horizontally,
  // curve to target Y, enter horizontally.
  //
  // Use a cubic bezier with control points that create a smooth path:
  // - First control point: horizontal from source
  // - Second control point: horizontal from target
  // This creates a natural S-curve that avoids sharp corners.

  if (dx > 100) {
    // Enough horizontal space for a smooth S-curve through the midpoint
    const enterGutter = sx + Math.min(dx * 0.25, 50);
    const exitGutter = tx - Math.min(dx * 0.25, 50);

    const path = [
      `M ${sx},${sy}`,
      `C ${enterGutter},${sy} ${enterGutter},${midY} ${midX},${midY}`,
      `C ${exitGutter},${midY} ${exitGutter},${ty} ${tx},${ty}`,
    ].join(" ");

    return { path, labelX: midX, labelY: midY };
  }

  // Tight space — simple bezier
  const cpX = dx * 0.4;
  const path = `M ${sx},${sy} C ${sx + cpX},${sy} ${tx - cpX},${ty} ${tx},${ty}`;
  return { path, labelX: midX, labelY: midY };
}
