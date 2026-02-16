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
    generatePairingCode: vi.fn(() => 'PFY-TEST-CODE'),
  };
});

import handler from '../../../api/pair/[action]';
import { supabaseRest } from '../../../api/_utils';

const mockSupabaseRest = vi.mocked(supabaseRest);

beforeEach(() => {
  vi.clearAllMocks();
});

function createStartRequest(opts: Parameters<typeof createMockRequest>[0] = {}) {
  return createMockRequest({
    ...opts,
    query: { ...opts.query, action: 'start' },
  });
}

describe('pair/start handler', () => {
  it('rejects non-POST with 405', async () => {
    const req = createStartRequest({ method: 'GET' });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(405);
  });

  it('returns 401 when no Authorization header', async () => {
    auth.returnsMissingToken();
    const req = createStartRequest({ method: 'POST', body: {} });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 for invalid/expired token', async () => {
    auth.returnsInvalidToken();
    const req = createStartRequest({
      method: 'POST',
      headers: authHeaders('bad-token'),
      body: {},
    });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'Invalid or expired token' });
  });

  it('returns 400 for null body', async () => {
    auth.returnsUser({ id: 'user-1' });
    const req = createStartRequest({ method: 'POST', headers: authHeaders(), body: null });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Invalid JSON body' });
  });

  it('returns 400 for missing deviceName', async () => {
    auth.returnsUser({ id: 'user-1' });
    const req = createStartRequest({
      method: 'POST', headers: authHeaders(), body: { deviceType: 'agent' },
    });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'deviceName is required (max 80 chars)' });
  });

  it('returns 400 for empty deviceName', async () => {
    auth.returnsUser({ id: 'user-1' });
    const req = createStartRequest({
      method: 'POST', headers: authHeaders(), body: { deviceName: '   ', deviceType: 'agent' },
    });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for deviceName exceeding 80 chars', async () => {
    auth.returnsUser({ id: 'user-1' });
    const req = createStartRequest({
      method: 'POST', headers: authHeaders(), body: { deviceName: 'A'.repeat(81), deviceType: 'agent' },
    });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for invalid deviceType', async () => {
    auth.returnsUser({ id: 'user-1' });
    const req = createStartRequest({
      method: 'POST', headers: authHeaders(), body: { deviceName: 'My Device', deviceType: 'desktop' },
    });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'deviceType must be agent, vault, or mobile' });
  });

  it('returns 400 for missing deviceType', async () => {
    auth.returnsUser({ id: 'user-1' });
    const req = createStartRequest({
      method: 'POST', headers: authHeaders(), body: { deviceName: 'My Device' },
    });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(400);
  });

  it('returns 500 when Supabase insert fails', async () => {
    auth.returnsUser({ id: 'user-1' });
    mockSupabaseRest.mockResolvedValueOnce(supabaseError(500, 'DB unavailable'));
    const req = createStartRequest({
      method: 'POST', headers: authHeaders(), body: { deviceName: 'My Device', deviceType: 'agent' },
    });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ error: 'Internal server error' });
  });

  it('returns 200 with code and expiresAt on success', async () => {
    auth.returnsUser({ id: 'user-1' });
    mockSupabaseRest.mockResolvedValueOnce(supabaseOk(null));
    const req = createStartRequest({
      method: 'POST', headers: authHeaders(), body: { deviceName: 'My Device', deviceType: 'vault' },
    });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(200);
    const body = res.json() as any;
    expect(body.code).toBe('PFY-TEST-CODE');
    expect(typeof body.expiresAt).toBe('string');
  });

  it('accepts all valid device types: agent, vault, mobile', async () => {
    for (const deviceType of ['agent', 'vault', 'mobile']) {
      vi.clearAllMocks();
      auth.returnsUser({ id: 'user-1' });
      mockSupabaseRest.mockResolvedValueOnce(supabaseOk(null));
      const req = createStartRequest({
        method: 'POST', headers: authHeaders(), body: { deviceName: 'Dev', deviceType },
      });
      const res = createMockResponse();
      await handler(req, res as any);
      expect(res.statusCode).toBe(200);
    }
  });

  it('catches thrown errors and returns 500', async () => {
    auth.returnsUser({ id: 'user-1' });
    mockSupabaseRest.mockRejectedValueOnce(new Error('Token service down'));
    const req = createStartRequest({
      method: 'POST', headers: authHeaders(), body: { deviceName: 'Dev', deviceType: 'agent' },
    });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ error: 'Internal server error' });
  });
});
