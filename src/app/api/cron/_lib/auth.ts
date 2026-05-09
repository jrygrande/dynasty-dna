// Shared bearer-token auth for /api/cron/* routes.
//
// Vercel Cron forwards a request with `Authorization: Bearer $CRON_SECRET`
// when configured via the `crons` block in vercel.json. We reject any caller
// that does not present the matching token. This is the only thing standing
// between the public internet and these endpoints, so it must be applied
// uniformly across every cron route.

import { NextRequest } from "next/server";

/**
 * Returns true when the request carries a valid bearer token matching
 * `CRON_SECRET`. False otherwise — including when the env var is unset
 * (fail closed, never fail open).
 */
export function isAuthorizedCron(req: NextRequest | Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;

  const header = req.headers.get("authorization") ?? "";
  if (!header.toLowerCase().startsWith("bearer ")) return false;

  const token = header.slice(7).trim();
  return token === expected;
}

/**
 * Returns true when the request's `Origin` header matches its `Host` —
 * i.e., it was issued by a browser navigating the same deployment.
 * Used to gate routes that have a legitimate in-app caller (page.tsx
 * auto-warm) without requiring a session/cookie auth layer.
 *
 * Browsers enforce same-origin: evil-site.com cannot forge Origin to
 * match our deployment. Non-browser callers (curl, server-to-server)
 * typically don't send Origin and must bearer-auth instead. Acceptable
 * model for an unauthenticated read-only product whose only mutation
 * trigger is "warm a league a user is currently viewing."
 */
export function isSameOriginRequest(req: NextRequest | Request): boolean {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
