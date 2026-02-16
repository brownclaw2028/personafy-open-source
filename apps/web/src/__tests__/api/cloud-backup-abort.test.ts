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
    abortHippiusMultipartUpload: vi.fn(async () => {}),
  };
});

import handler from '../../../api/cloud-backup/abort';
import { abortHippiusMultipartUpload } from '../../../api/_storage/hippiusClient';

const mockAbort = vi.mocked(abortHippiusMultipartUpload);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('cloud-backup/abort handler', () => {
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
      body: { key: 'vaults/user-2/snapshot.enc', uploadId: 'upload-1' },
    });
    const res = createMockResponse();
    await handler(req, res as any);

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'Forbidden: key ownership mismatch' });
  });

  it('returns 400 for missing uploadId', async () => {
    auth.returnsUser({ id: 'user-1' });
    const req = createMockRequest({
      method: 'POST',
      headers: authHeaders(),
      body: { key: 'vaults/user-1/snapshot.enc' },
    });
    const res = createMockResponse();
    await handler(req, res as any);

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'uploadId is required' });
  });

  it('aborts upload and returns 200', async () => {
    auth.returnsUser({ id: 'user-1' });
    const req = createMockRequest({
      method: 'POST',
      headers: authHeaders(),
      body: { key: 'vaults/user-1/snapshot.enc', uploadId: 'upload-1' },
    });
    const res = createMockResponse();
    await handler(req, res as any);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      key: 'vaults/user-1/snapshot.enc',
      uploadId: 'upload-1',
      aborted: true,
    });
    expect(mockAbort).toHaveBeenCalledWith({
      key: 'vaults/user-1/snapshot.enc',
      uploadId: 'upload-1',
    });
  });
});
