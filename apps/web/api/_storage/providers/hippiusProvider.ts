import type {
  CloudSyncStorageProvider,
  InitCloudVaultInput,
  PullCloudVaultResult,
  PushCloudVaultInput,
  PushCloudVaultResult,
} from '../provider';

function notImplemented(operation: string): never {
  throw new Error(`Hippius provider scaffold: ${operation} is not implemented yet (Phase 2).`);
}

export const hippiusProvider: CloudSyncStorageProvider = {
  name: 'hippius',

  async pullLatestVault(input: { userId: string }): Promise<PullCloudVaultResult | null> {
    void input;
    return notImplemented('pullLatestVault');
  },

  async initVault(input: InitCloudVaultInput): Promise<{ version: number; updatedAt?: string }> {
    void input;
    return notImplemented('initVault');
  },

  async pushVault(input: PushCloudVaultInput): Promise<PushCloudVaultResult> {
    void input;
    return notImplemented('pushVault');
  },
};
