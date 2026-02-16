import { decryptVaultPayload, type EncryptedVaultEnvelope, isEncryptedEnvelope } from './cloudVaultCrypto';
import { getCloudProviderConfig } from './cloudProvider';
import { getSupabaseAccessToken, hasSupabaseConfig } from './supabase';
import {
  finishCloudBackupRun,
  recordCloudBackupHttpStatus,
  startCloudBackupRun,
  type CloudBackupRunRecord,
} from './telemetry/cloud-backup-metrics';
import { parseResponseError, validateVaultImport } from './utils';
import type { VaultData } from './vault';

const DEFAULT_MULTIPART_CONTENT_TYPE = 'application/octet-stream';
const DEFAULT_CONCURRENCY = 3;
const MAX_CONCURRENCY = 5;
const DEFAULT_MAX_UPLOAD_ATTEMPTS = 3;
const RETRYABLE_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

export interface CloudBackupInitResponse {
  provider: string;
  bucket: string;
  key: string;
  uploadId: string;
  partSizeBytes: number;
  partCount: number;
  maxPartsPerRequest: number;
}

export interface CloudBackupPartUrl {
  partNumber: number;
  url: string;
}

export interface CloudBackupProgress {
  uploadedBytes: number;
  totalBytes: number;
  percent: number;
  completedParts: number;
  totalParts: number;
  partRetries: number;
}

export interface CloudBackupUploadResult {
  provider: string;
  bucket: string;
  key: string;
  uploadId: string;
  snapshotId: string;
  etag?: string;
  location?: string;
  versionId?: string;
  totalBytes: number;
  partCount: number;
  partRetries: number;
  metrics: CloudBackupRunRecord;
}

export interface CloudBackupUsageInfo {
  provider: string;
  method: string;
  usage: {
    usedBytes: number;
    capacityBytes: number | null;
    availableBytes: number | null;
    usagePercent: number | null;
  };
  pricing: {
    storagePricePerGbMonthUsd: number;
    requestPricePer1000Usd: number;
    estimatedMonthlyStorageCostUsd: number;
  };
  attemptedMethods: string[];
}

export interface CloudBackupLatestSnapshot {
  provider: string;
  key: string;
  snapshotId: string;
  lastModified?: string;
  sizeBytes?: number;
  envelope: EncryptedVaultEnvelope;
}

export interface UploadEncryptedSnapshotInput {
  snapshotId: string;
  envelope: EncryptedVaultEnvelope;
  contentType?: string;
  partSizeBytes?: number;
  concurrency?: number;
  maxAttempts?: number;
  signal?: AbortSignal;
  onProgress?: (progress: CloudBackupProgress) => void;
}

export class CloudBackupError extends Error {
  readonly code: string;
  readonly status?: number;
  readonly retryable: boolean;

  constructor(input: {
    code: string;
    message: string;
    status?: number;
    retryable?: boolean;
  }) {
    super(input.message);
    this.name = 'CloudBackupError';
    this.code = input.code;
    this.status = input.status;
    this.retryable = Boolean(input.retryable);
  }
}

function isRetryableStatus(status?: number): boolean {
  return typeof status === 'number' && RETRYABLE_STATUSES.has(status);
}

function isCloudVaultEnvelope(value: unknown): value is EncryptedVaultEnvelope {
  if (!isEncryptedEnvelope(value)) return false;
  const envelope = value as Partial<EncryptedVaultEnvelope>;
  if (envelope.version !== 1) return false;
  if (envelope.kdf !== 'pbkdf2') return false;
  if (!envelope.kdfParams || typeof envelope.kdfParams !== 'object') return false;
  const params = envelope.kdfParams as Partial<EncryptedVaultEnvelope['kdfParams']>;
  return (
    typeof params.iterations === 'number'
    && typeof params.hash === 'string'
    && typeof params.dkLen === 'number'
  );
}

function isTransientNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === 'AbortError') return false;
  if (err instanceof TypeError) return true;
  const message = err.message.toLowerCase();
  return (
    message.includes('network')
    || message.includes('fetch failed')
    || message.includes('failed to fetch')
    || message.includes('load failed')
    || message.includes('timed out')
    || message.includes('timeout')
    || message.includes('econnreset')
    || message.includes('econnrefused')
    || message.includes('enotfound')
    || message.includes('eai_again')
    || message.includes('socket')
  );
}

function normalizeError(err: unknown, fallbackCode: string): CloudBackupError {
  if (err instanceof CloudBackupError) return err;
  if (err instanceof DOMException && err.name === 'AbortError') {
    return new CloudBackupError({
      code: 'backup_cancelled',
      message: 'Upload cancelled.',
      retryable: false,
    });
  }
  const message = err instanceof Error ? err.message : 'Cloud backup request failed';
  return new CloudBackupError({
    code: fallbackCode,
    message,
    retryable: isTransientNetworkError(err),
  });
}

function parseRetryAfterMs(response: Response): number | null {
  const header = response.headers.get('Retry-After');
  if (!header) return null;
  const asSeconds = Number.parseInt(header, 10);
  if (Number.isFinite(asSeconds) && asSeconds > 0) {
    return Math.min(asSeconds * 1000, 30_000);
  }
  const asDate = Date.parse(header);
  if (Number.isFinite(asDate)) {
    const delta = asDate - Date.now();
    if (delta > 0) return Math.min(delta, 30_000);
  }
  return null;
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const cleanup = () => signal?.removeEventListener('abort', onAbort);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function computeBackoffDelayMs(attempt: number): number {
  const base = 400 * (2 ** Math.max(0, attempt - 1));
  const jitter = Math.floor(Math.random() * 250);
  return Math.min(base + jitter, 10_000);
}

function normalizeSnapshotId(snapshotId: string): string {
  const trimmed = snapshotId.trim();
  if (!trimmed) {
    throw new CloudBackupError({
      code: 'invalid_snapshot_id',
      message: 'Snapshot ID is required.',
      retryable: false,
    });
  }
  return trimmed.slice(0, 120);
}

export function createSnapshotId(now = new Date()): string {
  const iso = now.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[-:]/g, '');
  const suffix = typeof crypto?.randomUUID === 'function'
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  return `snapshot-${iso}-${suffix}`;
}

