/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_POSTHOG_KEY?: string;
  readonly VITE_CLOUD_MIGRATION_MODE?: 'supabase-only' | 'coexist' | 'hippius-only';
  readonly VITE_CLOUD_BACKUP_PROVIDER?: 'supabase' | 'hippius';
  readonly VITE_ENABLE_HIPPIUS_BACKUP?: string;
  readonly VITE_CLOUD_BACKUP_DEFAULT_ON?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
