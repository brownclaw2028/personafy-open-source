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
  };
});

vi.mock('../../../api/_storage/hippiusClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/_storage/hippiusClient')>();
  return {
    ...actual,
    getHippiusConfig: vi.fn(() => ({
      endpoint: 'https://s3.hippius.com',
      region: 'decentralized',
      bucket: 'personafy-backups',
      accessKeyId: 'hip_test',
      secretAccessKey: 'secret',
      presignBatchSize: 8,
    })),
    createHippiusMultipartSession: vi.fn(async ({ key }: { key: string }) => ({
      bucket: 'personafy-backups',
      key,
      uploadId: 'upload-1',
    })),
  };
});

import handler from '../../../api/cloud-backup/init';
import { createHippiusMultipartSession } from '../../../api/_storage/hippiusClient';

const mockCreateSession = vi.mocked(createHippiusMultipartSession);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('cloud-backup/init handler', () => {
  it('rejects non-POST with 405', async () => {
    const req = createMockRequest({ method: 'GET' });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(405);
  });

  it('returns 401 when unauthenticated', async () => {
    auth.returnsMissingToken();
    const req = createMockRequest({ method: 'POST', body: {} });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(401);
  });

  it('returns 400 for missing snapshotId', async () => {
    auth.returnsUser({ id: 'user-1' });
    const req = createMockRequest({
      method: 'POST',
      headers: authHeaders(),
      body: { sizeBytes: 1000 },
    });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'snapshotId is required (max 120 chars)' });
  });

  it('returns 400 for invalid sizeBytes', async () => {
    auth.returnsUser({ id: 'user-1' });
    const req = createMockRequest({
      method: 'POST',
      headers: authHeaders(),
      body: { snapshotId: 'snap-1', sizeBytes: 0 },
    });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'sizeBytes must be a positive number' });
  });

  it('returns 200 with multipart session metadata', async () => {
    auth.returnsUser({ id: 'user-1' });
    const req = createMockRequest({
      method: 'POST',
      headers: authHeaders(),
      body: {
        snapshotId: 'snapshot-2026-02-14',
        sizeBytes: 1024 * 1024 * 1024,
        partSizeBytes: 128 * 1024 * 1024,
      },
    });
    const res = createMockResponse();
    await handler(req, res as any);

    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body.provider).toBe('hippius');
    expect(body.uploadId).toBe('upload-1');
    expect(body.partCount).toBe(8);
    expect(body.partSizeBytes).toBe(128 * 1024 * 1024);

    expect(mockCreateSession).toHaveBeenCalledTimes(1);
    expect(mockCreateSession.mock.calls[0][0].key).toContain('vaults/user-1/');
  });
});
