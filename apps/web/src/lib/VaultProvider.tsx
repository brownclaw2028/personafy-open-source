// ─── Shared Vault Context ──────────────────────────────────────────────────
// Single provider for all vault data. Wraps the app once, all consumers share
// the same polling cycle and in-memory state.

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import { fetchVault, saveVault, type VaultData } from './vault';
import { hasSupabaseConfig } from './supabase';
import { trackEvent } from './posthog';
import { fetchCloudEnvelope, initCloudVault, pullCloudVault, pushCloudVault } from './cloudSync';
import {
  createSnapshotId,
  type CloudBackupProgress,
  CloudBackupError,
  decryptAndValidateCloudEnvelope,
  fetchCloudBackupUsage,
  fetchLatestCloudBackupEnvelope,
  uploadEncryptedSnapshotMultipart,
} from './cloudBackup';
import { getCloudProviderConfig, isCloudBackupDefaultOn } from './cloudProvider';
import { encryptVaultPayload } from './cloudVaultCrypto';
import { getCloudBackupMetricsSummary } from './telemetry/cloud-backup-metrics';
import { useNow } from './useNow';

// Re-export types so consumers can import from one place.
export type {
  VaultData,
  VaultFact,
  VaultPersona,
  VaultRule,
  VaultAuditEvent,
  VaultSettings,
  VaultDevice,
  PersonaSettings,
  AutoReleasePolicy,
  RetentionPeriod,
} from './vault';

interface VaultContextValue {
  vault: VaultData | null;
  loading: boolean;
  error: string | null;
  locked: boolean;
  /** Re-fetch vault from server immediately. */
  refresh: () => Promise<void>;
  /** Save vault + optimistic update + background refresh. Returns true if saved. */
  save: (data: VaultData, options?: { skipCloudSync?: boolean }) => Promise<boolean>;
  /** Store a passphrase for subsequent fetch/save calls (kept in-memory only). */
  setPassphrase: (passphrase: string | null) => void;
  /** Attempt to unlock the vault with a passphrase. */
  unlock: (passphrase: string) => Promise<void>;
  /** Clear passphrase and return to locked state. */
  lock: () => void;
  /** Cloud sync status (opt-in). */
  cloudSync: {
    status: 'disabled' | 'idle' | 'syncing' | 'error';
    lastSyncAt: string | null;
    lastError: string | null;
  };
  /** Initialize cloud sync (creates remote vault if missing). */
  cloudInit: () => Promise<boolean>;
  /** Push current vault to cloud (encrypted). */
  cloudPush: () => Promise<boolean>;
  /** Pull latest cloud vault and replace local (encrypted). */
  cloudPull: () => Promise<boolean>;
  /** Clear latest cloud sync error. */
  clearCloudError: () => void;
  /** Optional cloud backup posture + progress. */
  cloudBackup: {
    enabled: boolean;
    available: boolean;
    provider: 'supabase' | 'hippius';
    status: 'disabled' | 'idle' | 'preparing' | 'uploading' | 'finalizing' | 'restoring' | 'error';
    uploadedBytes: number;
    totalBytes: number;
    progressPercent: number;
    completedParts: number;
    totalParts: number;
    partRetries: number;
    lastSnapshotId: string | null;
    lastBackupAt: string | null;
    lastRestoreAt: string | null;
    lastError: string | null;
    retryable: boolean;
    diagnostics: string[];
  };
  setCloudBackupEnabled: (enabled: boolean) => void;
  cloudBackupUpload: () => Promise<boolean>;
  cloudBackupRetry: () => Promise<boolean>;
  cloudBackupCancel: () => void;
  cloudBackupRestore: () => Promise<boolean>;
  clearCloudBackupError: () => void;
  /** Count of user-interactive approval events in the last 24 hours. */
  recentApprovalCount: number;
}

const VaultContext = createContext<VaultContextValue | null>(null);

const CLOUD_BACKUP_ENABLED_KEY = 'personafy_cloud_backup_enabled';

type CloudBackupState = VaultContextValue['cloudBackup'];

