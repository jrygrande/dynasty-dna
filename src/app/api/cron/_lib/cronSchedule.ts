/**
 * Helpers for cron schedule gating that can't be expressed in Vercel's
 * cron syntax (Hobby plan caps at daily; we approximate monthly etc.
 * inside the route).
 */

/**
 * True on the first Sunday of any month (UTC). The nflverse-historical
 * cron is registered as `0 9 * * 0` (every Sunday) and gates on this
 * to approximate monthly cadence.
 */
export function isFirstSundayOfMonth(now: Date = new Date()): boolean {
  if (now.getUTCDay() !== 0) return false; // 0 = Sunday in UTC
  return now.getUTCDate() <= 7;
}
