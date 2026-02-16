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
    completeHippiusMultipartUpload: vi.fn(async () => ({
      etag: '"etag-final"',
      location: 'https://s3.hippius.com/bucket/key',
      versionId: 'v1',
    })),
  };
});

import handler from '../../../api/cloud-backup/complete';
import { completeHippiusMultipartUpload } from '../../../api/_storage/hippiusClient';

const mockComplete = vi.mocked(completeHippiusMultipartUpload);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('cloud-backup/complete handler', () => {
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
        parts: [{ partNumber: 1, etag: 'e1' }],
      },
    });
    const res = createMockResponse();
    await handler(req, res as any);

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'Forbidden: key ownership mismatch' });
  });

  it('returns 400 for expectedPartCount mismatch', async () => {
    auth.returnsUser({ id: 'user-1' });
    const req = createMockRequest({
      method: 'POST',
      headers: authHeaders(),
      body: {
        key: 'vaults/user-1/snapshot.enc',
        uploadId: 'upload-1',
        expectedPartCount: 3,
        parts: [{ partNumber: 1, etag: 'e1' }, { partNumber: 2, etag: 'e2' }],
      },
    });
    const res = createMockResponse();
    await handler(req, res as any);

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'parts length does not match expectedPartCount' });
  });

  it('returns 400 for non-contiguous ordered parts when expectedPartCount is set', async () => {
    auth.returnsUser({ id: 'user-1' });
    const req = createMockRequest({
      method: 'POST',
      headers: authHeaders(),
      body: {
        key: 'vaults/user-1/snapshot.enc',
        uploadId: 'upload-1',
        expectedPartCount: 3,
        parts: [
          { partNumber: 1, etag: 'e1' },
          { partNumber: 3, etag: 'e3' },
          { partNumber: 4, etag: 'e4' },
        ],
      },
    });
    const res = createMockResponse();
    await handler(req, res as any);

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'parts must be contiguous and ordered from 1..expectedPartCount' });
  });

  it('completes upload and returns metadata', async () => {
    auth.returnsUser({ id: 'user-1' });
    const req = createMockRequest({
      method: 'POST',
      headers: authHeaders(),
      body: {
        key: 'vaults/user-1/snapshot.enc',
        uploadId: 'upload-1',
        expectedPartCount: 3,
        parts: [
          { partNumber: 3, etag: 'e3' },
          { partNumber: 1, etag: 'e1' },
          { partNumber: 2, etag: 'e2' },
        ],
      },
    });
    const res = createMockResponse();
    await handler(req, res as any);

    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body.etag).toBe('"etag-final"');
    expect(body.versionId).toBe('v1');

    expect(mockComplete).toHaveBeenCalledTimes(1);
    expect(mockComplete.mock.calls[0][0].parts.map((p) => p.partNumber)).toEqual([1, 2, 3]);
  });
});
