import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCloudProviderConfig } from '../cloudProvider';

const ENV_KEYS = [
  'VITE_CLOUD_MIGRATION_MODE',
  'VITE_CLOUD_BACKUP_PROVIDER',
  'VITE_ENABLE_HIPPIUS_BACKUP',
  'VITE_CLOUD_BACKUP_DEFAULT_ON',
] as const;

function clearCloudProviderEnv(): void {
  for (const key of ENV_KEYS) {
    vi.stubEnv(key, '');
  }
}

describe('cloudProvider defaults', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('keeps cloud backup disabled by default', () => {
    clearCloudProviderEnv();
    const config = getCloudProviderConfig();

    expect(config.cloudBackupDefaultOn).toBe(false);
    expect(config.backupProvider).toBe('supabase');
    expect(config.hippiusEnabled).toBe(false);
  });

  it('allows explicit opt-in default when flag is true', () => {
    clearCloudProviderEnv();
    vi.stubEnv('VITE_CLOUD_BACKUP_DEFAULT_ON', 'true');

    expect(getCloudProviderConfig().cloudBackupDefaultOn).toBe(true);
  });
});
