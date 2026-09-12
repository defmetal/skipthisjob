import { NextRequest } from 'next/server';
import { corsResponse } from './cors';

/**
 * Soft in-memory rate limiter for Vercel serverless.
 *
 * Limits are per-isolate (not globally coordinated). That is enough to
 * blunt abusive floods from a single client without persisting IPs.
 * Request IPs are hashed in memory only and never written to the DB.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
const MAX_KEYS = 4000;

function djb2(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h) ^ input.charCodeAt(i);
  }
  return (h >>> 0).toString(16);
}

export function hashClientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for') || '';
  const ip = forwarded.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || request.headers.get('cf-connecting-ip')
    || 'unknown';
  return djb2(ip);
}

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): { ok: boolean; remaining: number; retryAfterSec: number } {
  const now = Date.now();

  if (buckets.size > MAX_KEYS) {
    buckets.forEach((b, k) => {
      if (b.resetAt <= now) buckets.delete(k);
    });
    if (buckets.size > MAX_KEYS) {
      const first = buckets.keys().next().value;
      if (first) buckets.delete(first);
    }
  }

  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1, retryAfterSec: Math.ceil(windowMs / 1000) };
  }

  existing.count += 1;
  const retryAfterSec = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
  if (existing.count > limit) {
    return { ok: false, remaining: 0, retryAfterSec };
  }
  return { ok: true, remaining: limit - existing.count, retryAfterSec };
}

export function rateLimitResponse(retryAfterSec: number) {
  const res = corsResponse(
    { error: 'Too many requests', retryAfterSec },
    429
  );
  res.headers.set('Retry-After', String(retryAfterSec));
  return res;
}

export function enforceRateLimit(
  request: NextRequest,
  scope: string,
  limit: number,
  windowMs: number,
  extraKey?: string
) {
  const ipHash = hashClientIp(request);
  const primary = rateLimit(`${scope}:${ipHash}`, limit, windowMs);
  if (!primary.ok) return { ok: false as const, response: rateLimitResponse(primary.retryAfterSec) };

  if (extraKey) {
    const secondary = rateLimit(`${scope}:x:${djb2(extraKey)}`, Math.max(3, Math.floor(limit / 2)), windowMs);
    if (!secondary.ok) return { ok: false as const, response: rateLimitResponse(secondary.retryAfterSec) };
  }

  return { ok: true as const };
}
