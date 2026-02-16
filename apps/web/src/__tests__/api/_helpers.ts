/**
 * Shared test helpers for API handler tests.
 * Provides mock Request/Response objects and common utilities.
 */
import { vi } from 'vitest';
import { EventEmitter } from 'events';
import type { IncomingHttpHeaders } from 'http';

// ─── Mock ApiRequest ────────────────────────────────────────────────────────

export interface MockRequestOptions {
  method?: string;
  headers?: IncomingHttpHeaders;
  body?: unknown;
  query?: Record<string, string | string[] | undefined>;
}

export function createMockRequest(opts: MockRequestOptions = {}) {
  const req = new EventEmitter() as any;
  req.method = opts.method ?? 'GET';
  req.headers = opts.headers ?? {};
  req.body = opts.body;
  req.query = opts.query;
  return req;
}

// ─── Mock ApiResponse ───────────────────────────────────────────────────────

export interface MockResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  ended: boolean;
  setHeader(name: string, value: string): void;
  end(data?: string): void;
  /** Parse body as JSON */
  json(): unknown;
}

export function createMockResponse(): MockResponse {
  const res: MockResponse = {
    statusCode: 200,
    headers: {},
    body: '',
    ended: false,
    setHeader(name: string, value: string) {
      res.headers[name.toLowerCase()] = value;
    },
    end(data?: string) {
      res.body = data ?? '';
      res.ended = true;
    },
    json() {
      return JSON.parse(res.body);
    },
  };
  return res;
}

// ─── Auth helper ────────────────────────────────────────────────────────────

export function authHeaders(token = 'test-valid-token'): IncomingHttpHeaders {
  return { authorization: `Bearer ${token}` };
}

// ─── Fake encrypted envelope ────────────────────────────────────────────────

export function fakeEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    encrypted: true,
    cipher: 'aes-256-gcm',
    salt: 'abcdef1234567890',
    iv: '0123456789ab',
    tag: 'deadbeefdeadbeef',
    ciphertext: 'encrypted-data-here',
    ...overrides,
  };
}

// ─── Supabase mock response builder ─────────────────────────────────────────

export function supabaseOk(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function supabaseError(status: number, message: string): Response {
  return new Response(JSON.stringify({ message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ─── requireUser mock helpers ───────────────────────────────────────────────

/**
 * Creates a mockRequireUser function and provides helpers to configure it.
 * Use this with vi.mock to replace requireUser in the handler modules.
 */
export function createRequireUserMock() {
  const mockFn = vi.fn();

  return {
    mockFn,
    /** Configure mock to return a user (auth success) */
    returnsUser(user: { id: string }) {
      mockFn.mockResolvedValueOnce(user);
    },
    /** Configure mock to simulate missing token (401) */
    returnsMissingToken() {
      mockFn.mockImplementationOnce((_req: unknown, res: any) => {
        res.statusCode = 401;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify({ error: 'Missing Authorization token' }));
        return null;
      });
    },
    /** Configure mock to simulate invalid/expired token (401) */
    returnsInvalidToken() {
      mockFn.mockImplementationOnce((_req: unknown, res: any) => {
        res.statusCode = 401;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify({ error: 'Invalid or expired token' }));
        return null;
      });
    },
  };
}
