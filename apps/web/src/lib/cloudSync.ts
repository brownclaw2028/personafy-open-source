import type { VaultData } from './vault';
import { decryptVaultPayload, encryptVaultPayload, type EncryptedVaultEnvelope, isEncryptedEnvelope } from './cloudVaultCrypto';
import { getCloudProviderConfig } from './cloudProvider';
import { getSupabaseAccessToken, hasSupabaseConfig } from './supabase';
import { parseResponseError } from './utils';

const CLOUD_VERSION_KEY = 'personafy_cloud_version';

type CloudError = {
  ok: false;
  error: string;
  status?: number;
  notFound?: boolean;
  unauthorized?: boolean;
  conflict?: boolean;
  currentVersion?: number | null;
  updatedAt?: string;
};

type CloudSuccess<T> = { ok: true } & T;

function getCachedCloudVersion(): number | null {
  try {
    const raw = localStorage.getItem(CLOUD_VERSION_KEY);
    if (!raw) return null;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function setCachedCloudVersion(version: number | null) {
  try {
    if (version == null) localStorage.removeItem(CLOUD_VERSION_KEY);
    else localStorage.setItem(CLOUD_VERSION_KEY, String(version));
  } catch {
    // ignore storage failures
  }
}

async function fetchWithAuth(path: string, options?: RequestInit): Promise<Response | CloudError> {
  if (!hasSupabaseConfig()) {
    return { ok: false, error: 'Supabase not configured' };
  }
  const token = await getSupabaseAccessToken();
  if (!token) {
    return { ok: false, error: 'Sign in required', unauthorized: true };
  }
  const providerConfig = getCloudProviderConfig();
  const res = await fetch(path, {
    ...options,
    headers: {
      'X-Cloud-Sync-Provider': providerConfig.syncProvider,
      'X-Cloud-Backup-Provider': providerConfig.backupProvider,
      'X-Cloud-Migration-Mode': providerConfig.migrationMode,
      ...(options?.headers ?? {}),
      Authorization: `Bearer ${token}`,
    },
  });
  return res;
}

export async function fetchCloudEnvelope(): Promise<
  CloudSuccess<{ envelope: EncryptedVaultEnvelope; version: number; updatedAt?: string }> | CloudError
> {
  const res = await fetchWithAuth('/api/sync/pull');
  if (!(res instanceof Response)) return res;
  if (!res.ok) {
    const error = await parseResponseError(res);
    return {
      ok: false,
      error,
      status: res.status,
      notFound: res.status === 404,
      unauthorized: res.status === 401,
    };
  }
  const payload = await res.json();
  if (!payload || !isEncryptedEnvelope(payload.envelope)) {
    return { ok: false, error: 'Invalid cloud payload' };
  }
  return { ok: true, envelope: payload.envelope, version: payload.version, updatedAt: payload.updatedAt };
}

export async function pullCloudVault(
  passphrase: string,
): Promise<CloudSuccess<{ vault: VaultData; version: number; updatedAt?: string }> | CloudError> {
  const result = await fetchCloudEnvelope();
  if (!result.ok) return result;
  try {
    const decrypted = await decryptVaultPayload(result.envelope, passphrase);
    setCachedCloudVersion(result.version);
    return { ok: true, vault: decrypted as VaultData, version: result.version, updatedAt: result.updatedAt };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to decrypt vault';
    return { ok: false, error: msg };
  }
}

export async function initCloudVault(
  vault: VaultData,
  passphrase: string,
): Promise<CloudSuccess<{ version: number; updatedAt?: string }> | CloudError> {
  const envelope = await encryptVaultPayload(vault, passphrase);
  const res = await fetchWithAuth('/api/sync/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      vaultName: 'My Personal Vault',
      envelope,
      version: 1,
    }),
  });
  if (!(res instanceof Response)) return res;
  if (!res.ok) {
    const error = await parseResponseError(res);
    return { ok: false, error, status: res.status, unauthorized: res.status === 401 };
  }
  const payload = await res.json();
  if (typeof payload?.version === 'number') setCachedCloudVersion(payload.version);
  return { ok: true, version: payload.version ?? 1, updatedAt: payload.updatedAt };
}

export async function pushCloudVault(
  vault: VaultData,
  passphrase: string,
): Promise<CloudSuccess<{ version: number; updatedAt?: string }> | CloudError> {
  const envelope = await encryptVaultPayload(vault, passphrase);
  const ifMatchVersion = getCachedCloudVersion() ?? 0;
  const res = await fetchWithAuth('/api/sync/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      envelope,
      version: ifMatchVersion + 1,
      ifMatchVersion,
    }),
  });
  if (!(res instanceof Response)) return res;
  if (!res.ok) {
    if (res.status === 409) {
      let latestVersion: number | null = null;
      let updatedAt: string | undefined;
      let error = 'Version conflict. Pull latest cloud changes before pushing again.';
      try {
        const conflictBody = await res.json() as {
          error?: unknown;
          version?: unknown;
          currentVersion?: unknown;
          updatedAt?: unknown;
        };
        if (typeof conflictBody.error === 'string' && conflictBody.error.trim()) {
          error = conflictBody.error;
        }
        if (typeof conflictBody.currentVersion === 'number') {
          latestVersion = conflictBody.currentVersion;
        } else if (typeof conflictBody.version === 'number') {
          latestVersion = conflictBody.version;
        }
        if (typeof conflictBody.updatedAt === 'string') {
          updatedAt = conflictBody.updatedAt;
        }
      } catch {
        // ignore parse failure
      }

      // Best-effort cache refresh from pull path, but no auto-overwrite retry.
      if (latestVersion == null || updatedAt == null) {
        const pullRes = await fetchWithAuth('/api/sync/pull');
        if (pullRes instanceof Response && pullRes.ok) {
          try {
            const pullPayload = await pullRes.json();
            if (latestVersion == null && typeof pullPayload?.version === 'number') {
              latestVersion = pullPayload.version;
            }
            if (updatedAt == null && typeof pullPayload?.updatedAt === 'string') {
              updatedAt = pullPayload.updatedAt;
            }
          } catch {
            // ignore parse failure
          }
        }
      }

      if (latestVersion != null) {
        setCachedCloudVersion(latestVersion);
      }

      return {
        ok: false,
        error,
        status: 409,
        conflict: true,
        currentVersion: latestVersion,
        updatedAt,
      };
    }
    const error = await parseResponseError(res);
    return {
      ok: false,
      error,
      status: res.status,
      unauthorized: res.status === 401,
      notFound: res.status === 404,
    };
  }
  const payload = await res.json();
  if (typeof payload?.version === 'number') setCachedCloudVersion(payload.version);
  return { ok: true, version: payload.version ?? ifMatchVersion + 1, updatedAt: payload.updatedAt };
}