function readCloudBackupOptInDefault(): boolean {
  const defaultOn = isCloudBackupDefaultOn();
  if (typeof window === 'undefined') return defaultOn;
  try {
    const raw = localStorage.getItem(CLOUD_BACKUP_ENABLED_KEY);
    if (raw == null) return defaultOn;
    return raw === 'true';
  } catch {
    return defaultOn;
  }
}

function getBackupAvailability(): { provider: 'supabase' | 'hippius'; available: boolean } {
  const cfg = getCloudProviderConfig();
  return {
    provider: cfg.backupProvider,
    available: cfg.backupProvider === 'hippius' && cfg.hippiusEnabled,
  };
}


/**
 * Single provider that polls /api/vault at `intervalMs`.
 * Mount once at the app root.
 */
export function VaultProvider({
  children,
  intervalMs = 5000,
}: {
  children: ReactNode;
  intervalMs?: number;
}) {
  const [vault, setVault] = useState<VaultData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [cloudSync, setCloudSync] = useState<{
    status: 'disabled' | 'idle' | 'syncing' | 'error';
    lastSyncAt: string | null;
    lastError: string | null;
  }>({ status: 'disabled', lastSyncAt: null, lastError: null });
  const initialCloudBackupEnabled = readCloudBackupOptInDefault();
  const initialBackupAvailability = getBackupAvailability();
  const [cloudBackup, setCloudBackup] = useState<CloudBackupState>({
    enabled: initialCloudBackupEnabled,
    available: initialBackupAvailability.available,
    provider: initialBackupAvailability.provider,
    status: initialCloudBackupEnabled ? 'idle' : 'disabled',
    uploadedBytes: 0,
    totalBytes: 0,
    progressPercent: 0,
    completedParts: 0,
    totalParts: 0,
    partRetries: 0,
    lastSnapshotId: null,
    lastBackupAt: null,
    lastRestoreAt: null,
    lastError: null,
    retryable: false,
    diagnostics: [],
  });

  // Passphrase kept in-memory only — cleared on page reload (security: no storage exposure).
  const passphraseRef = useRef<string | null>(null);
  const vaultRef = useRef<VaultData | null>(null);
  const cloudEnabledRef = useRef(false);
  const cloudQueueRef = useRef<Promise<boolean>>(Promise.resolve(true));
  const cloudBackupEnabledRef = useRef(cloudBackup.enabled);
  const cloudBackupAbortRef = useRef<AbortController | null>(null);

  const setPassphrase = useCallback((passphrase: string | null) => {
    passphraseRef.current = passphrase;
  }, []);

  const lock = useCallback(() => {
    setPassphrase(null);
    setLocked(true);
    setVault(null);
    setError('Vault locked. Enter your passphrase to continue.');
    trackEvent('vault_locked');
  }, [setPassphrase]);

  useEffect(() => {
    vaultRef.current = vault;
  }, [vault]);

  useEffect(() => {
    const enabled = Boolean(vault?.settings?.cloudSyncEnabled);
    cloudEnabledRef.current = enabled;
    if (!enabled) {
      setCloudSync((prev) => ({ ...prev, status: 'disabled', lastError: null }));
      return;
    }
    if (!hasSupabaseConfig()) {
      setCloudSync((prev) => ({
        ...prev,
        status: 'error',
        lastError: 'Supabase not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
      }));
      return;
    }
    setCloudSync((prev) => (prev.status === 'disabled' ? { ...prev, status: 'idle' } : prev));
  }, [vault?.settings?.cloudSyncEnabled]);

  useEffect(() => {
    cloudBackupEnabledRef.current = cloudBackup.enabled;
    try {
      localStorage.setItem(CLOUD_BACKUP_ENABLED_KEY, String(cloudBackup.enabled));
    } catch {
      // ignore storage failures
    }
  }, [cloudBackup.enabled]);

  useEffect(() => {
    const availability = getBackupAvailability();
    setCloudBackup((prev) => ({
      ...prev,
      provider: availability.provider,
      available: availability.available,
      status: prev.enabled
        ? (availability.available ? prev.status : 'error')
        : 'disabled',
      lastError: prev.enabled && !availability.available
        ? 'Hippius cloud backup is disabled by configuration flags.'
        : prev.lastError,
      diagnostics: prev.enabled && !availability.available
        ? ['Set VITE_CLOUD_BACKUP_PROVIDER=hippius and VITE_ENABLE_HIPPIUS_BACKUP=true.']
        : prev.diagnostics,
      retryable: prev.enabled && !availability.available ? false : prev.retryable,
    }));
  }, []);

  // Track current refresh request so we can abort on unmount.
  const abortRef = useRef<AbortController | null>(null);
  // Prevent overlap between interval ticks (slow networks). If refresh takes
  // longer than intervalMs, we skip starting a new refresh instead of aborting.
  const refreshInFlightRef = useRef<Promise<void> | null>(null);
  const refreshInFlightEpochRef = useRef<number | null>(null);

  // Track enqueued saves so interval refresh can't clobber optimistic state.
  // (Example: save A then B — a refresh after A should not overwrite optimistic B.)
  const pendingSavesRef = useRef(0);
  const refreshNeededRef = useRef(false);
  // Monotonic counter: any save bumps this so we can ignore stale refresh results.
  const saveEpochRef = useRef(0);

  const updateCloud = useCallback(
    (patch: Partial<{ status: 'disabled' | 'idle' | 'syncing' | 'error'; lastSyncAt: string | null; lastError: string | null }>) => {
      setCloudSync((prev) => {
        const changed = Object.keys(patch).some(k => prev[k as keyof typeof prev] !== patch[k as keyof typeof patch]);
        if (!changed) return prev;
        return { ...prev, ...patch };
      });
    },
    [],
  );

  const updateCloudBackup = useCallback((patch: Partial<CloudBackupState>) => {
    setCloudBackup((prev) => {
      const next = { ...prev, ...patch };
      const changed = Object.keys(next).some((key) => {
        const k = key as keyof CloudBackupState;
        if (Array.isArray(prev[k]) && Array.isArray(next[k])) {
          const prevValue = prev[k] as unknown[];
          const nextValue = next[k] as unknown[];
          if (prevValue.length !== nextValue.length) return true;
          return prevValue.some((row, idx) => row !== nextValue[idx]);
        }
        return prev[k] !== next[k];
      });
      return changed ? next : prev;
    });
  }, []);

  const enqueueCloudPush = useCallback((data: VaultData): Promise<boolean> => {
    if (!cloudEnabledRef.current) return Promise.resolve(false);
    if (!hasSupabaseConfig()) {
      updateCloud({
        status: 'error',
        lastError: 'Supabase not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
      });
      return Promise.resolve(false);
    }
    const passphrase = passphraseRef.current;
    if (!passphrase) {
      updateCloud({
        status: 'error',
        lastError: 'Vault locked. Unlock to sync with cloud.',
      });
      return Promise.resolve(false);
    }

    cloudQueueRef.current = cloudQueueRef.current
      .catch(() => false)
      .then(async () => {
        updateCloud({ status: 'syncing', lastError: null });
        const result = await pushCloudVault(data, passphrase);
        if (result.ok) {
          updateCloud({ status: 'idle', lastSyncAt: new Date().toISOString(), lastError: null });
          return true;
        }
        if (result.conflict) {
          const versionInfo = result.currentVersion == null ? '' : ` (cloud version ${result.currentVersion})`;
          updateCloud({
            status: 'error',
            lastError: `${result.error}${versionInfo}. Pull from cloud, resolve conflicts, then push again.`,
          });
          return false;
        }
        updateCloud({ status: 'error', lastError: result.error });
        return false;
      });

    return cloudQueueRef.current;
  }, [updateCloud]);

  const cloudInit = useCallback(async (): Promise<boolean> => {
    if (!cloudEnabledRef.current) return false;
    if (!hasSupabaseConfig()) {
      updateCloud({
        status: 'error',
        lastError: 'Supabase not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
      });
      return false;
    }
    const passphrase = passphraseRef.current;
    if (!passphrase) {
      updateCloud({ status: 'error', lastError: 'Vault locked. Unlock to enable cloud sync.' });
      return false;
    }
    const currentVault = vaultRef.current;
    if (!currentVault) {
      updateCloud({ status: 'error', lastError: 'Vault not loaded yet.' });
      return false;
    }

    updateCloud({ status: 'syncing', lastError: null });
    const existing = await fetchCloudEnvelope();
    if (existing.ok) {
      updateCloud({ status: 'idle' });
      return true;
    }
    if (existing.notFound) {
      const initResult = await initCloudVault(currentVault, passphrase);
      if (initResult.ok) {
        updateCloud({ status: 'idle', lastSyncAt: new Date().toISOString(), lastError: null });
        return true;
      }
      updateCloud({ status: 'error', lastError: initResult.error });
      return false;
    }
    updateCloud({ status: 'error', lastError: existing.error });
    return false;
  }, [updateCloud]);

  const cloudPush = useCallback(async (): Promise<boolean> => {
    const currentVault = vaultRef.current;
    if (!currentVault) {
      updateCloud({ status: 'error', lastError: 'Vault not loaded yet.' });
      return false;
    }
    return enqueueCloudPush(currentVault);
  }, [enqueueCloudPush, updateCloud]);

  const clearCloudError = useCallback(() => {
    setCloudSync((prev) => ({
      ...prev,
      lastError: null,
      status: cloudEnabledRef.current ? 'idle' : 'disabled',
    }));
  }, []);

  const refresh = useCallback((): Promise<void> => {
    // If saves are queued, schedule a refresh once the queue drains.
    if (pendingSavesRef.current > 0) {
      refreshNeededRef.current = true;
      return Promise.resolve();
    }

    const epochAtStart = saveEpochRef.current;

    // Skip overlap between interval ticks, but only if the in-flight request
    // started after the latest save epoch.
    if (
      refreshInFlightRef.current &&
      refreshInFlightEpochRef.current === epochAtStart
    ) {
      return refreshInFlightRef.current;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    refreshInFlightEpochRef.current = epochAtStart;

    const p = (async () => {
      try {
        const passphrase = passphraseRef.current;
        const result = await fetchVault(controller.signal, passphrase ?? undefined);
        if (controller.signal.aborted) return;

        // Discard stale responses if any save started while we were fetching.
        if (saveEpochRef.current !== epochAtStart) return;

        // Avoid clobbering optimistic state while saves are queued.
        if (pendingSavesRef.current > 0) return;

        if (result.ok) {
          setVault(result.data);
          setError(null);
          setLocked(false);
        } else if (result.locked) {
          // If vault was previously loaded successfully, treat a transient 401
          // as a temporary error (e.g. concurrent write re-encrypting the file)
          // rather than clearing the passphrase and locking out the user.
          if (vaultRef.current && passphraseRef.current) {
            setError(result.error);
          } else if (!vaultRef.current && passphraseRef.current) {
            // Initial load with passphrase but got 401 — likely transient
            // (concurrent write). Retry once after a short delay before giving up.
            setError(result.error);
            setTimeout(() => {
              if (!vaultRef.current && passphraseRef.current) {
                void refresh().catch(() => {});
              }
            }, 500);
          } else {
            // No passphrase at all — mark locked so UI shows passphrase prompt.
            setLocked(true);
            setVault(null);
            setError(result.error);
          }
        } else {
          setLocked(false);
          setError(result.error);
        }
      } catch {
        if (!controller.signal.aborted && pendingSavesRef.current === 0) {
          setError('Could not load vault data');
        }
      } finally {
        setLoading(false);
        if (abortRef.current === controller) {
          refreshInFlightRef.current = null;
          refreshInFlightEpochRef.current = null;
          abortRef.current = null;
        }
      }
    })();

    refreshInFlightRef.current = p;
    return p;
  }, []);

  // Serialized save queue — each save waits for the previous to finish so
  // rapid changes (e.g., toggling multiple Settings switches) don't clobber.
  const saveQueueRef = useRef<Promise<boolean>>(Promise.resolve(true));

  const save = useCallback(
    (data: VaultData, options?: { skipCloudSync?: boolean }): Promise<boolean> => {
      // Optimistic: update local state immediately for snappy UI
      setVault(data);

      // Any save invalidates any in-flight refresh response.
      saveEpochRef.current += 1;

      // Track queued saves so refresh doesn't clobber optimistic state.
      pendingSavesRef.current += 1;

      // Chain onto the queue so saves execute serially.
      // Catch any rejection so a single failed save doesn't break the queue.
      const queued = saveQueueRef.current
        .catch(() => false) // Ensure chain continues even if previous save threw
        .then(async () => {
          try {
            const result = await saveVault(data, passphraseRef.current ?? undefined);
            const ok = result.ok;
            if (!ok && result.locked) {
              setPassphrase(null);
              setLocked(true);
              setError(result.error);
            }
            if (ok && !options?.skipCloudSync) {
              void enqueueCloudPush(data);
            }
            if (ok) {
              trackEvent('vault_saved', {
                persona_count: data.personas?.length ?? 0,
                posture: data.privacyPosture,
                has_rules: (data.rules?.length ?? 0) > 0,
              });
            }
            // Queue a sync refresh once all saves drain.
            refreshNeededRef.current = true;
            return ok;
          } catch {
            refreshNeededRef.current = true;
            return false;
          } finally {
            pendingSavesRef.current -= 1;
            if (pendingSavesRef.current === 0 && refreshNeededRef.current) {
              refreshNeededRef.current = false;
              // Void + catch to prevent unhandled rejection.
              void refresh().catch(() => {});
            }
          }
        });

      saveQueueRef.current = queued;
      return queued;
    },
    [enqueueCloudPush, refresh, setPassphrase],
  );

  const cloudPull = useCallback(async (): Promise<boolean> => {
    if (!cloudEnabledRef.current) return false;
    if (!hasSupabaseConfig()) {
      updateCloud({
        status: 'error',
        lastError: 'Supabase not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
      });
      return false;
    }
    const passphrase = passphraseRef.current;
    if (!passphrase) {
      updateCloud({ status: 'error', lastError: 'Vault locked. Unlock to sync with cloud.' });
      return false;
    }

    updateCloud({ status: 'syncing', lastError: null });
    const result = await pullCloudVault(passphrase);
    if (!result.ok) {
      updateCloud({ status: 'error', lastError: result.error });
      return false;
    }

    // Skip pull if local version is newer or equal
    const localVersion = vaultRef.current?.version;
    if (localVersion != null && result.version != null) {
      const localNum = typeof localVersion === 'string' ? parseFloat(localVersion) : localVersion;
      if (Number.isFinite(localNum) && localNum >= result.version) {
        console.warn(`cloudPull: local version (${localNum}) >= cloud version (${result.version}), skipping overwrite`);
        updateCloud({ status: 'idle', lastError: null });
        return true;
      }
    }

    const ok = await save(result.vault, { skipCloudSync: true });
    if (ok) {
      updateCloud({ status: 'idle', lastSyncAt: new Date().toISOString(), lastError: null });
      return true;
    }
    updateCloud({ status: 'error', lastError: 'Failed to apply cloud vault locally.' });
    return false;
  }, [save, updateCloud]);

  const setCloudBackupEnabled = useCallback((enabled: boolean) => {
    if (!enabled) {
      cloudBackupAbortRef.current?.abort();
      cloudBackupAbortRef.current = null;
    }
    setCloudBackup((prev) => ({
      ...prev,
      enabled,
      status: enabled
        ? (prev.available ? 'idle' : 'error')
        : 'disabled',
      uploadedBytes: 0,
      totalBytes: 0,
      progressPercent: 0,
      completedParts: 0,
      totalParts: 0,
      partRetries: 0,
      lastError: enabled && !prev.available
        ? 'Hippius cloud backup is disabled by configuration flags.'
        : null,
      retryable: false,
      diagnostics: enabled && !prev.available
        ? ['Set VITE_CLOUD_BACKUP_PROVIDER=hippius and VITE_ENABLE_HIPPIUS_BACKUP=true.']
        : [],
    }));
  }, []);

  const clearCloudBackupError = useCallback(() => {
    setCloudBackup((prev) => ({
      ...prev,
      lastError: null,
      retryable: false,
      diagnostics: [],
      status: prev.enabled
        ? (prev.available ? 'idle' : 'error')
        : 'disabled',
    }));
  }, []);

  const cloudBackupCancel = useCallback(() => {
    const controller = cloudBackupAbortRef.current;
    if (!controller) return;
    updateCloudBackup({
      status: 'idle',
      lastError: 'Cloud backup cancelled.',
      retryable: true,
      diagnostics: ['Upload was cancelled before completion.'],
    });
    controller.abort();
    cloudBackupAbortRef.current = null;
    trackEvent('cloud_backup_cancelled');
  }, [updateCloudBackup]);

  const cloudBackupUpload = useCallback(async (): Promise<boolean> => {
    if (!cloudBackupEnabledRef.current) {
      updateCloudBackup({
        status: 'disabled',
        lastError: 'Enable Cloud Backup before uploading.',
        retryable: false,
        diagnostics: [],
      });
      return false;
    }

    const currentVault = vaultRef.current;
    if (!currentVault) {
      updateCloudBackup({
        status: 'error',
        lastError: 'Vault not loaded yet.',
        retryable: true,
        diagnostics: [],
      });
      return false;
    }
    const passphrase = passphraseRef.current;
    if (!passphrase) {
      updateCloudBackup({
        status: 'error',
        lastError: 'Unlock your vault to create encrypted cloud backups.',
        retryable: false,
        diagnostics: ['Cloud backup requires an in-memory vault passphrase.'],
      });
      return false;
    }

    const availability = getBackupAvailability();
    if (!availability.available) {
      updateCloudBackup({
        provider: availability.provider,
        available: availability.available,
        status: 'error',
        lastError: 'Cloud backup provider is not enabled.',
        retryable: false,
        diagnostics: ['Set VITE_CLOUD_BACKUP_PROVIDER=hippius and VITE_ENABLE_HIPPIUS_BACKUP=true.'],
      });
      return false;
    }

    const snapshotId = createSnapshotId();
    const controller = new AbortController();
    cloudBackupAbortRef.current = controller;

    try {
      updateCloudBackup({
        provider: availability.provider,
        available: availability.available,
        status: 'preparing',
        uploadedBytes: 0,
        totalBytes: 0,
        progressPercent: 0,
        completedParts: 0,
        totalParts: 0,
        partRetries: 0,
        lastError: null,
        retryable: false,
        diagnostics: [],
      });

      const envelope = await encryptVaultPayload(currentVault, passphrase);
      const result = await uploadEncryptedSnapshotMultipart({
        snapshotId,
        envelope,
        signal: controller.signal,
        onProgress: (progress: CloudBackupProgress) => {
          updateCloudBackup({
            status: progress.completedParts >= progress.totalParts ? 'finalizing' : 'uploading',
            uploadedBytes: progress.uploadedBytes,
            totalBytes: progress.totalBytes,
            progressPercent: progress.percent,
            completedParts: progress.completedParts,
            totalParts: progress.totalParts,
            partRetries: progress.partRetries,
          });
        },
      });

      let usageLine = 'Usage unavailable';
      try {
        const usage = await fetchCloudBackupUsage(controller.signal);
        const usedGb = (usage.usage.usedBytes / (1024 ** 3)).toFixed(2);
        const pct = usage.usage.usagePercent == null ? 'n/a' : `${usage.usage.usagePercent}%`;
        usageLine = `Usage: ${usedGb} GB (${pct}) via ${usage.method}`;
      } catch {
        usageLine = 'Usage lookup unavailable (RPC endpoint/method may be unconfigured).';
      }
      const metricsSummary = getCloudBackupMetricsSummary();

      updateCloudBackup({
        status: 'idle',
        lastSnapshotId: result.snapshotId,
        lastBackupAt: new Date().toISOString(),
        uploadedBytes: result.totalBytes,
        totalBytes: result.totalBytes,
        progressPercent: 100,
        completedParts: result.partCount,
        totalParts: result.partCount,
        partRetries: result.partRetries,
        lastError: null,
        retryable: false,
        diagnostics: [
          `Provider: ${result.provider}`,
          `Object key: ${result.key}`,
          `Upload latency: ${result.metrics.durationMs}ms`,
          `Multipart retries: ${result.partRetries}`,
          `429 responses (rolling): ${metricsSummary.total429Responses}`,
          `Completion rate (rolling): ${(metricsSummary.completionRate * 100).toFixed(1)}%`,
          usageLine,
        ],
      });
      trackEvent('cloud_backup_completed', {
        provider: result.provider,
        part_count: result.partCount,
        part_retries: result.partRetries,
        bytes: result.totalBytes,
      });
      return true;
    } catch (err) {
      const normalized = err instanceof CloudBackupError
        ? err
        : new CloudBackupError({
          code: 'cloud_backup_failed',
          message: err instanceof Error ? err.message : 'Cloud backup failed.',
          retryable: false,
        });
      const cancelled = normalized.code === 'backup_cancelled';
      const metricsSummary = getCloudBackupMetricsSummary();
      updateCloudBackup({
        status: cloudBackupEnabledRef.current ? 'idle' : 'disabled',
        lastError: cancelled ? 'Cloud backup cancelled.' : normalized.message,
        retryable: cancelled || normalized.retryable,
        diagnostics: cancelled
          ? ['Upload was cancelled before completion.']
          : [
              `Code: ${normalized.code}`,
              ...(normalized.status ? [`HTTP status: ${normalized.status}`] : []),
              `429 responses (rolling): ${metricsSummary.total429Responses}`,
              `Completion rate (rolling): ${(metricsSummary.completionRate * 100).toFixed(1)}%`,
            ],
      });
      if (cancelled) {
        trackEvent('cloud_backup_cancelled');
      } else {
        trackEvent('cloud_backup_failed', {
          code: normalized.code,
          status: normalized.status ?? null,
        });
      }
      return false;
    } finally {
      if (cloudBackupAbortRef.current === controller) {
        cloudBackupAbortRef.current = null;
      }
    }
  }, [updateCloudBackup]);

  const cloudBackupRetry = useCallback(async (): Promise<boolean> => {
    return cloudBackupUpload();
  }, [cloudBackupUpload]);

  const cloudBackupRestore = useCallback(async (): Promise<boolean> => {
    if (!cloudBackupEnabledRef.current) {
      updateCloudBackup({
        status: 'disabled',
        lastError: 'Enable Cloud Backup before restoring.',
        retryable: false,
        diagnostics: [],
      });
      return false;
    }
    const passphrase = passphraseRef.current;
    if (!passphrase) {
      updateCloudBackup({
        status: 'error',
        lastError: 'Unlock your vault before restore.',
        retryable: false,
        diagnostics: ['Restore needs your local passphrase for decrypt verification.'],
      });
      return false;
    }

    try {
      updateCloudBackup({
        status: 'restoring',
        lastError: null,
        retryable: false,
        diagnostics: ['Downloading latest encrypted cloud backup snapshot.'],
      });
      const latestSnapshot = await fetchLatestCloudBackupEnvelope();
      const restoredVault = await decryptAndValidateCloudEnvelope(latestSnapshot.envelope, passphrase);
      const ok = await save(restoredVault, { skipCloudSync: true });
      if (!ok) {
        updateCloudBackup({
          status: 'error',
          lastError: 'Failed to apply restored vault locally.',
          retryable: true,
          diagnostics: ['Vault save returned a failure response.'],
        });
        return false;
      }
      let usageLine = 'Usage unavailable';
      try {
        const usage = await fetchCloudBackupUsage();
        const usedGb = (usage.usage.usedBytes / (1024 ** 3)).toFixed(2);
        const pct = usage.usage.usagePercent == null ? 'n/a' : `${usage.usage.usagePercent}%`;
        usageLine = `Usage after restore: ${usedGb} GB (${pct}) via ${usage.method}`;
      } catch {
        usageLine = 'Usage lookup unavailable (RPC endpoint/method may be unconfigured).';
      }
      const metricsSummary = getCloudBackupMetricsSummary();
      updateCloudBackup({
        status: 'idle',
        lastRestoreAt: new Date().toISOString(),
        lastError: null,
        retryable: false,
        diagnostics: [
          'Cloud snapshot decrypted locally and applied safely.',
          `Restored snapshot: ${latestSnapshot.snapshotId}`,
          `Completion rate (rolling): ${(metricsSummary.completionRate * 100).toFixed(1)}%`,
          usageLine,
        ],
      });
      trackEvent('cloud_backup_restore_completed');
      return true;
    } catch (err) {
      const normalized = err instanceof CloudBackupError
        ? err
        : new CloudBackupError({
          code: 'cloud_restore_failed',
          message: err instanceof Error ? err.message : 'Cloud restore failed.',
          retryable: false,
        });
      updateCloudBackup({
        status: 'error',
        lastError: normalized.message,
        retryable: normalized.retryable,
        diagnostics: normalized.code === 'backup_snapshot_not_found'
          ? ['No cloud backup snapshot was found for this account.']
          : [
              `Code: ${normalized.code}`,
              ...(normalized.status ? [`HTTP status: ${normalized.status}`] : []),
            ],
      });
      trackEvent('cloud_backup_restore_failed', {
        code: normalized.code,
        status: normalized.status ?? null,
      });
      return false;
    }
  }, [save, updateCloudBackup]);

  useEffect(() => {
    // Initial data fetch — standard subscription pattern
    refresh();

    const timer = setInterval(() => {
      if (document.hidden) return;
      if (pendingSavesRef.current > 0) return;
      refresh();
    }, intervalMs);

    // Refresh when the tab regains visibility — recovers from failed initial
    // fetches that occurred while the tab was hidden or during server contention.
    const onVisibilityChange = () => {
      if (!document.hidden) {
        refresh();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      abortRef.current?.abort();
    };
  }, [refresh, intervalMs]);

  const unlock = useCallback(async (passphrase: string) => {
    setPassphrase(passphrase);
    await refresh();
    trackEvent('vault_unlocked');
  }, [refresh, setPassphrase]);

  // Compute recent (24h) user-interactive approval count once, share via context.
  const now = useNow(60_000);
  const recentApprovalCount = useMemo(() => {
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    return vault?.auditLog?.filter(e => {
      if (typeof e.purpose !== 'string' || typeof e.recipientDomain !== 'string') return false;
      if (e.purpose.startsWith('rule_created')) return false;
      if (e.decision !== 'ask_approved' && e.decision !== 'ask_denied') return false;
      const ts = new Date(e.timestamp).getTime();
      return !isNaN(ts) && ts > oneDayAgo;
    }).length ?? 0;
  }, [vault?.auditLog, now]);

  const contextValue = useMemo<VaultContextValue>(() => ({
    vault,
    loading,
    error,
    locked,
    refresh,
    save,
    setPassphrase,
    unlock,
    lock,
    cloudSync,
    cloudInit,
    cloudPush,
    cloudPull,
    clearCloudError,
    cloudBackup,
    setCloudBackupEnabled,
    cloudBackupUpload,
    cloudBackupRetry,
    cloudBackupCancel,
    cloudBackupRestore,
    clearCloudBackupError,
    recentApprovalCount,
  }), [
    vault,
    loading,
    error,
    locked,
    refresh,
    save,
    setPassphrase,
    unlock,
    lock,
    cloudSync,
    cloudInit,
    cloudPush,
    cloudPull,
    clearCloudError,
    cloudBackup,
    setCloudBackupEnabled,
    cloudBackupUpload,
    cloudBackupRetry,
    cloudBackupCancel,
    cloudBackupRestore,
    clearCloudBackupError,
    recentApprovalCount,
  ]);

  return (
    <VaultContext.Provider value={contextValue}>
      {children}
    </VaultContext.Provider>
  );
}

/**
 * Read vault data from the nearest <VaultProvider>.
 * Returns `{ vault, loading, error, refresh, save }`.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useVault() {
  const ctx = useContext(VaultContext);
  if (!ctx) {
    throw new Error(
      'useVault() must be used inside <VaultProvider>. Wrap your app in <VaultProvider>.',
    );
  }
  return ctx;
}
