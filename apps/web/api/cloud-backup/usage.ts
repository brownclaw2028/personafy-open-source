import {
  type ApiRequest,
  type ApiResponse,
  generateRequestId,
  getErrorMessage,
  json,
  logRequest,
  rateLimit,
  requireUser,
  safeErrorMessage,
} from '../_utils';
import { getHippiusConfig } from '../_storage/hippiusClient';

const DEFAULT_USAGE_METHODS = [
  'storage_getUsage',
  'storage_get_usage',
  'getStorageUsage',
  'usage_get',
];

function parseOptionalEnvNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

function resolveUsageMethods(): string[] {
  const configured = process.env.HIPPIUS_USAGE_RPC_METHODS;
  if (!configured) return DEFAULT_USAGE_METHODS;
  const methods = configured
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return methods.length > 0 ? methods : DEFAULT_USAGE_METHODS;
}

function toBytes(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return null;
}

function tryReadUsageShape(value: unknown): {
  usedBytes: number;
  capacityBytes: number | null;
  availableBytes: number | null;
} | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const usedBytes = toBytes(
    row.usedBytes
    ?? row.used
    ?? row.usageBytes
    ?? row.totalUsedBytes
    ?? row.bytesUsed
    ?? row.storageUsedBytes,
  );
  if (usedBytes == null) return null;

  const capacityBytes = toBytes(
    row.capacityBytes
    ?? row.capacity
    ?? row.quotaBytes
    ?? row.limitBytes
    ?? row.totalBytes,
  );
  const availableBytes = toBytes(
    row.availableBytes
    ?? row.available
    ?? row.freeBytes
    ?? row.remainingBytes,
  );

  return { usedBytes, capacityBytes, availableBytes };
}

function extractUsage(result: unknown): {
  usedBytes: number;
  capacityBytes: number | null;
  availableBytes: number | null;
} | null {
  const direct = tryReadUsageShape(result);
  if (direct) return direct;

  if (result && typeof result === 'object' && !Array.isArray(result)) {
    const row = result as Record<string, unknown>;
    const nestedKeys = ['usage', 'data', 'result', 'stats', 'storage'];
    for (const key of nestedKeys) {
      const nested = tryReadUsageShape(row[key]);
      if (nested) return nested;
    }
  }
  return null;
}

async function callRpcMethod(
  rpcUrl: string,
  method: string,
  params: unknown,
): Promise<unknown> {
  const authToken = process.env.HIPPIUS_RPC_AUTH_TOKEN?.trim();
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: `usage-${Date.now()}`,
      method,
      params,
    }),
  });
  if (!res.ok) {
    throw new Error(`RPC ${method} failed with status ${res.status}`);
  }

  const payload = await res.json() as {
    result?: unknown;
    error?: { code?: number; message?: string };
  };
  if (payload.error) {
    const msg = payload.error.message ?? `RPC ${method} returned error`;
    throw new Error(msg);
  }
  return payload.result;
}

function computeUsagePercent(usedBytes: number, capacityBytes: number | null): number | null {
  if (capacityBytes == null || capacityBytes <= 0) return null;
  return Math.max(0, Math.min(100, Number(((usedBytes / capacityBytes) * 100).toFixed(2))));
}

function estimateStorageCostUsd(
  usedBytes: number,
  storagePricePerGbMonthUsd: number,
): number {
  const usedGb = usedBytes / (1024 ** 3);
  const raw = usedGb * storagePricePerGbMonthUsd;
  return Math.round(raw * 10_000) / 10_000;
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  const requestId = generateRequestId();
  const start = Date.now();

  if (!rateLimit(req, res, 20)) return;

  if (req.method !== 'GET') {
    json(res, 405, { error: 'Method not allowed' });
    logRequest(requestId, req.method ?? 'UNKNOWN', '/api/cloud-backup/usage', 405, Date.now() - start);
    return;
  }

  try {
    const user = await requireUser(req, res);
    if (!user) {
      logRequest(requestId, 'GET', '/api/cloud-backup/usage', res.statusCode, Date.now() - start);
      return;
    }

    const rpcUrl = process.env.HIPPIUS_RPC_URL?.trim();
    if (!rpcUrl) {
      json(res, 503, { error: 'HIPPIUS_RPC_URL is not configured' });
      logRequest(requestId, 'GET', '/api/cloud-backup/usage', 503, Date.now() - start);
      return;
    }

    const cfg = getHippiusConfig();
    const methods = resolveUsageMethods();
    const attempted: string[] = [];
    let usage: { usedBytes: number; capacityBytes: number | null; availableBytes: number | null } | null = null;
    let resolvedMethod: string | null = null;
    const errors: string[] = [];

    // Try a couple of parameter shapes because method contracts vary by deployment.
    const paramCandidates: unknown[] = [
      { userId: user.id, bucket: cfg.bucket },
      { ownerId: user.id, bucket: cfg.bucket },
      [user.id, cfg.bucket],
      [user.id],
      [],
    ];

    for (const method of methods) {
      for (const params of paramCandidates) {
        attempted.push(method);
        try {
          const result = await callRpcMethod(rpcUrl, method, params);
          const parsed = extractUsage(result);
          if (parsed) {
            usage = parsed;
            resolvedMethod = method;
            break;
          }
          errors.push(`${method}: response did not include parseable usage fields`);
        } catch (err: unknown) {
          errors.push(`${method}: ${getErrorMessage(err)}`);
        }
      }
      if (usage) break;
    }

    if (!usage || !resolvedMethod) {
      json(res, 502, {
        error: 'Unable to read usage from Hippius RPC',
        attemptedMethods: Array.from(new Set(attempted)),
        diagnostics: errors.slice(-4),
      });
      logRequest(requestId, 'GET', '/api/cloud-backup/usage', 502, Date.now() - start);
      return;
    }

    const storagePricePerGbMonthUsd = parseOptionalEnvNumber('HIPPIUS_STORAGE_PRICE_PER_GB_MONTH_USD', 0);
    const requestPricePer1000Usd = parseOptionalEnvNumber('HIPPIUS_REQUEST_PRICE_PER_1000_USD', 0);
    const usagePercent = computeUsagePercent(usage.usedBytes, usage.capacityBytes);
    const estimatedMonthlyStorageCostUsd = estimateStorageCostUsd(usage.usedBytes, storagePricePerGbMonthUsd);

    json(res, 200, {
      provider: 'hippius',
      method: resolvedMethod,
      bucket: cfg.bucket,
      usage: {
        usedBytes: usage.usedBytes,
        capacityBytes: usage.capacityBytes,
        availableBytes: usage.availableBytes,
        usagePercent,
      },
      pricing: {
        storagePricePerGbMonthUsd,
        requestPricePer1000Usd,
        estimatedMonthlyStorageCostUsd,
      },
      attemptedMethods: Array.from(new Set(attempted)),
    });
    logRequest(requestId, 'GET', '/api/cloud-backup/usage', 200, Date.now() - start);
  } catch (err: unknown) {
    const errMsg = getErrorMessage(err);
    json(res, 500, { error: safeErrorMessage(requestId, errMsg), requestId });
    logRequest(requestId, 'GET', '/api/cloud-backup/usage', 500, Date.now() - start, errMsg);
  }
}
