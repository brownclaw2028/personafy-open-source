import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decryptVaultPayload } from '../cloudVaultCrypto';
import { CloudBackupError, decryptAndValidateCloudEnvelope, uploadEncryptedSnapshotMultipart } from '../cloudBackup';
import { validateVaultImport } from '../utils';

vi.mock('../cloudProvider', () => ({
  getCloudProviderConfig: vi.fn(() => ({
    migrationMode: 'coexist',
    syncProvider: 'supabase',
    backupProvider: 'hippius',
    hippiusEnabled: true,
    cloudBackupDefaultOn: false,
  })),
}));

vi.mock('../supabase', () => ({
  hasSupabaseConfig: vi.fn(() => true),
  getSupabaseAccessToken: vi.fn(async () => 'test-token'),
}));

vi.mock('../telemetry/cloud-backup-metrics', () => ({
  startCloudBackupRun: vi.fn((input: Record<string, unknown>) => ({
    ...input,
    startedAt: Date.now(),
  })),
  recordCloudBackupHttpStatus: vi.fn(),
  finishCloudBackupRun: vi.fn((run: Record<string, unknown>, outcome: Record<string, unknown>) => ({
    ...run,
    ...outcome,
    durationMs: 1,
  })),
}));

vi.mock('../utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils')>();
  return {
    ...actual,
    parseResponseError: vi.fn(async (_res: Response, fallback: string) => fallback),
    validateVaultImport: vi.fn((data: unknown) => ({
      ok: true,
      data,
    })),
  };
});

vi.mock('../cloudVaultCrypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../cloudVaultCrypto')>();
  return {
    ...actual,
    decryptVaultPayload: vi.fn(),
    isEncryptedEnvelope: vi.fn((value: unknown) => {
      if (!value || typeof value !== 'object') return false;
      return (value as { encrypted?: unknown }).encrypted === true;
    }),
  };
});

const MIB = 1024 * 1024;
const PART_SIZE_128_MIB = 128 * MIB;

function makeEnvelope() {
  return {
    version: 1 as const,
    encrypted: true as const,
    kdf: 'pbkdf2' as const,
    kdfParams: { iterations: 600000, hash: 'SHA-256', dkLen: 32 },
    cipher: 'aes-256-gcm' as const,
    salt: 'c2FsdA==',
    iv: 'aXY=',
    tag: 'dGFn',
    ciphertext: 'ZW5jcnlwdGVkLWNpcGhlcnRleHQ=',
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('cloudBackup multipart behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uploads 1 GiB scenario in <=12 PUT calls and caps concurrency at worker limit', async () => {
    let putCalls = 0;
    let inFlight = 0;
    let maxInFlight = 0;
    let firstPayloadText = '';
    const controlPlaneBodies: string[] = [];

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/cloud-backup/init') {
        controlPlaneBodies.push(typeof init?.body === 'string' ? init.body : '');
        return jsonResponse(200, {
          provider: 'hippius',
          bucket: 'personafy-backups',
          key: 'vaults/user-1/snapshot.enc',
          uploadId: 'upload-1',
          partSizeBytes: PART_SIZE_128_MIB,
          partCount: 8,
          maxPartsPerRequest: 8,
        });
      }
      if (url === '/api/cloud-backup/presign-parts') {
        controlPlaneBodies.push(typeof init?.body === 'string' ? init.body : '');
        return jsonResponse(200, {
          urls: Array.from({ length: 8 }, (_, idx) => ({
            partNumber: idx + 1,
            url: `https://signed.example/part/${idx + 1}`,
          })),
        });
      }
      if (url === '/api/cloud-backup/complete') {
        controlPlaneBodies.push(typeof init?.body === 'string' ? init.body : '');
        return jsonResponse(200, {
          etag: '"final-etag"',
          versionId: 'v1',
        });
      }
      if (url === '/api/cloud-backup/abort') {
        return jsonResponse(200, { aborted: true });
      }
      if (url.startsWith('https://signed.example/part/')) {
        putCalls += 1;
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);

        if (putCalls === 1 && init?.body instanceof Blob) {
          firstPayloadText = await init.body.text();
        }

        await new Promise((resolve) => setTimeout(resolve, 4));
        inFlight -= 1;

        return new Response('', {
          status: 200,
          headers: { etag: `"etag-${putCalls}"` },
        });
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await uploadEncryptedSnapshotMultipart({
      snapshotId: 'snapshot-acceptance',
      envelope: makeEnvelope(),
      partSizeBytes: PART_SIZE_128_MIB,
      concurrency: 99,
    });

    expect(result.partCount).toBe(8);
    expect(putCalls).toBeLessThanOrEqual(12);
    expect(maxInFlight).toBeLessThanOrEqual(5);
    expect(firstPayloadText).toContain('"encrypted":true');
    expect(firstPayloadText).toContain('"ciphertext"');
    expect(firstPayloadText).not.toContain('plaintext');
    expect(controlPlaneBodies.every((body) => !body.includes('ciphertext'))).toBe(true);
    expect(controlPlaneBodies.every((body) => !body.includes('plaintext'))).toBe(true);
  });

  it('recovers from transient 429 responses without retry storms', async () => {
    const attemptsByPart = new Map<number, number>();

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/cloud-backup/init') {
        return jsonResponse(200, {
          provider: 'hippius',
          bucket: 'personafy-backups',
          key: 'vaults/user-1/snapshot.enc',
          uploadId: 'upload-1',
          partSizeBytes: PART_SIZE_128_MIB,
          partCount: 2,
          maxPartsPerRequest: 8,
        });
      }
      if (url === '/api/cloud-backup/presign-parts') {
        return jsonResponse(200, {
          urls: [
            { partNumber: 1, url: 'https://signed.example/part/1' },
            { partNumber: 2, url: 'https://signed.example/part/2' },
          ],
        });
      }
      if (url === '/api/cloud-backup/complete') {
        return jsonResponse(200, { etag: '"final-etag"' });
      }
      if (url === '/api/cloud-backup/abort') {
        return jsonResponse(200, { aborted: true });
      }
      if (url.startsWith('https://signed.example/part/')) {
        const partNumber = Number(url.split('/').pop());
        const attempts = (attemptsByPart.get(partNumber) ?? 0) + 1;
        attemptsByPart.set(partNumber, attempts);

        if (partNumber === 1 && attempts === 1) {
          return new Response('rate-limited', { status: 429, headers: { 'Retry-After': '0' } });
        }
        if (partNumber === 2 && attempts <= 2) {
          return new Response('rate-limited', { status: 429, headers: { 'Retry-After': '0' } });
        }
        return new Response('', { status: 200, headers: { etag: `"etag-${partNumber}-${attempts}"` } });
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await uploadEncryptedSnapshotMultipart({
      snapshotId: 'snapshot-retry',
      envelope: makeEnvelope(),
      maxAttempts: 3,
      concurrency: 1,
    });

    expect(result.partCount).toBe(2);
    expect(result.partRetries).toBe(3);
    expect(attemptsByPart.get(1)).toBe(2);
    expect(attemptsByPart.get(2)).toBe(3);
    expect(Math.max(...attemptsByPart.values())).toBeLessThanOrEqual(3);
  });

  it('retries transient thrown network exceptions during part uploads', async () => {
    let attempts = 0;

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/cloud-backup/init') {
        return jsonResponse(200, {
          provider: 'hippius',
          bucket: 'personafy-backups',
          key: 'vaults/user-1/snapshot.enc',
          uploadId: 'upload-1',
          partSizeBytes: PART_SIZE_128_MIB,
          partCount: 1,
          maxPartsPerRequest: 8,
        });
      }
      if (url === '/api/cloud-backup/presign-parts') {
        return jsonResponse(200, {
          urls: [{ partNumber: 1, url: 'https://signed.example/part/1' }],
        });
      }
      if (url === '/api/cloud-backup/complete') {
        return jsonResponse(200, { etag: '"final-etag"' });
      }
      if (url === '/api/cloud-backup/abort') {
        return jsonResponse(200, { aborted: true });
      }
      if (url === 'https://signed.example/part/1') {
        attempts += 1;
        if (attempts === 1) {
          throw new TypeError('Failed to fetch');
        }
        return new Response('', { status: 200, headers: { etag: '"etag-1-2"' } });
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await uploadEncryptedSnapshotMultipart({
      snapshotId: 'snapshot-network-retry',
      envelope: makeEnvelope(),
      maxAttempts: 2,
      concurrency: 1,
    });

    expect(result.partCount).toBe(1);
    expect(result.partRetries).toBe(1);
    expect(attempts).toBe(2);
  });
});

