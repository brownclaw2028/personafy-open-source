// ============================================================================
// Cloud Provider Boundary
// ----------------------------------------------------------------------------
// Phase 0 guardrail module for rollout control. This file intentionally
// centralizes provider and migration flags without changing runtime behavior.
// ============================================================================

export type CloudSyncProvider = 'supabase';
export type CloudBackupProvider = 'supabase' | 'hippius';
export type CloudMigrationMode = 'supabase-only' | 'coexist' | 'hippius-only';

export interface CloudProviderConfig {
  migrationMode: CloudMigrationMode;
  syncProvider: CloudSyncProvider;
  backupProvider: CloudBackupProvider;
  hippiusEnabled: boolean;
  cloudBackupDefaultOn: boolean;
}

const VALID_MIGRATION_MODES: ReadonlySet<string> = new Set([
  'supabase-only',
  'coexist',
  'hippius-only',
]);

const VALID_BACKUP_PROVIDERS: ReadonlySet<string> = new Set(['supabase', 'hippius']);

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return fallback;
}

function normalizeString(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function getEnv(name: keyof ImportMetaEnv): string | undefined {
  return normalizeString(import.meta.env[name]);
}

function resolveMigrationMode(raw: string | undefined): CloudMigrationMode {
  if (raw && VALID_MIGRATION_MODES.has(raw)) {
    return raw as CloudMigrationMode;
  }
  return 'supabase-only';
}

function resolveBackupProvider(raw: string | undefined): CloudBackupProvider {
  if (raw && VALID_BACKUP_PROVIDERS.has(raw)) {
    return raw as CloudBackupProvider;
  }
  return 'supabase';
}

function resolveHippiusEnabled(migrationMode: CloudMigrationMode, backupProvider: CloudBackupProvider): boolean {
  // Hippius can be enabled explicitly or inferred from migration mode/provider.
  const explicitFlag = parseBoolean(getEnv('VITE_ENABLE_HIPPIUS_BACKUP'), false);
  return explicitFlag || migrationMode !== 'supabase-only' || backupProvider === 'hippius';
}

export function getCloudProviderConfig(): CloudProviderConfig {
  const migrationMode = resolveMigrationMode(getEnv('VITE_CLOUD_MIGRATION_MODE'));
  const backupProvider = resolveBackupProvider(getEnv('VITE_CLOUD_BACKUP_PROVIDER'));

  return {
    migrationMode,
    syncProvider: 'supabase',
    backupProvider,
    hippiusEnabled: resolveHippiusEnabled(migrationMode, backupProvider),
    cloudBackupDefaultOn: parseBoolean(getEnv('VITE_CLOUD_BACKUP_DEFAULT_ON'), false),
  };
}

export function isCoexistMigrationMode(): boolean {
  return getCloudProviderConfig().migrationMode === 'coexist';
}

export function isHippiusBackupEnabled(): boolean {
  return getCloudProviderConfig().hippiusEnabled;
}

export function isCloudBackupDefaultOn(): boolean {
  return getCloudProviderConfig().cloudBackupDefaultOn;
}
