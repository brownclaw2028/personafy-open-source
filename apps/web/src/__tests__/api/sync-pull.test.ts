import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockRequest,
  createMockResponse,
  createRequireUserMock,
  authHeaders,
  fakeEnvelope,
  supabaseOk,
  supabaseError,
} from './_helpers';

const auth = createRequireUserMock();

vi.mock('../../../api/_utils', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    ensureSupabaseEnv: vi.fn(),
    supabaseRest: vi.fn(),
    rateLimit: vi.fn(() => true),
    requireUser: (...args: unknown[]) => auth.mockFn(...args),
  };
});

import handler from '../../../api/sync/pull';
import { supabaseRest } from '../../../api/_utils';

const mockSupabaseRest = vi.mocked(supabaseRest);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('sync/pull handler', () => {
  it('rejects non-GET with 405', async () => {
    const req = createMockRequest({ method: 'POST' });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(405);
  });

  it('returns 401 when no Authorization header', async () => {
    auth.returnsMissingToken();
    const req = createMockRequest({ method: 'GET' });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 for invalid token', async () => {
    auth.returnsInvalidToken();
    const req = createMockRequest({ method: 'GET', headers: authHeaders('bad') });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(401);
  });

  it('returns 404 when no cloud vault exists', async () => {
    auth.returnsUser({ id: 'user-1' });
    mockSupabaseRest.mockResolvedValueOnce(supabaseOk([]));
    const req = createMockRequest({ method: 'GET', headers: authHeaders() });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Cloud vault not found' });
  });

  it('returns 404 when Supabase returns null data', async () => {
    auth.returnsUser({ id: 'user-1' });
    mockSupabaseRest.mockResolvedValueOnce(supabaseOk(null));
    const req = createMockRequest({ method: 'GET', headers: authHeaders() });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(404);
  });

  it('returns 500 when Supabase query fails', async () => {
    auth.returnsUser({ id: 'user-1' });
    mockSupabaseRest.mockResolvedValueOnce(supabaseError(500, 'Query execution error'));
    const req = createMockRequest({ method: 'GET', headers: authHeaders() });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ error: 'Internal server error' });
  });

  it('returns 200 with envelope, version, and updatedAt', async () => {
    const envelope = fakeEnvelope();
    auth.returnsUser({ id: 'user-1' });
    mockSupabaseRest.mockResolvedValueOnce(supabaseOk([{
      envelope, version: 5, updated_at: '2026-02-03T12:00:00Z',
    }]));
    const req = createMockRequest({ method: 'GET', headers: authHeaders() });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(200);
    const body = res.json() as any;
    expect(body.envelope).toEqual(envelope);
    expect(body.version).toBe(5);
    expect(body.updatedAt).toBe('2026-02-03T12:00:00Z');
  });

  it('catches thrown errors and returns 500', async () => {
    auth.returnsUser({ id: 'user-1' });
    mockSupabaseRest.mockRejectedValueOnce(new Error('ENOTFOUND'));
    const req = createMockRequest({ method: 'GET', headers: authHeaders() });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ error: 'Internal server error' });
  });
});
