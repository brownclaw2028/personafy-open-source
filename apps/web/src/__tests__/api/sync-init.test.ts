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

import handler from '../../../api/sync/init';
import { supabaseRest } from '../../../api/_utils';

const mockSupabaseRest = vi.mocked(supabaseRest);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('sync/init handler', () => {
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

  it('returns 400 for missing vaultName', async () => {
    auth.returnsUser({ id: 'user-1' });
    const req = createMockRequest({
      method: 'POST', headers: authHeaders(), body: { envelope: fakeEnvelope() },
    });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'vaultName is required (max 120 chars)' });
  });

  it('returns 400 for empty vaultName', async () => {
    auth.returnsUser({ id: 'user-1' });
    const req = createMockRequest({
      method: 'POST', headers: authHeaders(), body: { vaultName: '  ', envelope: fakeEnvelope() },
    });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for vaultName exceeding 120 chars', async () => {
    auth.returnsUser({ id: 'user-1' });
    const req = createMockRequest({
      method: 'POST', headers: authHeaders(), body: { vaultName: 'A'.repeat(121), envelope: fakeEnvelope() },
    });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for missing envelope', async () => {
    auth.returnsUser({ id: 'user-1' });
    const req = createMockRequest({
      method: 'POST', headers: authHeaders(), body: { vaultName: 'My Vault' },
    });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Invalid envelope' });
  });

  it('returns 400 for envelope with encrypted=false', async () => {
    auth.returnsUser({ id: 'user-1' });
    const req = createMockRequest({
      method: 'POST', headers: authHeaders(),
      body: { vaultName: 'My Vault', envelope: { ...fakeEnvelope(), encrypted: false } },
    });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Invalid envelope' });
  });

  it('returns 400 for envelope missing required fields', async () => {
    auth.returnsUser({ id: 'user-1' });
    const req = createMockRequest({
      method: 'POST', headers: authHeaders(),
      body: { vaultName: 'My Vault', envelope: { encrypted: true, cipher: 'aes-256-gcm' } },
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
      body: { vaultName: 'My Vault', envelope: bigEnvelope },
    });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(413);
    expect(res.json()).toEqual({ error: 'Envelope too large (max 1MB)' });
  });

  it('returns 500 when Supabase PATCH fails', async () => {
    auth.returnsUser({ id: 'user-1' });
    // Atomic PATCH fails with server error
    mockSupabaseRest.mockResolvedValueOnce(supabaseError(500, 'Internal error'));
    const req = createMockRequest({
      method: 'POST', headers: authHeaders(),
      body: { vaultName: 'My Vault', envelope: fakeEnvelope() },
    });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(500);
  });

  it('returns 500 when Supabase insert fails (no existing vault)', async () => {
    auth.returnsUser({ id: 'user-1' });
    mockSupabaseRest
      .mockResolvedValueOnce(supabaseOk([]))    // PATCH returns empty — no vault
      .mockResolvedValueOnce(supabaseError(500, 'Insert failed'));
    const req = createMockRequest({
      method: 'POST', headers: authHeaders(),
      body: { vaultName: 'My Vault', envelope: fakeEnvelope() },
    });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ error: 'Internal server error' });
  });

  it('creates new vault when none exists', async () => {
    auth.returnsUser({ id: 'user-1' });
    mockSupabaseRest
      .mockResolvedValueOnce(supabaseOk([]))    // PATCH returns empty — no vault
      .mockResolvedValueOnce(supabaseOk(null));  // INSERT succeeds
    const req = createMockRequest({
      method: 'POST', headers: authHeaders(),
      body: { vaultName: 'My Vault', envelope: fakeEnvelope() },
    });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(200);
    const body = res.json() as any;
    expect(body.version).toBe(1);
    expect(typeof body.updatedAt).toBe('string');
  });

  it('updates existing vault via atomic PATCH', async () => {
    auth.returnsUser({ id: 'user-1' });
    // PATCH returns the updated row (representation)
    mockSupabaseRest.mockResolvedValueOnce(supabaseOk([{ id: 'vault-1', version: 5 }]));
    const req = createMockRequest({
      method: 'POST', headers: authHeaders(),
      body: { vaultName: 'My Vault', envelope: fakeEnvelope(), version: 5 },
    });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(200);
    expect((res.json() as any).version).toBe(5);
  });

  it('defaults version to 1 if not provided', async () => {
    auth.returnsUser({ id: 'user-1' });
    mockSupabaseRest
      .mockResolvedValueOnce(supabaseOk([]))    // PATCH returns empty — no vault
      .mockResolvedValueOnce(supabaseOk(null));  // INSERT succeeds
    const req = createMockRequest({
      method: 'POST', headers: authHeaders(),
      body: { vaultName: 'My Vault', envelope: fakeEnvelope() },
    });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(200);
    expect((res.json() as any).version).toBe(1);
  });

  it('catches thrown errors and returns 500', async () => {
    auth.returnsUser({ id: 'user-1' });
    mockSupabaseRest.mockRejectedValueOnce(new Error('DNS resolution failed'));
    const req = createMockRequest({
      method: 'POST', headers: authHeaders(),
      body: { vaultName: 'My Vault', envelope: fakeEnvelope() },
    });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ error: 'Internal server error' });
  });
});
