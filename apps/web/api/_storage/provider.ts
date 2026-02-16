import { hippiusProvider } from './providers/hippiusProvider';
import { supabaseProvider } from './providers/supabaseProvider';

export type StorageProviderName = 'supabase' | 'hippius';

export interface PullCloudVaultResult {
  envelope: unknown;
  version: number;
  updatedAt?: string;
}

export interface InitCloudVaultInput {
  userId: string;
  vaultName: string;
  envelope: unknown;
  version: number;
  nowIso: string;
}

export interface PushCloudVaultInput {
  userId: string;
  envelope: unknown;
  ifMatchVersion: number;
  version: number;
  nowIso: string;
}

export type PushCloudVaultResult =
  | {
    ok: true;
    version: number;
    updatedAt?: string;
  }
  | {
    ok: false;
    status: 409;
    error: 'Version conflict' | 'Cloud vault already exists';
    currentVersion?: number | null;
    updatedAt?: string;
  };

export interface CloudSyncStorageProvider {
  readonly name: StorageProviderName;
  pullLatestVault(input: { userId: string }): Promise<PullCloudVaultResult | null>;
  initVault(input: InitCloudVaultInput): Promise<{ version: number; updatedAt?: string }>;
  pushVault(input: PushCloudVaultInput): Promise<PushCloudVaultResult>;
}

function normalizeProviderName(raw: string | undefined): StorageProviderName | null {
  if (!raw) return null;
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'supabase' || normalized === 'hippius') {
    return normalized;
  }
  return null;
}

function getConfiguredProvider(): StorageProviderName {
  const fromEnv = normalizeProviderName(
    process.env.CLOUD_SYNC_PROVIDER
    ?? process.env.CLOUD_BACKUP_PROVIDER
    ?? process.env.VITE_CLOUD_BACKUP_PROVIDER,
  );
  return fromEnv ?? 'supabase';
}

export function resolveCloudSyncStorageProvider(): CloudSyncStorageProvider {
  const providerName = getConfiguredProvider();
  if (providerName === 'hippius') {
    return hippiusProvider;
  }
  return supabaseProvider;
}
