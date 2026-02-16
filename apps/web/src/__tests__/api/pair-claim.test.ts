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

// Mock _utils before importing handler
vi.mock('../../../api/_utils', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    ensureSupabaseEnv: vi.fn(),
    supabaseRest: vi.fn(),
    rateLimit: vi.fn(() => true),
    requireUser: (...args: unknown[]) => auth.mockFn(...args),
    generateDeviceToken: vi.fn(() => 'fake-device-token-hex'),
    hashToken: vi.fn(() => 'fake-hashed-token'),
  };
});

import handler from '../../../api/pair/[action]';
import { supabaseRest } from '../../../api/_utils';

const mockSupabaseRest = vi.mocked(supabaseRest);

beforeEach(() => {
  vi.clearAllMocks();
});

function createClaimRequest(opts: Parameters<typeof createMockRequest>[0] = {}) {
  return createMockRequest({
    ...opts,
    query: { ...opts.query, action: 'claim' },
  });
}

describe('pair/claim handler', () => {
  // ─── Method check ─────────────────────────────────────────────────────

  it('rejects non-POST with 405', async () => {
    const req = createClaimRequest({ method: 'GET' });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(405);
    expect(res.json()).toEqual({ error: 'Method not allowed' });
  });

  // ─── Invalid body ────────────────────────────────────────────────────

  it('returns 400 for null body', async () => {
    auth.returnsUser({ id: 'user-1' });
    const req = createClaimRequest({ method: 'POST', headers: authHeaders(), body: null });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Invalid JSON body' });
  });

  it('returns 400 for string body', async () => {
    auth.returnsUser({ id: 'user-1' });
    const req = createClaimRequest({ method: 'POST', headers: authHeaders(), body: 'not json' });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Invalid JSON body' });
  });

  it('returns 400 for array body', async () => {
    auth.returnsUser({ id: 'user-1' });
    const req = createClaimRequest({ method: 'POST', headers: authHeaders(), body: [1, 2, 3] });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Invalid JSON body' });
  });

  // ─── Invalid pairing code ────────────────────────────────────────────

  it('returns 400 for missing code', async () => {
    auth.returnsUser({ id: 'user-1' });
    const req = createClaimRequest({ method: 'POST', headers: authHeaders(), body: {} });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Invalid pairing code' });
  });

  it('returns 400 for empty code', async () => {
    auth.returnsUser({ id: 'user-1' });
    const req = createClaimRequest({ method: 'POST', headers: authHeaders(), body: { code: '' } });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Invalid pairing code' });
  });

  it('returns 400 for code exceeding 32 chars', async () => {
    auth.returnsUser({ id: 'user-1' });
    const req = createClaimRequest({
      method: 'POST',
      headers: authHeaders(),
      body: { code: 'A'.repeat(33) },
    });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Invalid pairing code' });
  });

  // ─── Code not found ──────────────────────────────────────────────────

  it('returns 404 when pairing request not found', async () => {
    auth.returnsUser({ id: 'user-1' });
    mockSupabaseRest.mockResolvedValueOnce(supabaseOk([]));
    const req = createClaimRequest({
      method: 'POST',
      headers: authHeaders(),
      body: { code: 'PFY-ABCD-1234' },
    });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Pairing request not found' });
  });

  // ─── Expired code ────────────────────────────────────────────────────

  it('returns 410 when pairing code is expired', async () => {
    auth.returnsUser({ id: 'user-1' });
    const pastDate = new Date(Date.now() - 60_000).toISOString();
    mockSupabaseRest
      .mockResolvedValueOnce(
        supabaseOk([
          {
            id: 'req-1',
            owner_id: 'user-1',
            device_name: 'Test',
            device_type: 'agent',
            expires_at: pastDate,
          },
        ]),
      )
      .mockResolvedValueOnce(supabaseOk(null)); // PATCH to mark expired

    const req = createClaimRequest({
      method: 'POST',
      headers: authHeaders(),
      body: { code: 'PFY-ABCD-1234' },
    });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(410);
    expect(res.json()).toEqual({ error: 'Pairing code expired' });
    // Verify the PATCH was called to mark expired
    expect(mockSupabaseRest).toHaveBeenCalledTimes(2);
  });

  it('returns 410 for NaN expires_at', async () => {
    auth.returnsUser({ id: 'user-1' });
    mockSupabaseRest
      .mockResolvedValueOnce(
        supabaseOk([
          {
            id: 'req-1',
            owner_id: 'user-1',
            device_name: 'Test',
            device_type: 'agent',
            expires_at: 'invalid-date',
          },
        ]),
      )
      .mockResolvedValueOnce(supabaseOk(null));

    const req = createClaimRequest({
      method: 'POST',
      headers: authHeaders(),
      body: { code: 'PFY-ABCD-1234' },
    });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(410);
  });

  // ─── Upstream Supabase errors ────────────────────────────────────────

  it('returns 500 when initial Supabase lookup fails', async () => {
    auth.returnsUser({ id: 'user-1' });
    mockSupabaseRest.mockResolvedValueOnce(
      supabaseError(500, 'DB connection lost'),
    );
    const req = createClaimRequest({
      method: 'POST',
      headers: authHeaders(),
      body: { code: 'PFY-ABCD-1234' },
    });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ error: 'Internal server error' });
  });

  it('returns 500 when device insert fails', async () => {
    auth.returnsUser({ id: 'user-1' });
    const futureDate = new Date(Date.now() + 600_000).toISOString();
    mockSupabaseRest
      .mockResolvedValueOnce(
        supabaseOk([
          {
            id: 'req-1',
            owner_id: 'user-1',
            device_name: 'Test',
            device_type: 'agent',
            expires_at: futureDate,
          },
        ]),
      )
      .mockResolvedValueOnce(supabaseError(500, 'Insert failed'));

    const req = createClaimRequest({
      method: 'POST',
      headers: authHeaders(),
      body: { code: 'PFY-ABCD-1234' },
    });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ error: 'Internal server error' });
  });

  it('returns 500 when device insert returns no id', async () => {
    auth.returnsUser({ id: 'user-1' });
    const futureDate = new Date(Date.now() + 600_000).toISOString();
    mockSupabaseRest
      .mockResolvedValueOnce(
        supabaseOk([
          {
            id: 'req-1',
            owner_id: 'user-1',
            device_name: 'Test',
            device_type: 'agent',
            expires_at: futureDate,
          },
        ]),
      )
      .mockResolvedValueOnce(supabaseOk([])); // no device rows

    const req = createClaimRequest({
      method: 'POST',
      headers: authHeaders(),
      body: { code: 'PFY-ABCD-1234' },
    });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ error: 'Internal server error' });
  });

  it('returns 500 when PATCH to mark claimed fails', async () => {
    auth.returnsUser({ id: 'user-1' });
    const futureDate = new Date(Date.now() + 600_000).toISOString();
    mockSupabaseRest
      .mockResolvedValueOnce(
        supabaseOk([
          {
            id: 'req-1',
            owner_id: 'user-1',
            device_name: 'Test',
            device_type: 'agent',
            expires_at: futureDate,
          },
        ]),
      )
      .mockResolvedValueOnce(supabaseOk([{ id: 'dev-1' }])) // device created
      .mockResolvedValueOnce(supabaseError(500, 'Update failed')); // PATCH fails

    const req = createClaimRequest({
      method: 'POST',
      headers: authHeaders(),
      body: { code: 'PFY-ABCD-1234' },
    });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ error: 'Internal server error' });
  });

  // ─── Happy path ──────────────────────────────────────────────────────

  it('returns 200 with deviceId and deviceToken on success', async () => {
    auth.returnsUser({ id: 'user-1' });
    const futureDate = new Date(Date.now() + 600_000).toISOString();
    mockSupabaseRest
      .mockResolvedValueOnce(
        supabaseOk([
          {
            id: 'req-1',
            owner_id: 'user-1',
            device_name: 'Test',
            device_type: 'agent',
            expires_at: futureDate,
          },
        ]),
      )
      .mockResolvedValueOnce(supabaseOk([{ id: 'dev-123' }]))
      .mockResolvedValueOnce(supabaseOk(null));

    const req = createClaimRequest({
      method: 'POST',
      headers: authHeaders(),
      body: { code: 'PFY-ABCD-1234' },
    });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(200);
    const body = res.json() as any;
    expect(body.deviceId).toBe('dev-123');
    expect(body.deviceToken).toBe('fake-device-token-hex');
  });

  // ─── Exception handling ──────────────────────────────────────────────

  it('catches thrown errors and returns 500', async () => {
    auth.returnsUser({ id: 'user-1' });
    mockSupabaseRest.mockRejectedValueOnce(new Error('Network failure'));
    const req = createClaimRequest({
      method: 'POST',
      headers: authHeaders(),
      body: { code: 'PFY-ABCD-1234' },
    });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ error: 'Internal server error' });
  });
});
