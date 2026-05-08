// Next.js 14+ instrumentation entry point.
//
// `register()` is invoked once per runtime when the server starts. We dispatch
// to the matching Sentry config so it initializes for the active runtime.
// Each config is itself DSN-driven: if no DSN is set the init call is skipped
// and Sentry is a no-op.

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}
