import { parseApiError, supabaseRest } from '../../_utils';
import type {
  CloudSyncStorageProvider,
  InitCloudVaultInput,
  PullCloudVaultResult,
  PushCloudVaultInput,
  PushCloudVaultResult,
} from '../provider';

export const supabaseProvider: CloudSyncStorageProvider = {
  name: 'supabase',

  async pullLatestVault(input: { userId: string }): Promise<PullCloudVaultResult | null> {
    const params = new URLSearchParams({
      select: 'envelope,version,updated_at',
      owner_id: `eq.${input.userId}`,
      order: 'updated_at.desc',
      limit: '1',
    });

    const supaRes = await supabaseRest(`vaults?${params.toString()}`);
    if (!supaRes.ok) {
      throw new Error(await parseApiError(supaRes));
    }

    const data = (await supaRes.json()) as Array<{ envelope: unknown; version: number; updated_at?: string }> | null;
    if (!data || data.length === 0) {
      return null;
    }

    const row = data[0];
    return {
      envelope: row.envelope,
      version: row.version,
      updatedAt: row.updated_at,
    };
  },

  async initVault(input: InitCloudVaultInput): Promise<{ version: number; updatedAt?: string }> {
    // Atomic patch first; fallback to insert if user row does not exist.
    const updateParams = new URLSearchParams({ owner_id: `eq.${input.userId}` });
    const updateRes = await supabaseRest(`vaults?${updateParams.toString()}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({
        name: input.vaultName,
        envelope: input.envelope,
        version: input.version,
        updated_at: input.nowIso,
      }),
    });

    if (!updateRes.ok) {
      throw new Error(await parseApiError(updateRes));
    }

    const updatedRows = (await updateRes.json()) as unknown[];
    if (updatedRows && updatedRows.length > 0) {
      return { version: input.version, updatedAt: input.nowIso };
    }

    const insertRes = await supabaseRest('vaults', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        owner_id: input.userId,
        name: input.vaultName,
        envelope: input.envelope,
        version: input.version,
        updated_at: input.nowIso,
      }),
    });

    if (!insertRes.ok) {
      throw new Error(await parseApiError(insertRes));
    }

    return { version: input.version, updatedAt: input.nowIso };
  },

  async pushVault(input: PushCloudVaultInput): Promise<PushCloudVaultResult> {
    if (input.ifMatchVersion === 0) {
      const checkParams = new URLSearchParams({
        select: 'id',
        owner_id: `eq.${input.userId}`,
        limit: '1',
      });
      const checkRes = await supabaseRest(`vaults?${checkParams.toString()}`);
      if (!checkRes.ok) {
        throw new Error(await parseApiError(checkRes));
      }

      const existing = (await checkRes.json()) as Array<{ id: string }>;
      if (existing && existing.length > 0) {
        return {
          ok: false,
          status: 409,
          error: 'Cloud vault already exists',
          currentVersion: null,
        };
      }

      const insertRes = await supabaseRest('vaults', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner_id: input.userId,
          name: 'My Personal Vault',
          envelope: input.envelope,
          version: input.version,
          updated_at: input.nowIso,
        }),
      });

      if (!insertRes.ok) {
        throw new Error(await parseApiError(insertRes));
      }

      return {
        ok: true,
        version: input.version,
        updatedAt: input.nowIso,
      };
    }

    const updateParams = new URLSearchParams({
      owner_id: `eq.${input.userId}`,
      version: `eq.${input.ifMatchVersion}`,
    });
    const updateRes = await supabaseRest(`vaults?${updateParams.toString()}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({
        envelope: input.envelope,
        version: input.version,
        updated_at: input.nowIso,
      }),
    });

    if (!updateRes.ok) {
      throw new Error(await parseApiError(updateRes));
    }

    const updatedRows = (await updateRes.json()) as unknown[];
    if (!updatedRows || updatedRows.length === 0) {
      let currentVersion: number | null = null;
      let updatedAt: string | undefined;
      try {
        const latestParams = new URLSearchParams({
          select: 'version,updated_at',
          owner_id: `eq.${input.userId}`,
          order: 'updated_at.desc',
          limit: '1',
        });
        const latestRes = await supabaseRest(`vaults?${latestParams.toString()}`);
        if (latestRes.ok) {
          const latestRows = (await latestRes.json()) as Array<{ version?: number; updated_at?: string }> | null;
          const latest = latestRows?.[0];
          if (latest && typeof latest.version === 'number') {
            currentVersion = latest.version;
            updatedAt = typeof latest.updated_at === 'string' ? latest.updated_at : undefined;
          }
        }
      } catch {
        // best-effort conflict metadata lookup only
      }

      return {
        ok: false,
        status: 409,
        error: 'Version conflict',
        currentVersion,
        updatedAt,
      };
    }

    return {
      ok: true,
      version: input.version,
      updatedAt: input.nowIso,
    };
  },
};
