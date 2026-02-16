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

import handler from '../../../api/sync/push';
import { supabaseRest } from '../../../api/_utils';

const mockSupabaseRest = vi.mocked(supabaseRest);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('sync/push handler', () => {
  it('rejects non-POST with 405', async () => {
    const req = createMockRequest({ method: 'GET' });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(405);
  });

  it('returns 401 when no Authorization header', async () => {
    auth.returnsMissingToken();
    const req = createMockRequest({ method: 'POST', body: {} });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 for invalid token', async () => {
    auth.returnsInvalidToken();
    const req = createMockRequest({ method: 'POST', headers: authHeaders('bad'), body: {} });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(401);
  });

  it('returns 400 for null body', async () => {
    auth.returnsUser({ id: 'user-1' });
    const req = createMockRequest({ method: 'POST', headers: authHeaders(), body: null });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Invalid JSON body' });
  });

  it('returns 400 for missing envelope', async () => {
    auth.returnsUser({ id: 'user-1' });
    const req = createMockRequest({
      method: 'POST', headers: authHeaders(),
      body: { ifMatchVersion: 0, version: 1 },
    });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Invalid envelope' });
  });

  it('returns 400 for non-encrypted envelope', async () => {
    auth.returnsUser({ id: 'user-1' });
    const req = createMockRequest({
      method: 'POST', headers: authHeaders(),
      body: { envelope: { encrypted: false }, ifMatchVersion: 0, version: 1 },
    });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(400);
  });

  it('returns 413 when envelope exceeds 1MB', async () => {
    auth.returnsUser({ id: 'user-1' });
    const bigEnvelope = fakeEnvelope({ ciphertext: 'x'.repeat(1024 * 1024) });
    const req = createMockRequest({
      method: 'POST', headers: authHeaders(),
      body: { envelope: bigEnvelope, ifMatchVersion: 0, version: 1 },
    });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(413);
    expect(res.json()).toEqual({ error: 'Envelope too large (max 1MB)' });
  });

  it('returns 400 when ifMatchVersion is missing', async () => {
    auth.returnsUser({ id: 'user-1' });
    const req = createMockRequest({
      method: 'POST', headers: authHeaders(),
      body: { envelope: fakeEnvelope(), version: 1 },
    });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Invalid version or ifMatchVersion' });
  });

  it('returns 400 when version is missing', async () => {
    auth.returnsUser({ id: 'user-1' });
    const req = createMockRequest({
      method: 'POST', headers: authHeaders(),
      body: { envelope: fakeEnvelope(), ifMatchVersion: 0 },
    });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when version != ifMatchVersion + 1', async () => {
    auth.returnsUser({ id: 'user-1' });
    const req = createMockRequest({
      method: 'POST', headers: authHeaders(),
      body: { envelope: fakeEnvelope(), ifMatchVersion: 3, version: 5 },
    });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Invalid version or ifMatchVersion' });
  });

  it('returns 409 when atomic PATCH matches no rows (version conflict)', async () => {
    auth.returnsUser({ id: 'user-1' });
    // Atomic PATCH with version filter returns empty array — conflict
    mockSupabaseRest.mockResolvedValueOnce(supabaseOk([]));
    const req = createMockRequest({
      method: 'POST', headers: authHeaders(),
      body: { envelope: fakeEnvelope(), ifMatchVersion: 3, version: 4 },
    });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(409);
    expect((res.json() as any).error).toBe('Version conflict');
  });

  it('returns 409 when vault already exists on first push (ifMatchVersion=0)', async () => {
    auth.returnsUser({ id: 'user-1' });
    // Check returns existing vault
    mockSupabaseRest.mockResolvedValueOnce(supabaseOk([{ id: 'vault-1' }]));
    const req = createMockRequest({
      method: 'POST', headers: authHeaders(),
      body: { envelope: fakeEnvelope(), ifMatchVersion: 0, version: 1 },
    });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(409);
    expect((res.json() as any).error).toBe('Cloud vault already exists');
  });

  it('returns 500 when Supabase lookup fails', async () => {
    auth.returnsUser({ id: 'user-1' });
    mockSupabaseRest.mockResolvedValueOnce(supabaseError(500, 'Service unavailable'));
    const req = createMockRequest({
      method: 'POST', headers: authHeaders(),
      body: { envelope: fakeEnvelope(), ifMatchVersion: 0, version: 1 },
    });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(500);
  });

  it('returns 500 when Supabase insert fails (new vault)', async () => {
    auth.returnsUser({ id: 'user-1' });
    mockSupabaseRest
      .mockResolvedValueOnce(supabaseOk([]))
      .mockResolvedValueOnce(supabaseError(500, 'Insert failed'));
    const req = createMockRequest({
      method: 'POST', headers: authHeaders(),
      body: { envelope: fakeEnvelope(), ifMatchVersion: 0, version: 1 },
    });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(500);
  });

  it('returns 500 when Supabase PATCH fails (existing vault)', async () => {
    auth.returnsUser({ id: 'user-1' });
    // Atomic PATCH fails with server error
    mockSupabaseRest.mockResolvedValueOnce(supabaseError(500, 'Patch failed'));
    const req = createMockRequest({
      method: 'POST', headers: authHeaders(),
      body: { envelope: fakeEnvelope(), ifMatchVersion: 3, version: 4 },
    });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(500);
  });

  it('creates vault on first push with ifMatchVersion=0', async () => {
    auth.returnsUser({ id: 'user-1' });
    mockSupabaseRest
      .mockResolvedValueOnce(supabaseOk([]))
      .mockResolvedValueOnce(supabaseOk(null));
    const req = createMockRequest({
      method: 'POST', headers: authHeaders(),
      body: { envelope: fakeEnvelope(), ifMatchVersion: 0, version: 1 },
    });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(200);
    const body = res.json() as any;
    expect(body.version).toBe(1);
    expect(typeof body.updatedAt).toBe('string');
  });

  it('updates existing vault when version matches (atomic PATCH)', async () => {
    auth.returnsUser({ id: 'user-1' });
    // Atomic PATCH with version filter returns the updated row
    mockSupabaseRest.mockResolvedValueOnce(supabaseOk([{ id: 'vault-1', version: 4 }]));
    const req = createMockRequest({
      method: 'POST', headers: authHeaders(),
      body: { envelope: fakeEnvelope(), ifMatchVersion: 3, version: 4 },
    });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(200);
    expect((res.json() as any).version).toBe(4);
  });

  it('catches thrown errors and returns 500', async () => {
    auth.returnsUser({ id: 'user-1' });
    mockSupabaseRest.mockRejectedValueOnce(new Error('Timeout'));
    const req = createMockRequest({
      method: 'POST', headers: authHeaders(),
      body: { envelope: fakeEnvelope(), ifMatchVersion: 0, version: 1 },
    });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ error: 'Internal server error' });
  });
});
