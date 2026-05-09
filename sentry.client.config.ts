// Sentry browser/client runtime initialization.
//
// This file is loaded automatically by @sentry/nextjs when a request reaches
// the browser. We keep the config DSN-driven: when no DSN is set we skip
// `Sentry.init` entirely so the SDK is a true no-op in local dev / preview
// environments without observability wired up.
//
// Note: In a future Next.js / Turbopack-friendly migration this file should
// move to `instrumentation-client.ts` (see Sentry deprecation notice). Held
// off for now to keep this scaffold consistent with #152's spec.

import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  const sampleRate = Number(
    process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? "0.1",
  );

  Sentry.init({
    dsn,
    tracesSampleRate: Number.isFinite(sampleRate) ? sampleRate : 0.1,
    // Environment is used by Sentry for filtering / release health.
    environment:
      process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ??
      process.env.VERCEL_ENV ??
      process.env.NODE_ENV,
    // Keep replay/debug off by default; turn on per-environment when needed.
    debug: false,
  });
}
