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
      presignBatchSize: 3,
    })),
    presignHippiusMultipartParts: vi.fn(async ({ partNumbers }: { partNumbers: number[] }) => ({
      expiresInSeconds: 3600,
      urls: partNumbers.map((partNumber) => ({
        partNumber,
        url: `https://signed.example/part/${partNumber}`,
      })),
    })),
  };
});

import handler from '../../../api/cloud-backup/presign-parts';
import { presignHippiusMultipartParts } from '../../../api/_storage/hippiusClient';

const mockPresignParts = vi.mocked(presignHippiusMultipartParts);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('cloud-backup/presign-parts handler', () => {
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

  it('returns 403 for non-owned key', async () => {
    auth.returnsUser({ id: 'user-1' });
    const req = createMockRequest({
      method: 'POST',
      headers: authHeaders(),
      body: {
        key: 'vaults/user-2/snapshot.enc',
        uploadId: 'upload-1',
        partNumbers: [1, 2],
      },
    });
    const res = createMockResponse();
    await handler(req, res as any);

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'Forbidden: key ownership mismatch' });
  });

  it('returns 400 for invalid partNumbers', async () => {
    auth.returnsUser({ id: 'user-1' });
    const req = createMockRequest({
      method: 'POST',
      headers: authHeaders(),
      body: {
        key: 'vaults/user-1/snapshot.enc',
        uploadId: 'upload-1',
        partNumbers: [],
      },
    });
    const res = createMockResponse();
    await handler(req, res as any);

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'partNumbers must be a non-empty integer array' });
  });

  it('presigns in batches and returns ordered urls', async () => {
    auth.returnsUser({ id: 'user-1' });
    const req = createMockRequest({
      method: 'POST',
      headers: authHeaders(),
      body: {
        key: 'vaults/user-1/snapshot.enc',
        uploadId: 'upload-1',
        partNumbers: [5, 4, 3, 2, 1],
      },
    });
    const res = createMockResponse();
    await handler(req, res as any);

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      urls: Array<{ partNumber: number; url: string }>;
      expiresInSeconds: number;
    };
    expect(body.expiresInSeconds).toBe(3600);
    expect(body.urls.map((p) => p.partNumber)).toEqual([1, 2, 3, 4, 5]);

    expect(mockPresignParts).toHaveBeenCalledTimes(2);
    expect(mockPresignParts.mock.calls[0][0].partNumbers).toEqual([5, 4, 3]);
    expect(mockPresignParts.mock.calls[1][0].partNumbers).toEqual([2, 1]);
  });
});
