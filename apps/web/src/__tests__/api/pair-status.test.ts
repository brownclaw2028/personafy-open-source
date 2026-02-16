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

function createStatusRequest(opts: Parameters<typeof createMockRequest>[0] = {}) {
  return createMockRequest({
    ...opts,
    query: { ...opts.query, action: 'status' },
  });
}

describe('pair/status handler', () => {
  it('rejects non-GET with 405', async () => {
    const req = createStatusRequest({ method: 'POST' });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(405);
  });

  it('returns 401 when no Authorization header', async () => {
    auth.returnsMissingToken();
    const req = createStatusRequest({ method: 'GET' });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 for invalid token', async () => {
    auth.returnsInvalidToken();
    const req = createStatusRequest({ method: 'GET', headers: authHeaders('expired') });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(401);
  });

  it('returns 400 when code query param is missing', async () => {
    auth.returnsUser({ id: 'user-1' });
    const req = createStatusRequest({ method: 'GET', headers: authHeaders(), query: {} });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'code is required' });
  });

  it('returns 400 when code query param is empty string', async () => {
    auth.returnsUser({ id: 'user-1' });
    const req = createStatusRequest({ method: 'GET', headers: authHeaders(), query: { code: '   ' } });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'code is required' });
  });

  it('returns 404 when pairing request not found', async () => {
    auth.returnsUser({ id: 'user-1' });
    mockSupabaseRest.mockResolvedValueOnce(supabaseOk([]));
    const req = createStatusRequest({ method: 'GET', headers: authHeaders(), query: { code: 'PFY-XXXX-YYYY' } });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Pairing request not found' });
  });

  it('auto-marks pending code as expired and returns expired status', async () => {
    const pastDate = new Date(Date.now() - 60_000).toISOString();
    auth.returnsUser({ id: 'user-1' });
    mockSupabaseRest
      .mockResolvedValueOnce(supabaseOk([{
        id: 'req-1', status: 'pending', device_id: null,
        device_name: null, device_type: null, expires_at: pastDate,
      }]))
      .mockResolvedValueOnce(supabaseOk(null)); // PATCH

    const req = createStatusRequest({ method: 'GET', headers: authHeaders(), query: { code: 'PFY-ABCD-1234' } });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'expired' });
    expect(mockSupabaseRest).toHaveBeenCalledTimes(2);
    const patchCall = mockSupabaseRest.mock.calls[1];
    expect(patchCall[1]?.method).toBe('PATCH');
  });

  it('returns 500 when Supabase lookup fails', async () => {
    auth.returnsUser({ id: 'user-1' });
    mockSupabaseRest.mockResolvedValueOnce(supabaseError(500, 'Query timeout'));
    const req = createStatusRequest({ method: 'GET', headers: authHeaders(), query: { code: 'PFY-ABCD-1234' } });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ error: 'Internal server error' });
  });

  it('returns 200 with pending status for active code', async () => {
    const futureDate = new Date(Date.now() + 600_000).toISOString();
    auth.returnsUser({ id: 'user-1' });
    mockSupabaseRest.mockResolvedValueOnce(supabaseOk([{
      id: 'req-1', status: 'pending', device_id: null,
      device_name: null, device_type: null, expires_at: futureDate,
    }]));

    const req = createStatusRequest({ method: 'GET', headers: authHeaders(), query: { code: 'PFY-ABCD-1234' } });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(200);
    const body = res.json() as any;
    expect(body.status).toBe('pending');
    expect(body.deviceId).toBeUndefined();
  });

  it('returns 200 with claimed status including device info', async () => {
    const futureDate = new Date(Date.now() + 600_000).toISOString();
    auth.returnsUser({ id: 'user-1' });
    mockSupabaseRest.mockResolvedValueOnce(supabaseOk([{
      id: 'req-1', status: 'claimed', device_id: 'dev-1',
      device_name: 'MacBook', device_type: 'vault', expires_at: futureDate,
    }]));

    const req = createStatusRequest({ method: 'GET', headers: authHeaders(), query: { code: 'PFY-ABCD-1234' } });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(200);
    const body = res.json() as any;
    expect(body.status).toBe('claimed');
    expect(body.deviceId).toBe('dev-1');
    expect(body.deviceName).toBe('MacBook');
    expect(body.deviceType).toBe('vault');
  });

  it('catches thrown errors and returns 500', async () => {
    auth.returnsUser({ id: 'user-1' });
    mockSupabaseRest.mockRejectedValueOnce(new Error('Connection refused'));
    const req = createStatusRequest({ method: 'GET', headers: authHeaders(), query: { code: 'PFY-ABCD-1234' } });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ error: 'Internal server error' });
  });
});
