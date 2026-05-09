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
