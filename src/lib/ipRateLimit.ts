import type { NextRequest } from "next/server";

const SWEEP_THRESHOLD = 1024;

export function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

export interface RateLimitOptions {
  max: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSec: number;
}

export function createIpRateLimiter({ max, windowMs }: RateLimitOptions) {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  return function check(ip: string): RateLimitResult {
    const now = Date.now();
    if (buckets.size >= SWEEP_THRESHOLD) {
      for (const [k, v] of buckets) if (v.resetAt < now) buckets.delete(k);
    }
    const bucket = buckets.get(ip);
    if (!bucket || bucket.resetAt < now) {
      buckets.set(ip, { count: 1, resetAt: now + windowMs });
      return { allowed: true, retryAfterSec: 0 };
    }
    if (bucket.count >= max) {
      return {
        allowed: false,
        retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
      };
    }
    bucket.count += 1;
    return { allowed: true, retryAfterSec: 0 };
  };
}
