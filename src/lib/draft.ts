/**
 * Shared draft pick resolution utilities.
 * Used by both the trade grading engine and the transactions API.
 */

/**
 * Find the original draft slot for a given roster ID from a slot→rosterId map.
 */
export function findOriginalSlot(
  slotMap: Record<string, number>,
  rosterId: number,
): number | null {
  for (const [slot, rid] of Object.entries(slotMap)) {
    if (rid === rosterId) {
      return parseInt(slot, 10);
    }
  }
  return null;
}

/**
 * Calculate the overall pick number given round, slot, total rosters, and draft type.
 * For snake drafts, even rounds reverse the order.
 */
export function calculatePickNumber(
  round: number,
  originalSlot: number,
  totalRosters: number,
  isSnake: boolean,
): number {
  if (isSnake && round % 2 === 0) {
    return (round - 1) * totalRosters + (totalRosters + 1 - originalSlot);
  }
  return (round - 1) * totalRosters + originalSlot;
}
