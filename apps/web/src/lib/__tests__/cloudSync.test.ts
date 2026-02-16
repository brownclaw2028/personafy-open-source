import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EncryptedVaultEnvelope } from '../cloudVaultCrypto';
import { decryptVaultPayload, encryptVaultPayload } from '../cloudVaultCrypto';
import { pullCloudVault, pushCloudVault } from '../cloudSync';
import type { VaultData } from '../vault';

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

vi.mock('../utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils')>();
  return {
    ...actual,
    parseResponseError: vi.fn(async () => 'Temporary cloud error'),
  };
});

vi.mock('../cloudVaultCrypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../cloudVaultCrypto')>();
  return {
    ...actual,
    decryptVaultPayload: vi.fn(),
    encryptVaultPayload: vi.fn(),
    isEncryptedEnvelope: vi.fn((value: unknown) => {
      if (!value || typeof value !== 'object') return false;
      return (value as { encrypted?: unknown }).encrypted === true;
    }),
  };
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('cloudSync restore flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('decrypts cloud payload locally and returns restored vault data', async () => {
    const envelope = {
      encrypted: true,
      version: 1,
      kdf: 'pbkdf2',
      kdfParams: { iterations: 600000, hash: 'SHA-256', dkLen: 32 },
      cipher: 'aes-256-gcm',
      salt: 'c2FsdA==',
      iv: 'aXY=',
      tag: 'dGFn',
      ciphertext: 'ZW5jcnlwdGVk',
    };
    const restored = {
      version: '1.0',
      createdAt: new Date().toISOString(),
      privacyPosture: 'alarm_system',
      settings: {
        contextTtlMinutes: 30,
        hideHighSensitivity: true,
        approvalNotifications: true,
        cloudSyncEnabled: false,
      },
      personas: [],
      rules: [],
      auditLog: [],
    };
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/sync/pull') {
        return jsonResponse(200, { envelope, version: 9, updatedAt: '2026-02-14T00:00:00.000Z' });
      }
      throw new Error(`Unexpected URL ${url}`);
    }));
    vi.mocked(decryptVaultPayload).mockResolvedValueOnce(restored);

    const result = await pullCloudVault('correct horse battery staple');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.vault).toEqual(restored);
    expect(result.version).toBe(9);
    expect(vi.mocked(decryptVaultPayload)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(decryptVaultPayload).mock.calls[0][0]).toEqual(envelope);
  });

  it('is recoverable after transient restore fetch failures', async () => {
    const envelope = {
      encrypted: true,
      version: 1,
      kdf: 'pbkdf2',
      kdfParams: { iterations: 600000, hash: 'SHA-256', dkLen: 32 },
      cipher: 'aes-256-gcm',
      salt: 'c2FsdA==',
      iv: 'aXY=',
      tag: 'dGFn',
      ciphertext: 'ZW5jcnlwdGVk',
    };
    const restored = {
      version: '1.0',
      createdAt: new Date().toISOString(),
      privacyPosture: 'alarm_system',
      settings: {
        contextTtlMinutes: 60,
        hideHighSensitivity: true,
        approvalNotifications: true,
        cloudSyncEnabled: false,
      },
      personas: [],
      rules: [],
      auditLog: [],
    };

    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url !== '/api/sync/pull') throw new Error(`Unexpected URL ${url}`);
      calls += 1;
      if (calls === 1) {
        return jsonResponse(503, { error: 'temporary outage' });
      }
      return jsonResponse(200, { envelope, version: 10 });
    }));
    vi.mocked(decryptVaultPayload).mockResolvedValue(restored);

    const first = await pullCloudVault('passphrase');
    const second = await pullCloudVault('passphrase');

    expect(first.ok).toBe(false);
    expect(second.ok).toBe(true);
    if (!first.ok) {
      expect(first.error).toBe('Temporary cloud error');
      expect(first.status).toBe(503);
    }
    if (second.ok) {
      expect(second.vault.settings?.contextTtlMinutes).toBe(60);
      expect(second.version).toBe(10);
    }
  });
});

describe('cloudSync push conflict behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns explicit conflict metadata and does not auto-overwrite on 409', async () => {
    const envelope: EncryptedVaultEnvelope = {
      encrypted: true,
      version: 1,
      kdf: 'pbkdf2',
      kdfParams: { iterations: 600000, hash: 'SHA-256', dkLen: 32 },
      cipher: 'aes-256-gcm',
      salt: 'c2FsdA==',
      iv: 'aXY=',
      tag: 'dGFn',
      ciphertext: 'ZW5jcnlwdGVk',
    };
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url === '/api/sync/push') {
        return jsonResponse(409, {
          error: 'Version conflict',
          currentVersion: 12,
          updatedAt: '2026-02-15T02:00:00.000Z',
        });
      }
      throw new Error(`Unexpected URL ${url}`);
    }));
    vi.mocked(encryptVaultPayload).mockResolvedValueOnce(envelope);

    const vault: VaultData = {
      version: '1.0',
      createdAt: new Date().toISOString(),
      privacyPosture: 'alarm_system',
      settings: {
        contextTtlMinutes: 30,
        hideHighSensitivity: true,
        approvalNotifications: true,
        cloudSyncEnabled: true,
      },
      personas: [],
      rules: [],
      auditLog: [],
    };
    const result = await pushCloudVault(vault, 'passphrase');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.conflict).toBe(true);
    expect(result.currentVersion).toBe(12);
    expect(result.updatedAt).toBe('2026-02-15T02:00:00.000Z');
    expect(calls).toEqual(['/api/sync/push']);
  });

  it('best-effort refreshes conflict version from pull endpoint without retrying push', async () => {
    const envelope: EncryptedVaultEnvelope = {
      encrypted: true,
      version: 1,
      kdf: 'pbkdf2',
      kdfParams: { iterations: 600000, hash: 'SHA-256', dkLen: 32 },
      cipher: 'aes-256-gcm',
      salt: 'c2FsdA==',
      iv: 'aXY=',
      tag: 'dGFn',
      ciphertext: 'ZW5jcnlwdGVk',
    };
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url === '/api/sync/push') {
        return jsonResponse(409, { error: 'Version conflict' });
      }
      if (url === '/api/sync/pull') {
        return jsonResponse(200, {
          envelope,
          version: 8,
          updatedAt: '2026-02-15T03:00:00.000Z',
        });
      }
      throw new Error(`Unexpected URL ${url}`);
    }));
    vi.mocked(encryptVaultPayload).mockResolvedValueOnce(envelope);

    const vault: VaultData = {
      version: '1.0',
      createdAt: new Date().toISOString(),
      privacyPosture: 'alarm_system',
      settings: {
        contextTtlMinutes: 30,
        hideHighSensitivity: true,
        approvalNotifications: true,
        cloudSyncEnabled: true,
      },
      personas: [],
      rules: [],
      auditLog: [],
    };
    const result = await pushCloudVault(vault, 'passphrase');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.conflict).toBe(true);
    expect(result.currentVersion).toBe(8);
    expect(result.updatedAt).toBe('2026-02-15T03:00:00.000Z');
    expect(calls).toEqual(['/api/sync/push', '/api/sync/pull']);
  });
});