describe('cloudBackup restore validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('decrypts and returns validated vault payload for safe local apply', async () => {
    const restored = {
      version: '1.0',
      createdAt: new Date().toISOString(),
      privacyPosture: 'alarm_system',
      settings: {
        contextTtlMinutes: 10,
        hideHighSensitivity: true,
        approvalNotifications: true,
        cloudSyncEnabled: false,
      },
      personas: [],
      rules: [],
      auditLog: [],
    };
    vi.mocked(decryptVaultPayload).mockResolvedValueOnce(restored);
    vi.mocked(validateVaultImport).mockReturnValueOnce({
      ok: true,
      data: restored,
    } as never);

    await expect(decryptAndValidateCloudEnvelope(makeEnvelope(), 'passphrase')).resolves.toEqual(restored);
  });

  it('rejects tampered ciphertext with deterministic error code', async () => {
    vi.mocked(decryptVaultPayload).mockResolvedValueOnce({ tampered: true });
    vi.mocked(validateVaultImport).mockReturnValueOnce({
      ok: false,
      error: 'missing schema fields',
    } as never);

    await expect(decryptAndValidateCloudEnvelope(makeEnvelope(), 'passphrase')).rejects.toMatchObject({
      name: 'CloudBackupError',
      code: 'invalid_restored_vault',
      retryable: false,
    });
  });

  it('rejects non-envelope payloads with deterministic error code', async () => {
    await expect(decryptAndValidateCloudEnvelope({ encrypted: false }, 'passphrase')).rejects.toMatchObject({
      name: 'CloudBackupError',
      code: 'invalid_envelope',
      retryable: false,
    });
  });

  it('throws CloudBackupError instances for deterministic handling', async () => {
    vi.mocked(decryptVaultPayload).mockResolvedValueOnce({ invalid: true });
    vi.mocked(validateVaultImport).mockReturnValueOnce({
      ok: false,
      error: 'bad payload',
    } as never);

    await expect(decryptAndValidateCloudEnvelope(makeEnvelope(), 'passphrase')).rejects.toBeInstanceOf(CloudBackupError);
  });
});
