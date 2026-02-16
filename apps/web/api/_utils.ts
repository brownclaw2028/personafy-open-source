import { createHash, randomBytes, randomUUID } from 'crypto';
import type { IncomingMessage, IncomingHttpHeaders, ServerResponse } from 'http';
import { isEncryptedEnvelope } from '../src/lib/vault-crypto-types';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const REST_BASE = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1` : null;
const AUTH_BASE = SUPABASE_URL ? `${SUPABASE_URL}/auth/v1` : null;

export interface ApiRequest extends IncomingMessage {
  method?: string;
  headers: IncomingHttpHeaders;
  body?: unknown;
  query?: Record<string, string | string[] | undefined>;
}

export type ApiResponse = ServerResponse<IncomingMessage>;
export interface ApiUser {
  id: string;
  [key: string]: unknown;
}

export function ensureSupabaseEnv() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !REST_BASE || !AUTH_BASE) {
    throw new Error('Supabase env not configured');
  }
}

function adminHeaders(extra?: Record<string, string>) {
  ensureSupabaseEnv();
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY as string,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    ...extra,
  };
}

const RETRY_STATUS_CODES = new Set([502, 503, 504]);
const MAX_RETRIES = 2;
const BACKOFF_MS = [200, 600];

export async function supabaseRest(path: string, options?: RequestInit) {
  ensureSupabaseEnv();
  const url = `${REST_BASE}/${path}`;
  const fetchOpts: RequestInit = {
    ...options,
    headers: {
      ...adminHeaders(),
      ...(options?.headers ?? {}),
    },
  };

  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, fetchOpts);
      if (res.ok || !RETRY_STATUS_CODES.has(res.status)) {
        return res;
      }
      // Transient server error — retry if attempts remain
      lastError = new Error(`Supabase returned ${res.status}`);
    } catch (err) {
      // Network error (DNS, connection reset, etc.) — retry
      lastError = err;
    }
    if (attempt < MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt]));
    }
  }
  throw lastError;
}

export async function fetchUserFromToken(token: string): Promise<ApiUser | null> {
  ensureSupabaseEnv();
  const res = await fetch(`${AUTH_BASE}/user`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY as string,
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) return null;
  const payload = await res.json();
  if (!payload || typeof payload !== 'object') return null;
  const user = payload as Partial<ApiUser>;
  if (typeof user.id !== 'string' || user.id.length === 0) return null;
  return user as ApiUser;
}

export function json(res: ApiResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export function getBearerToken(req: ApiRequest): string | null {
  const raw = req.headers?.authorization ?? req.headers?.Authorization;
  if (typeof raw !== 'string') return null;
  const [type, token] = raw.split(' ');
  if (type !== 'Bearer' || !token) return null;
  return token.trim();
}

export function getErrorMessage(err: unknown, fallback = 'Server error'): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/**
 * Returns a generic error message suitable for sending to clients.
 * Logs the detailed error server-side for debugging via requestId correlation.
 */
export function safeErrorMessage(requestId: string, detailedError: string): string {
  console.error(JSON.stringify({ requestId, error: detailedError, timestamp: new Date().toISOString() }));
  return 'Internal server error';
}

export async function parseApiError(res: Response, fallback = 'Supabase request failed'): Promise<string> {
  try {
    const payload = await res.json();
    if (!payload || typeof payload !== 'object') return fallback;
    const parsed = payload as { message?: unknown; error?: unknown };
    if (typeof parsed.message === 'string' && parsed.message.trim()) return parsed.message;
    if (typeof parsed.error === 'string' && parsed.error.trim()) return parsed.error;
    return fallback;
  } catch {
    return fallback;
  }
}

export async function requireUser(req: ApiRequest, res: ApiResponse): Promise<ApiUser | null> {
  const token = getBearerToken(req);
  if (!token) {
    json(res, 401, { error: 'Missing Authorization token' });
    return null;
  }
  const user = await fetchUserFromToken(token);
  if (!user?.id) {
    json(res, 401, { error: 'Invalid or expired token' });
    return null;
  }
  return user;
}

export { isEncryptedEnvelope };

export function ensureObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function generatePairingCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(8);
  const seg = (offset: number, n: number) =>
    Array.from({ length: n }, (_, i) => chars[bytes[offset + i] % chars.length]).join('');
  return `PFY-${seg(0, 4)}-${seg(4, 4)}`;
}

export function generateDeviceToken(): string {
  return randomBytes(32).toString('hex');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// ─── IP-based rate limiting ────────────────────────────────────────────────
// TODO: The in-memory Map (`rateLimitStore`) is per-function-instance and does
// NOT persist across Vercel serverless invocations. Each cold start gets a fresh
// Map, so this rate limiter is effectively a no-op in production. Replace with
// Upstash Redis (or similar edge-compatible store) for real cross-invocation
// rate limiting.

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const WINDOW_MS = 60_000;

const rateLimitStore = new Map<string, RateLimitEntry>();

/** Number of trusted reverse proxies in front of the app (e.g. 1 for a single load balancer). */
const TRUSTED_PROXY_COUNT = process.env.TRUSTED_PROXY_COUNT ? parseInt(process.env.TRUSTED_PROXY_COUNT, 10) : 0;

function getClientIp(req: ApiRequest): string {
  if (TRUSTED_PROXY_COUNT > 0) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      const parts = forwarded.split(',').map((s) => s.trim()).filter(Boolean);
      // Pick the address inserted by the outermost trusted proxy.
      // With N trusted proxies the real client IP is at position length - N.
      const idx = parts.length - TRUSTED_PROXY_COUNT;
      if (idx >= 0 && parts[idx]) return parts[idx];
    }
  }
  return req.socket?.remoteAddress ?? '127.0.0.1';
}

/**
 * Check rate limit for a request. Returns `true` if the request is allowed,
 * `false` if rate-limited (429 response is sent automatically).
 */
export function rateLimit(req: ApiRequest, res: ApiResponse, maxPerMinute: number): boolean {
  const ip = getClientIp(req);
  const now = Date.now();
  const entry = rateLimitStore.get(ip);

  if (!entry || now >= entry.resetTime) {
    rateLimitStore.set(ip, { count: 1, resetTime: now + WINDOW_MS });
    return true;
  }

  entry.count += 1;
  if (entry.count > maxPerMinute) {
    const retryAfter = Math.ceil((entry.resetTime - now) / 1000);
    res.setHeader('Retry-After', String(retryAfter));
    json(res, 429, { error: 'Too many requests' });
    return false;
  }

  // Periodic cleanup to prevent unbounded Map growth
  if (rateLimitStore.size > 10000) {
    for (const [key, val] of rateLimitStore) {
      if (now >= val.resetTime) rateLimitStore.delete(key);
    }
  }

  return true;
}

/** Exposed for testing -- clears the in-memory rate limit store. */
export function _resetRateLimitStore(): void {
  rateLimitStore.clear();
}

// ─── Server-side logging ─────────────────────────────────────────────────────

export function generateRequestId(): string {
  return randomUUID().slice(0, 8);
}

export function logRequest(
  requestId: string,
  method: string,
  path: string,
  statusCode: number,
  durationMs: number,
  error?: string,
) {
  const entry: Record<string, unknown> = {
    requestId,
    method,
    path,
    statusCode,
    durationMs,
    timestamp: new Date().toISOString(),
  };
  if (error) entry.error = error;
  console.log(JSON.stringify(entry));
}
