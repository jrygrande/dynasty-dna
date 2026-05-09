import { withSentryConfig } from "@sentry/nextjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
};

// `withSentryConfig` is safe to apply unconditionally — when neither a DSN
// nor `SENTRY_AUTH_TOKEN` is set at build time it skips sourcemap uploads
// silently and otherwise behaves as a passthrough. Runtime no-op behavior
// is enforced by the per-runtime configs (sentry.{client,server,edge}.config.ts).
const sentryBuildOptions = {
  // Quiet build logs unless something goes wrong.
  silent: true,
};

export default withSentryConfig(nextConfig, sentryBuildOptions);
