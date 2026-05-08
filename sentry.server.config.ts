// Sentry Node.js server runtime initialization.
//
// Loaded by `instrumentation.ts` during the Next.js node runtime. Keeps the
// init DSN-driven so unconfigured environments (local dev without Sentry, CI,
// preview deploys before the DSN is wired) silently no-op.

import * as Sentry from "@sentry/nextjs";

const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  const sampleRate = Number(
    process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0.1",
  );

  Sentry.init({
    dsn,
    tracesSampleRate: Number.isFinite(sampleRate) ? sampleRate : 0.1,
    environment:
      process.env.SENTRY_ENVIRONMENT ??
      process.env.VERCEL_ENV ??
      process.env.NODE_ENV,
    debug: false,
  });
}
