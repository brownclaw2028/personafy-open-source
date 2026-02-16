import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockRequest,
  createMockResponse,
  createRequireUserMock,
  authHeaders,
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

import handler from '../../../api/pair/[action]';
import { supabaseRest } from '../../../api/_utils';

const mockSupabaseRest = vi.mocked(supabaseRest);

beforeEach(() => {
  vi.clearAllMocks();
});

function createRevokeRequest(opts: Parameters<typeof createMockRequest>[0] = {}) {
  return createMockRequest({
    ...opts,
    query: { ...opts.query, action: 'revoke' },
  });
}

describe('pair/revoke handler', () => {
  it('rejects non-POST with 405', async () => {
    const req = createRevokeRequest({ method: 'DELETE' });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(405);
  });

  it('returns 401 when no Authorization header', async () => {
    auth.returnsMissingToken();
    const req = createRevokeRequest({ method: 'POST', body: {} });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 for invalid token', async () => {
    auth.returnsInvalidToken();
    const req = createRevokeRequest({ method: 'POST', headers: authHeaders('bad'), body: { deviceId: 'a0000000-0000-0000-0000-000000000001' } });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(401);
  });

  it('returns 400 for null body', async () => {
    auth.returnsUser({ id: 'user-1' });
    const req = createRevokeRequest({ method: 'POST', headers: authHeaders(), body: null });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Invalid JSON body' });
  });

  it('returns 400 for missing deviceId', async () => {
    auth.returnsUser({ id: 'user-1' });
    const req = createRevokeRequest({ method: 'POST', headers: authHeaders(), body: {} });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'deviceId is required' });
  });

  it('returns 400 for empty deviceId', async () => {
    auth.returnsUser({ id: 'user-1' });
    const req = createRevokeRequest({ method: 'POST', headers: authHeaders(), body: { deviceId: '   ' } });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'deviceId is required' });
  });

  it('returns 400 for non-string deviceId', async () => {
    auth.returnsUser({ id: 'user-1' });
    const req = createRevokeRequest({ method: 'POST', headers: authHeaders(), body: { deviceId: 123 } });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'deviceId is required' });
  });

  it('returns 400 for invalid UUID format in deviceId', async () => {
    auth.returnsUser({ id: 'user-1' });
    const req = createRevokeRequest({ method: 'POST', headers: authHeaders(), body: { deviceId: 'not-a-uuid' } });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Invalid deviceId format' });
  });

  it('returns 500 when Supabase DELETE fails', async () => {
    auth.returnsUser({ id: 'user-1' });
    mockSupabaseRest.mockResolvedValueOnce(supabaseError(500, 'Delete operation failed'));
    const req = createRevokeRequest({ method: 'POST', headers: authHeaders(), body: { deviceId: 'a0000000-0000-0000-0000-000000000001' } });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ error: 'Internal server error' });
  });

  it('returns 200 with ok:true on successful revoke', async () => {
    auth.returnsUser({ id: 'user-1' });
    mockSupabaseRest.mockResolvedValueOnce(supabaseOk(null));
    const req = createRevokeRequest({ method: 'POST', headers: authHeaders(), body: { deviceId: 'a0000000-0000-0000-0000-000000000001' } });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it('passes owner_id filter to Supabase DELETE', async () => {
    auth.returnsUser({ id: 'user-42' });
    mockSupabaseRest.mockResolvedValueOnce(supabaseOk(null));
    const req = createRevokeRequest({ method: 'POST', headers: authHeaders(), body: { deviceId: 'b0000000-0000-0000-0000-000000000099' } });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(200);
    const [path, opts] = mockSupabaseRest.mock.calls[0];
    expect(path).toContain('id=eq.b0000000-0000-0000-0000-000000000099');
    expect(path).toContain('owner_id=eq.user-42');
    expect(opts?.method).toBe('DELETE');
  });

  it('catches thrown errors and returns 500', async () => {
    auth.returnsUser({ id: 'user-1' });
    mockSupabaseRest.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const req = createRevokeRequest({ method: 'POST', headers: authHeaders(), body: { deviceId: 'a0000000-0000-0000-0000-000000000001' } });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ error: 'Internal server error' });
  });
});
