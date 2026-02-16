import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  authHeaders,
  createMockRequest,
  createMockResponse,
  createRequireUserMock,
} from './_helpers';

const auth = createRequireUserMock();

vi.mock('../../../api/_utils', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    ensureSupabaseEnv: vi.fn(),
    rateLimit: vi.fn(() => true),
    requireUser: (...args: unknown[]) => auth.mockFn(...args),
    isEncryptedEnvelope: vi.fn((value: unknown) => {
      if (!value || typeof value !== 'object') return false;
      return (value as { encrypted?: unknown }).encrypted === true;
    }),
  };
});

vi.mock('../../../api/_storage/hippiusClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/_storage/hippiusClient')>();
  return {
    ...actual,
    readLatestHippiusSnapshotForUser: vi.fn(),
  };
});

import handler from '../../../api/cloud-backup/latest';
import { readLatestHippiusSnapshotForUser } from '../../../api/_storage/hippiusClient';

const mockReadLatest = vi.mocked(readLatestHippiusSnapshotForUser);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('cloud-backup/latest handler', () => {
  it('rejects non-GET with 405', async () => {
    const req = createMockRequest({ method: 'POST' });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(405);
  });

  it('returns 401 when unauthenticated', async () => {
    auth.returnsMissingToken();
    const req = createMockRequest({ method: 'GET' });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(401);
  });

  it('returns 404 when no backup snapshot exists', async () => {
    auth.returnsUser({ id: 'user-1' });
    mockReadLatest.mockResolvedValueOnce(null);
    const req = createMockRequest({ method: 'GET', headers: authHeaders() });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Cloud backup snapshot not found' });
  });

  it('returns 502 when snapshot payload is invalid JSON', async () => {
    auth.returnsUser({ id: 'user-1' });
    mockReadLatest.mockResolvedValueOnce({
      key: 'vaults/user-1/snapshot.enc',
      snapshotId: 'snapshot',
      envelopeText: '{',
    });
    const req = createMockRequest({ method: 'GET', headers: authHeaders() });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: 'Cloud backup snapshot payload is not valid JSON' });
  });

  it('returns 200 with latest encrypted envelope payload', async () => {
    auth.returnsUser({ id: 'user-1' });
    mockReadLatest.mockResolvedValueOnce({
      key: 'vaults/user-1/snapshot-abc.enc',
      snapshotId: 'snapshot-abc',
      lastModified: '2026-02-15T00:00:00.000Z',
      sizeBytes: 2048,
      envelopeText: JSON.stringify({
        encrypted: true,
        version: 1,
        kdf: 'pbkdf2',
        kdfParams: { iterations: 600000, hash: 'SHA-256', dkLen: 32 },
        cipher: 'aes-256-gcm',
        salt: 'c2FsdA==',
        iv: 'aXY=',
        tag: 'dGFn',
        ciphertext: 'ZW5jcnlwdGVk',
      }),
    });

    const req = createMockRequest({ method: 'GET', headers: authHeaders() });
    const res = createMockResponse();
    await handler(req, res as any);

    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body.provider).toBe('hippius');
    expect(body.key).toBe('vaults/user-1/snapshot-abc.enc');
    expect(body.snapshotId).toBe('snapshot-abc');
    expect(body.sizeBytes).toBe(2048);
    expect((body.envelope as Record<string, unknown>).encrypted).toBe(true);
  });
});
