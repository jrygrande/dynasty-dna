// Sync transaction wrapper.
//
// Wraps a sync function in a Sentry span so cron/lazy/manual sync runs show
// up as transactions in Sentry Performance. When no DSN is configured the
// wrapper is a passthrough — `fn` runs unchanged and its result/throw is
// returned/rethrown as-is.

import * as Sentry from "@sentry/nextjs";

function isDsnConfigured(): boolean {
  return Boolean(
    process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN,
  );
}

/**
 * Run `fn` inside a Sentry span named `name` with operation `op`. Returns
 * whatever `fn` returns (sync or async). When Sentry is unconfigured the
 * span is skipped and `fn` runs directly.
 */
export function withSyncTransaction<T>(
  name: string,
  op: string,
  fn: () => Promise<T> | T,
): Promise<T> | T {
  if (!isDsnConfigured()) {
    return fn();
  }

  try {
    return Sentry.startSpan({ name, op }, () => fn());
  } catch {
    // If Sentry itself misbehaves, never block the caller.
    return fn();
  }
}