async function fetchWithCloudAuth(path: string, init?: RequestInit, signal?: AbortSignal): Promise<Response> {
  if (!hasSupabaseConfig()) {
    throw new CloudBackupError({
      code: 'auth_not_configured',
      message: 'Supabase not configured.',
      retryable: false,
    });
  }
  const token = await getSupabaseAccessToken();
  if (!token) {
    throw new CloudBackupError({
      code: 'auth_required',
      message: 'Sign in required before cloud backup.',
      retryable: false,
    });
  }
  const providerConfig = getCloudProviderConfig();
  return fetch(path, {
    ...init,
    signal,
    headers: {
      'X-Cloud-Sync-Provider': providerConfig.syncProvider,
      'X-Cloud-Backup-Provider': providerConfig.backupProvider,
      'X-Cloud-Migration-Mode': providerConfig.migrationMode,
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
}

async function postJson<TResponse>(
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<TResponse> {
  const res = await fetchWithCloudAuth(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, signal);

  if (!res.ok) {
    const error = await parseResponseError(res, 'Request failed');
    throw new CloudBackupError({
      code: 'api_request_failed',
      message: error,
      status: res.status,
      retryable: isRetryableStatus(res.status),
    });
  }
  return (await res.json()) as TResponse;
}

export async function initCloudBackupMultipart(input: {
  snapshotId: string;
  sizeBytes: number;
  contentType?: string;
  partSizeBytes?: number;
}, signal?: AbortSignal): Promise<CloudBackupInitResponse> {
  const payload = {
    snapshotId: normalizeSnapshotId(input.snapshotId),
    sizeBytes: input.sizeBytes,
    contentType: input.contentType ?? DEFAULT_MULTIPART_CONTENT_TYPE,
    partSizeBytes: input.partSizeBytes,
  };
  const result = await postJson<CloudBackupInitResponse>('/api/cloud-backup/init', payload, signal);
  if (
    !result
    || typeof result.key !== 'string'
    || typeof result.uploadId !== 'string'
    || typeof result.partSizeBytes !== 'number'
    || typeof result.partCount !== 'number'
  ) {
    throw new CloudBackupError({
      code: 'invalid_init_payload',
      message: 'Cloud backup init returned an invalid payload.',
      retryable: false,
    });
  }
  return result;
}

export async function presignCloudBackupParts(input: {
  key: string;
  uploadId: string;
  partNumbers: number[];
}, signal?: AbortSignal): Promise<CloudBackupPartUrl[]> {
  const result = await postJson<{ urls: CloudBackupPartUrl[] }>('/api/cloud-backup/presign-parts', input, signal);
  if (!Array.isArray(result.urls)) {
    throw new CloudBackupError({
      code: 'invalid_presign_payload',
      message: 'Cloud backup presign response is invalid.',
      retryable: false,
    });
  }
  return result.urls;
}

export async function completeCloudBackupMultipart(input: {
  key: string;
  uploadId: string;
  expectedPartCount: number;
  parts: Array<{ partNumber: number; etag: string }>;
}, signal?: AbortSignal): Promise<{ etag?: string; location?: string; versionId?: string }> {
  return postJson<{ etag?: string; location?: string; versionId?: string }>(
    '/api/cloud-backup/complete',
    input,
    signal,
  );
}

export async function abortCloudBackupMultipart(input: { key: string; uploadId: string }, signal?: AbortSignal): Promise<void> {
  await postJson('/api/cloud-backup/abort', input, signal);
}

export async function fetchCloudBackupUsage(signal?: AbortSignal): Promise<CloudBackupUsageInfo> {
  const res = await fetchWithCloudAuth('/api/cloud-backup/usage', { method: 'GET' }, signal);
  if (!res.ok) {
    const error = await parseResponseError(res, 'Cloud usage request failed');
    throw new CloudBackupError({
      code: 'usage_request_failed',
      message: error,
      status: res.status,
      retryable: isRetryableStatus(res.status),
    });
  }
  return (await res.json()) as CloudBackupUsageInfo;
}

export async function fetchLatestCloudBackupEnvelope(signal?: AbortSignal): Promise<CloudBackupLatestSnapshot> {
  const res = await fetchWithCloudAuth('/api/cloud-backup/latest', { method: 'GET' }, signal);
  if (!res.ok) {
    const error = await parseResponseError(res, 'Cloud backup snapshot request failed');
    const notFound = res.status === 404;
    throw new CloudBackupError({
      code: notFound ? 'backup_snapshot_not_found' : 'backup_snapshot_request_failed',
      message: error,
      status: res.status,
      retryable: !notFound && isRetryableStatus(res.status),
    });
  }

  const payload = (await res.json()) as {
    provider?: unknown;
    key?: unknown;
    snapshotId?: unknown;
    lastModified?: unknown;
    sizeBytes?: unknown;
    envelope?: unknown;
  };

  if (
    !payload
    || typeof payload.provider !== 'string'
    || typeof payload.key !== 'string'
    || typeof payload.snapshotId !== 'string'
    || !isCloudVaultEnvelope(payload.envelope)
  ) {
    throw new CloudBackupError({
      code: 'invalid_latest_snapshot_payload',
      message: 'Cloud backup latest snapshot payload is invalid.',
      retryable: false,
    });
  }

  return {
    provider: payload.provider,
    key: payload.key,
    snapshotId: payload.snapshotId,
    lastModified: typeof payload.lastModified === 'string' ? payload.lastModified : undefined,
    sizeBytes: typeof payload.sizeBytes === 'number' ? payload.sizeBytes : undefined,
    envelope: payload.envelope,
  };
}

function normalizeEtag(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) return trimmed;
  return `"${trimmed.replace(/^"+|"+$/g, '')}"`;
}

async function uploadPartWithRetry(input: {
  partNumber: number;
  url: string;
  body: Blob;
  maxAttempts: number;
  signal?: AbortSignal;
  onHttpStatus?: (status: number) => void;
}): Promise<{ etag: string; retriesUsed: number }> {
  let attempt = 0;
  while (attempt < input.maxAttempts) {
    attempt += 1;
    try {
      const res = await fetch(input.url, {
        method: 'PUT',
        body: input.body,
        signal: input.signal,
      });
      input.onHttpStatus?.(res.status);
      if (!res.ok) {
        const retryAfterMs = parseRetryAfterMs(res);
        if (attempt < input.maxAttempts && isRetryableStatus(res.status)) {
          await sleep(retryAfterMs ?? computeBackoffDelayMs(attempt), input.signal);
          continue;
        }
        const bodyText = await res.text().catch(() => '');
        throw new CloudBackupError({
          code: 'part_upload_failed',
          message: `Part ${input.partNumber} upload failed (${res.status})${bodyText ? `: ${bodyText}` : ''}`,
          status: res.status,
          retryable: isRetryableStatus(res.status),
        });
      }

      const etag = normalizeEtag(res.headers.get('etag'));
      if (!etag) {
        throw new CloudBackupError({
          code: 'missing_part_etag',
          message: `Part ${input.partNumber} uploaded but no ETag header was returned.`,
          retryable: false,
        });
      }
      return {
        etag,
        retriesUsed: attempt - 1,
      };
    } catch (err) {
      const normalized = normalizeError(err, 'part_upload_failed');
      if (normalized.code === 'backup_cancelled') throw normalized;
      if (attempt < input.maxAttempts && normalized.retryable) {
        await sleep(computeBackoffDelayMs(attempt), input.signal);
        continue;
      }
      throw normalized;
    }
  }
  throw new CloudBackupError({
    code: 'part_retry_exhausted',
    message: `Part ${input.partNumber} failed after retry attempts were exhausted.`,
    retryable: false,
  });
}

export async function uploadEncryptedSnapshotMultipart(input: UploadEncryptedSnapshotInput): Promise<CloudBackupUploadResult> {
  const contentType = input.contentType ?? DEFAULT_MULTIPART_CONTENT_TYPE;
  const snapshotId = normalizeSnapshotId(input.snapshotId);
  const blob = new Blob([JSON.stringify(input.envelope)], { type: contentType });
  const metricsRun = startCloudBackupRun({
    snapshotId,
    provider: getCloudProviderConfig().backupProvider,
    totalBytes: blob.size,
    expectedPartCount: 0,
  });

  const init = await initCloudBackupMultipart({
    snapshotId,
    sizeBytes: blob.size,
    contentType,
    partSizeBytes: input.partSizeBytes,
  }, input.signal);
  metricsRun.provider = init.provider;
  metricsRun.expectedPartCount = init.partCount;

  const partNumbers = Array.from({ length: init.partCount }, (_, idx) => idx + 1);
  const presignedUrls = await presignCloudBackupParts({
    key: init.key,
    uploadId: init.uploadId,
    partNumbers,
  }, input.signal);

  const urlMap = new Map<number, string>();
  for (const row of presignedUrls) {
    if (!row || typeof row.partNumber !== 'number' || typeof row.url !== 'string') continue;
    urlMap.set(row.partNumber, row.url);
  }
  if (urlMap.size !== init.partCount) {
    await abortCloudBackupMultipart({ key: init.key, uploadId: init.uploadId }).catch(() => {});
    throw new CloudBackupError({
      code: 'incomplete_presign_response',
      message: 'Cloud backup server did not return URLs for all multipart parts.',
      retryable: false,
    });
  }

  const maxAttempts = Math.max(1, input.maxAttempts ?? DEFAULT_MAX_UPLOAD_ATTEMPTS);
  const concurrency = Math.max(1, Math.min(MAX_CONCURRENCY, input.concurrency ?? DEFAULT_CONCURRENCY));
  const completed = new Array<{ partNumber: number; etag: string }>(init.partCount);
  let uploadedBytes = 0;
  let completedParts = 0;
  let partRetries = 0;

  const queue = [...partNumbers];

  const emitProgress = () => {
    input.onProgress?.({
      uploadedBytes,
      totalBytes: blob.size,
      percent: blob.size > 0 ? Math.min(100, Math.round((uploadedBytes / blob.size) * 100)) : 0,
      completedParts,
      totalParts: init.partCount,
      partRetries,
    });
  };

  emitProgress();

  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length > 0) {
      const partNumber = queue.shift();
      if (!partNumber) return;
      const start = (partNumber - 1) * init.partSizeBytes;
      const end = Math.min(start + init.partSizeBytes, blob.size);
      const partBlob = blob.slice(start, end);
      const url = urlMap.get(partNumber);
      if (!url) {
        throw new CloudBackupError({
          code: 'missing_part_url',
          message: `Missing presigned URL for part ${partNumber}.`,
          retryable: false,
        });
      }
      const uploaded = await uploadPartWithRetry({
        partNumber,
        url,
        body: partBlob,
        maxAttempts,
        signal: input.signal,
        onHttpStatus: (status) => recordCloudBackupHttpStatus(metricsRun, status),
      });
      completed[partNumber - 1] = { partNumber, etag: uploaded.etag };
      uploadedBytes += partBlob.size;
      completedParts += 1;
      partRetries += uploaded.retriesUsed;
      emitProgress();
    }
  });

  try {
    await Promise.all(workers);
    const completion = await completeCloudBackupMultipart({
      key: init.key,
      uploadId: init.uploadId,
      expectedPartCount: init.partCount,
      parts: completed,
    }, input.signal);
    const metrics = finishCloudBackupRun(metricsRun, {
      outcome: 'completed',
      partRetries,
    });
    emitProgress();
    return {
      provider: init.provider,
      bucket: init.bucket,
      key: init.key,
      uploadId: init.uploadId,
      snapshotId,
      etag: completion.etag,
      location: completion.location,
      versionId: completion.versionId,
      totalBytes: blob.size,
      partCount: init.partCount,
      partRetries,
      metrics,
    };
  } catch (err) {
    const normalized = normalizeError(err, 'backup_upload_failed');
    finishCloudBackupRun(metricsRun, {
      outcome: normalized.code === 'backup_cancelled' ? 'cancelled' : 'failed',
      partRetries,
      errorCode: normalized.code,
    });
    await abortCloudBackupMultipart({ key: init.key, uploadId: init.uploadId }).catch(() => {});
    throw normalized;
  }
}

export async function decryptAndValidateCloudEnvelope(
  envelope: unknown,
  passphrase: string,
): Promise<VaultData> {
  if (!isEncryptedEnvelope(envelope)) {
    throw new CloudBackupError({
      code: 'invalid_envelope',
      message: 'Cloud payload is not a valid encrypted envelope.',
      retryable: false,
    });
  }
  const decrypted = await decryptVaultPayload(envelope as EncryptedVaultEnvelope, passphrase);
  const validated = validateVaultImport(decrypted);
  if (!validated.ok) {
    throw new CloudBackupError({
      code: 'invalid_restored_vault',
      message: `Decrypted cloud snapshot failed validation: ${validated.error}`,
      retryable: false,
    });
  }
  return validated.data;
}
