import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  authHeaders,
  createMockRequest,
  createMockResponse,
  createRequireUserMock,
} from './_helpers';

const auth = createRequireUserMock();
const mockFetch = vi.fn();

vi.stubGlobal('fetch', mockFetch);

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
  };
});

import handler from '../../../api/cloud-backup/usage';

describe('cloud-backup/usage handler', () => {
  const originalRpcUrl = process.env.HIPPIUS_RPC_URL;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.HIPPIUS_RPC_URL = 'https://rpc.hippius.test';
    process.env.HIPPIUS_USAGE_RPC_METHODS = 'storage_getUsage,getUsage';
    process.env.HIPPIUS_STORAGE_PRICE_PER_GB_MONTH_USD = '0.02';
    process.env.HIPPIUS_REQUEST_PRICE_PER_1000_USD = '0.004';
  });

  afterEach(() => {
    if (originalRpcUrl == null) delete process.env.HIPPIUS_RPC_URL;
    else process.env.HIPPIUS_RPC_URL = originalRpcUrl;
    delete process.env.HIPPIUS_USAGE_RPC_METHODS;
    delete process.env.HIPPIUS_STORAGE_PRICE_PER_GB_MONTH_USD;
    delete process.env.HIPPIUS_REQUEST_PRICE_PER_1000_USD;
  });

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

  it('returns 503 when HIPPIUS_RPC_URL is missing', async () => {
    auth.returnsUser({ id: 'user-1' });
    delete process.env.HIPPIUS_RPC_URL;
    const req = createMockRequest({ method: 'GET', headers: authHeaders() });
    const res = createMockResponse();
    await handler(req, res as any);
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: 'HIPPIUS_RPC_URL is not configured' });
  });

  it('returns parsed usage and pricing metadata', async () => {
    auth.returnsUser({ id: 'user-1' });
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({
        jsonrpc: '2.0',
        id: '1',
        result: {
          usage: {
            usedBytes: 10 * 1024 ** 3,
            capacityBytes: 100 * 1024 ** 3,
            availableBytes: 90 * 1024 ** 3,
          },
        },
      }), { status: 200 }),
    );

    const req = createMockRequest({ method: 'GET', headers: authHeaders() });
    const res = createMockResponse();
    await handler(req, res as any);

    expect(res.statusCode).toBe(200);
    const payload = res.json() as Record<string, any>;
    expect(payload.provider).toBe('hippius');
    expect(payload.method).toBe('storage_getUsage');
    expect(payload.usage.usedBytes).toBe(10 * 1024 ** 3);
    expect(payload.usage.usagePercent).toBe(10);
    expect(payload.pricing.estimatedMonthlyStorageCostUsd).toBeCloseTo(0.2, 5);
  });

  it('returns 502 when RPC responses are unparseable', async () => {
    auth.returnsUser({ id: 'user-1' });
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({
        jsonrpc: '2.0',
        id: '1',
        result: { ok: true },
      }), { status: 200 }),
    );

    const req = createMockRequest({ method: 'GET', headers: authHeaders() });
    const res = createMockResponse();
    await handler(req, res as any);

    expect(res.statusCode).toBe(502);
    const payload = res.json() as Record<string, any>;
    expect(payload.error).toBe('Unable to read usage from Hippius RPC');
    expect(Array.isArray(payload.attemptedMethods)).toBe(true);
  });
});
