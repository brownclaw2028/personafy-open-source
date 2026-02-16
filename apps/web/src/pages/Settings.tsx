import { useState, useRef } from 'react';
import { Layout } from '../components/Layout';
import {
  Lock,
  Bell,
  Download,
  Upload,
  AlertTriangle,
  Database,
  Eye,
  Clock,
  Cloud,
  Mail,
  LogIn,
  LogOut,
  RefreshCw,
  Moon,
  Keyboard,
} from 'lucide-react';
import { SkeletonPage } from '../components/LoadingSkeleton';
import { useVault, type VaultData, type VaultSettings } from '../lib/VaultProvider';
import { VaultErrorState } from '../components/VaultErrorState';
import { toast } from '../components/Toast';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { validateVaultImport } from '../lib/utils';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { PostureSection } from '../components/settings/PostureSection';
import { Toggle, Section, SettingRow, DangerRow } from '../components/settings/SettingsWidgets';
import { CloudBackupPanel } from '../components/settings/CloudBackupPanel';
import { hasSupabaseConfig, signInWithOtp, signOut } from '../lib/supabase';
import { useSupabaseSession } from '../lib/useSupabaseSession';
import { useDarkMode } from '../lib/useDarkMode';
import { useKeyboardShortcuts } from '../components/KeyboardShortcuts';

interface SettingsProps {
  userName?: string;
  userInitials?: string;
  onNavClick?: (itemId: string) => void;
}

const defaultSettings: VaultSettings = {
  contextTtlMinutes: 10,
  hideHighSensitivity: true,
  approvalNotifications: true,
  cloudSyncEnabled: false,
};

export function Settings({
  userName = 'User',
  userInitials = 'U',
  onNavClick,
}: SettingsProps) {
  useDocumentTitle('Settings');
  const {
    vault,
    loading,
    error,
    locked,
    refresh,
    unlock,
    save,
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
  } = useVault();
  const [showDanger, setShowDanger] = useState(false);
  const [dialog, setDialog] = useState<{
    type: 'export' | 'import' | 'clearAudit' | 'clearRules' | 'destroy' | 'restoreCloud' | null;
  }>({ type: null });
  const [importPreview, setImportPreview] = useState<VaultData | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { session, user, loading: authLoading } = useSupabaseSession();
  useDarkMode();
  const [authEmail, setAuthEmail] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [cloudBusy, setCloudBusy] = useState(false);
  const { open: openKeyboardShortcuts } = useKeyboardShortcuts();

  const closeDialog = () => setDialog({ type: null });

  const currentPosture = vault?.privacyPosture || 'alarm_system';
  const settings: VaultSettings = vault?.settings ?? defaultSettings;
  const cloudEnabled = Boolean(settings.cloudSyncEnabled);
  const hasCloudConfig = hasSupabaseConfig();
  const cloudStatusLabel =
    cloudSync.status === 'syncing'
      ? 'Syncing…'
      : cloudSync.status === 'error'
        ? 'Error'
        : cloudSync.status === 'idle'
          ? 'Ready'
          : 'Disabled';
  const lastSyncLabel = cloudSync.lastSyncAt
    ? new Date(cloudSync.lastSyncAt).toLocaleString()
    : 'Not yet';
  const cloudActionsDisabled =
    cloudBusy || cloudSync.status === 'syncing' || locked || !session || !cloudEnabled || !hasCloudConfig;

  const updateVault = async (patch: Partial<VaultData>, options?: { silent?: boolean }) => {
    if (!vault) return false;
    const ok = await save({ ...vault, ...patch });
    if (!options?.silent) {
      if (ok) toast('Settings saved');
      else toast('Failed to save settings', 'error');
    }
    return ok;
  };

  const updateSettings = async (patch: Partial<VaultSettings>, options?: { silent?: boolean }) => {
    return await updateVault({ settings: { ...settings, ...patch } }, options);
  };

  const changePosture = (postureId: string) => updateVault({ privacyPosture: postureId });

  const handleSignIn = async () => {
    if (!hasSupabaseConfig()) {
      toast('Supabase not configured yet.', 'error');
      return;
    }
    if (!authEmail || !authEmail.includes('@')) {
      toast('Enter a valid email address.', 'error');
      return;
    }
    setAuthBusy(true);
    const { error: signInError } = await signInWithOtp(authEmail, `${window.location.origin}/settings`);
    setAuthBusy(false);
    if (signInError) {
      toast(signInError.message, 'error');
      return;
    }
    toast('Magic link sent. Check your email to finish sign-in.');
  };

  const handleSignOut = async () => {
    setAuthBusy(true);
    signOut();
    setAuthBusy(false);
    toast('Signed out of cloud sync.');
  };

  const handleToggleCloud = async () => {
    if (!vault) return;
    if (!hasSupabaseConfig()) {
      toast('Supabase not configured yet.', 'error');
      return;
    }
    if (!session) {
      toast('Sign in to enable cloud sync.', 'error');
      return;
    }
    if (locked) {
      toast('Unlock your vault to enable cloud sync.', 'error');
      return;
    }
    const next = !cloudEnabled;
    const ok = await updateSettings({ cloudSyncEnabled: next }, { silent: true });
    if (!ok) {
      toast('Failed to update cloud sync setting.', 'error');
      return;
    }
    if (next) {
      setCloudBusy(true);
      const initOk = await cloudInit();
      setCloudBusy(false);
      if (initOk) toast('Cloud sync enabled.');
      else toast('Cloud sync enabled, but initialization failed. Check status below.', 'error');
    } else {
      clearCloudError();
      toast('Cloud sync disabled.');
    }
  };

  const handleCloudPush = async () => {
    setCloudBusy(true);
    const ok = await cloudPush();
    setCloudBusy(false);
    if (ok) toast('Vault synced to cloud.');
    else toast('Cloud sync failed. Check status below.', 'error');
  };

  const handleCloudPull = async () => {
    setCloudBusy(true);
    const ok = await cloudPull();
    setCloudBusy(false);
    if (ok) toast('Cloud vault pulled successfully.');
    else toast('Failed to pull from cloud. Check status below.', 'error');
  };

  const handleCloudBackupUpload = async () => {
    const ok = await cloudBackupUpload();
    if (ok) toast('Encrypted cloud backup completed.');
    else toast('Cloud backup failed. Review diagnostics below.', 'error');
  };

  const handleCloudBackupRetry = async () => {
    const ok = await cloudBackupRetry();
    if (ok) toast('Cloud backup retry completed.');
    else toast('Cloud backup retry failed.', 'error');
  };

  const handleCloudBackupRestore = async () => {
    closeDialog();
    const ok = await cloudBackupRestore();
    if (ok) toast('Cloud restore completed and applied locally.');
    else toast('Cloud restore failed. Review diagnostics below.', 'error');
  };

  const exportVault = () => {
    if (!vault) return;
    const blob = new Blob([JSON.stringify(vault, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `personafy-vault-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    closeDialog();
    toast('Vault exported');
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    if (!file.name.endsWith('.json')) {
      toast('Please select a JSON file', 'error');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast('File too large (max 10MB)', 'error');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result as string);
        const result = validateVaultImport(parsed);
        if (!result.ok) {
          toast(`Import failed: ${result.error}`, 'error');
          return;
        }
        setImportPreview(result.data);
        setDialog({ type: 'import' });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Invalid file';
        toast(`Import failed: ${msg}`, 'error');
      }
    };
    reader.onerror = () => toast('Failed to read file', 'error');
    reader.readAsText(file);
  };

  const importVault = async () => {
    if (!importPreview) return;
    // Ensure imported vault has settings (older exports may omit them).
    const vaultToSave = importPreview.settings
      ? importPreview
      : {
          ...importPreview,
          settings: {
            contextTtlMinutes: 10,
            hideHighSensitivity: true,
            approvalNotifications: true,
            cloudSyncEnabled: false,
          },
        };
    const ok = await save(vaultToSave);
    closeDialog();
    setImportPreview(null);
    if (ok) toast('Vault imported successfully');
    else toast('Failed to import vault', 'error');
  };

  const clearAuditLog = async () => {
    if (!vault) return;
    const ok = await save({ ...vault, auditLog: [] });
    closeDialog();
    if (ok) toast('Audit log cleared');
    else toast('Failed to clear audit log', 'error');
  };

  const clearAllRules = async () => {
    if (!vault) return;
    const ok = await save({ ...vault, rules: [] });
    closeDialog();
    if (ok) toast('All rules deleted');
    else toast('Failed to delete rules', 'error');
  };

  const destroyVault = async () => {
    if (!vault) return;
    const blankVault = {
      version: vault.version,
      createdAt: vault.createdAt,
      privacyPosture: 'alarm_system',
      settings: { contextTtlMinutes: 10, hideHighSensitivity: true, approvalNotifications: true, cloudSyncEnabled: false },
      personas: [],
      rules: [],
      auditLog: [],
    };
    const ok = await save(blankVault);
    closeDialog();
    if (ok) {
      localStorage.removeItem('personafy_setup_complete');
      toast('Vault destroyed — redirecting to setup');
      setTimeout(() => { window.location.href = '/setup/welcome'; }, 800);
    } else {
      toast('Failed to destroy vault', 'error');
    }
  };

  if (loading || (!vault && !error && !locked)) {
    return (
      <Layout activeNav="settings" userName={userName} userInitials={userInitials} onNavClick={onNavClick}>
        <SkeletonPage cards={4} />
      </Layout>
    );
  }

  if (locked || (error && !vault)) {
    return (
      <Layout activeNav="settings" userName={userName} userInitials={userInitials} onNavClick={onNavClick}>
        <VaultErrorState error={error ?? 'Vault locked'} locked={locked} onUnlock={unlock} onRetry={refresh} />
      </Layout>
    );
  }

  return (
    <Layout activeNav="settings" userName={userName} userInitials={userInitials} onNavClick={onNavClick}>
      <div className="p-8 max-w-4xl animate-fade-in">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">Settings</h1>
            <p className="text-text-secondary">Configure your vault's privacy posture, notifications, and data management.</p>
          </div>
        </div>

        <PostureSection currentPosture={currentPosture} onChangePosture={changePosture} />

        {/* Appearance — dark mode is always on; light mode not yet supported */}
        <Section title="Appearance" icon={<Moon className="w-5 h-5 text-primary" />}>
          <div className="space-y-4">
            <SettingRow
              icon={<Moon className="w-4 h-4" />}
              title="Dark mode"
              description="Dark mode is always enabled. Light mode is not yet supported."
              action={
                <Toggle
                  enabled={true}
                  onToggle={() => {}}
                />
              }
            />
          </div>
        </Section>

        {/* Data & TTL */}
        <Section title="Data Management" icon={<Database className="w-5 h-5 text-primary" />}>
          <div className="space-y-4">
            <SettingRow
              icon={<Clock className="w-4 h-4" />}
              title="Memory Retention"
              description="How long shared context stays active before agents must re-request it."
              action={
                <select
                  id="memory-retention"
                  aria-label="Memory Retention"
                  value={settings.contextTtlMinutes}
                  onChange={(e) => updateSettings({ contextTtlMinutes: parseInt(e.target.value, 10) })}
                  className="px-3 py-1.5 bg-card border border-card-border/50 rounded-lg text-white text-sm focus:outline-none focus:border-accent/50"
                >
                  <option value="10">10 minutes</option>
                  <option value="30">30 minutes</option>
                  <option value="60">1 hour</option>
                  <option value="0">Never expire</option>
                </select>
              }
            />
            <SettingRow
              icon={<Eye className="w-4 h-4" />}
              title="Hide high-sensitivity values"
              description="High-sensitivity facts are masked by default in the UI."
              action={
                <Toggle
                  enabled={settings.hideHighSensitivity}
                  onToggle={() => updateSettings({ hideHighSensitivity: !settings.hideHighSensitivity })}
                />
              }
            />
            <SettingRow
              icon={<Bell className="w-4 h-4" />}
              title="Approval notifications"
              description="Get notified via WhatsApp/Telegram when a context request needs approval."
              action={
                <Toggle
                  enabled={settings.approvalNotifications}
                  onToggle={() => updateSettings({ approvalNotifications: !settings.approvalNotifications })}
                />
              }
            />
          </div>
        </Section>

        {/* Cloud Sync */}
        <Section title="Cloud Sync" icon={<Cloud className="w-5 h-5 text-primary" />}>
          <p className="text-text-secondary text-sm mb-4">
            Optional end-to-end encrypted sync. Your passphrase never leaves this device.
          </p>
          <div className="space-y-4">
            <SettingRow
              icon={<RefreshCw className="w-4 h-4" />}
              title="Enable cloud sync"
              description="Keep a private, encrypted copy of your vault in Supabase."
              action={<Toggle enabled={cloudEnabled} onToggle={() => void handleToggleCloud()} />}
            />

            <div className="rounded-lg border border-card-border/50 bg-card/40 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-white text-sm font-medium">Supabase account</div>
                <div className="text-text-tertiary text-xs">
                  {authLoading ? 'Checking session…' : user ? 'Signed in' : 'Not signed in'}
                </div>
              </div>

              {!hasCloudConfig && (
                <div className="text-text-tertiary text-xs">
                  Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> to <code>.env.local</code>.
                </div>
              )}

              {hasCloudConfig && user && (
                <div className="flex items-center justify-between gap-3">
                  <div className="text-text-secondary text-sm">{user.email}</div>
                  <button
                    onClick={() => void handleSignOut()}
                    disabled={authBusy}
                    className="px-3 py-2 bg-card border border-card-border/50 rounded-lg text-text-secondary hover:text-white hover:border-accent/40 text-xs font-medium transition-colors disabled:opacity-50"
                  >
                    <LogOut className="w-3 h-3 inline mr-1" />
                    Sign out
                  </button>
                </div>
              )}

              {hasCloudConfig && !user && (
                <div className="flex items-center gap-2">
                  <div className="flex-1 relative">
                    <Mail className="w-4 h-4 text-text-tertiary absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="email"
                      value={authEmail}
                      onChange={(e) => setAuthEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="w-full pl-9 pr-3 py-2 bg-card border border-card-border/50 rounded-lg text-white text-sm placeholder-text-tertiary focus:outline-none focus:border-accent/50"
                    />
                  </div>
                  <button
                    onClick={() => void handleSignIn()}
                    disabled={authBusy || !authEmail}
                    className="px-3 py-2 bg-primary/10 border border-primary/30 rounded-lg text-primary text-xs font-medium hover:bg-primary/20 transition-colors disabled:opacity-50"
                  >
                    <LogIn className="w-3 h-3 inline mr-1" />
                    Send link
                  </button>
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => void handleCloudPush()}
                disabled={cloudActionsDisabled}
                className="flex items-center gap-2 px-4 py-2.5 bg-card border border-card-border/50 rounded-lg text-text-secondary hover:text-white hover:border-accent/40 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <RefreshCw className="w-4 h-4" />
                Sync now
              </button>
              <button
                onClick={() => void handleCloudPull()}
                disabled={cloudActionsDisabled}
                className="flex items-center gap-2 px-4 py-2.5 bg-card border border-card-border/50 rounded-lg text-text-secondary hover:text-white hover:border-accent/40 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Download className="w-4 h-4" />
                Pull latest
              </button>
            </div>

            <div className="flex items-center justify-between text-xs text-text-tertiary">
              <div>Status: {cloudStatusLabel}</div>
              <div>Last sync: {lastSyncLabel}</div>
            </div>

            {cloudSync.lastError && (
              <div className="border border-red-400/30 bg-red-400/10 rounded-lg p-3 text-xs text-red-200">
                <div className="flex items-start justify-between gap-3">
                  <span>{cloudSync.lastError}</span>
                  <button
                    onClick={() => void clearCloudError()}
                    className="text-red-200 hover:text-white transition-colors"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )}

          </div>
        </Section>

        <CloudBackupPanel
          cloudBackup={cloudBackup}
          onToggleEnabled={setCloudBackupEnabled}
          onBackupNow={() => void handleCloudBackupUpload()}
          onRetry={() => void handleCloudBackupRetry()}
          onCancel={cloudBackupCancel}
          onRestore={() => setDialog({ type: 'restoreCloud' })}
          onDismissError={clearCloudBackupError}
        />

        {/* Export & Import */}
        <Section title="Backup & Export" icon={<Download className="w-5 h-5 text-primary" />}>
          <p className="text-text-secondary text-sm mb-4">
            Export your vault data for backup or import a previously exported vault.
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => setDialog({ type: 'export' })}
              className="flex items-center gap-2 px-4 py-2.5 bg-card border border-card-border/50 rounded-lg text-text-secondary hover:text-white hover:border-accent/40 text-sm font-medium transition-colors"
            >
              <Download className="w-4 h-4" />
              Export Vault
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 px-4 py-2.5 bg-card border border-card-border/50 rounded-lg text-text-secondary hover:text-white hover:border-accent/40 text-sm font-medium transition-colors"
            >
              <Upload className="w-4 h-4" />
              Import Backup
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              onChange={handleFileSelect}
              className="hidden"
              aria-label="Import vault backup file"
            />
          </div>
        </Section>

        {/* Keyboard Shortcuts */}
        <Section title="Keyboard Shortcuts" icon={<Keyboard className="w-5 h-5 text-primary" />}>
          <p className="text-text-secondary text-sm mb-4">
            Navigate faster with keyboard shortcuts. Works throughout the app.
          </p>
          <button
            onClick={openKeyboardShortcuts}
            className="flex items-center gap-2 px-4 py-2.5 bg-card border border-card-border/50 rounded-lg text-text-secondary hover:text-white hover:border-accent/40 text-sm font-medium transition-colors"
          >
            <Keyboard className="w-4 h-4" />
            View All Shortcuts
            <kbd className="ml-2 px-1.5 py-0.5 bg-white/[0.12] border border-card-border/50 rounded text-[10px] font-mono text-text-tertiary">?</kbd>
          </button>
        </Section>

        {/* Danger Zone */}
        <div className="mt-8">
          <button
            onClick={() => setShowDanger(!showDanger)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-red-400/20 text-red-400/60 hover:text-red-400 hover:border-red-400/40 hover:bg-red-400/5 text-sm transition-all mb-4"
          >
            <AlertTriangle className="w-4 h-4" />
            {showDanger ? 'Hide' : 'Show'} Danger Zone
            <svg className={`w-4 h-4 ml-auto transition-transform ${showDanger ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
          </button>
          {showDanger && (
            <div className="glass-card p-6 border-red-400/20">
              <h3 className="text-red-400 font-semibold mb-4">Danger Zone</h3>
              <div className="space-y-3">
                <DangerRow
                  title="Clear Audit Log"
                  description="Remove all audit events. This cannot be undone."
                  onAction={() => setDialog({ type: 'clearAudit' })}
                />
                <DangerRow
                  title="Delete All Rules"
                  description="Remove all auto-allow rules."
                  onAction={() => setDialog({ type: 'clearRules' })}
                />
                <div className="flex items-center justify-between py-3">
                  <div>
                    <div className="text-white text-sm font-medium">Destroy Vault</div>
                    <div className="text-text-tertiary text-xs">Permanently delete all personas, facts, rules, and history.</div>
                  </div>
                  <button
                    onClick={() => setDialog({ type: 'destroy' })}
                    className="px-3 py-1.5 bg-red-400/10 border border-red-400/30 rounded-lg text-red-400 text-xs font-medium hover:bg-red-400/20 transition-colors"
                  >
                    <Lock className="w-3 h-3 inline mr-1" />
                    Destroy
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Confirm Dialogs */}
        <ConfirmDialog
          open={dialog.type === 'export'}
          title="Export Vault"
          message="This will download your entire vault (including sensitive facts) as a JSON file. Make sure you're in a secure location."
          confirmLabel="Export"
          onConfirm={exportVault}
          onCancel={closeDialog}
        />
        <ConfirmDialog
          open={dialog.type === 'import'}
          title="Import Vault Backup"
          message={importPreview
            ? `This will replace your entire vault with the imported data:\n\n• ${importPreview.personas.length} persona${importPreview.personas.length !== 1 ? 's' : ''}\n• ${importPreview.personas.reduce((s, p) => s + p.facts.length, 0)} facts\n• ${importPreview.rules.length} rule${importPreview.rules.length !== 1 ? 's' : ''}\n• ${importPreview.auditLog.length} audit event${importPreview.auditLog.length !== 1 ? 's' : ''}\n• Posture: ${importPreview.privacyPosture?.replace(/_/g, ' ')}\n\nYour current vault data will be overwritten. This cannot be undone.`
            : 'Loading preview...'}
          confirmLabel="Import"
          variant="danger"
          onConfirm={importVault}
          onCancel={() => { closeDialog(); setImportPreview(null); }}
        />
        <ConfirmDialog
          open={dialog.type === 'restoreCloud'}
          title="Restore Latest Cloud Snapshot"
          message="This will replace your current local vault with the latest decrypted cloud snapshot. Continue only if you want to overwrite local changes."
          confirmText="RESTORE"
          confirmLabel="Restore Snapshot"
          variant="danger"
          onConfirm={() => void handleCloudBackupRestore()}
          onCancel={closeDialog}
        />
        <ConfirmDialog
          open={dialog.type === 'clearAudit'}
          title="Clear Audit Log"
          message="This will permanently remove all audit events. You'll lose the record of every context request and approval. This cannot be undone."
          confirmLabel="Clear Log"
          variant="danger"
          onConfirm={clearAuditLog}
          onCancel={closeDialog}
        />
        <ConfirmDialog
          open={dialog.type === 'clearRules'}
          title="Delete All Rules"
          message="This will remove all auto-allow rules. Agents will need to request approval for every context access again."
          confirmLabel="Delete All"
          variant="danger"
          onConfirm={clearAllRules}
          onCancel={closeDialog}
        />
        <ConfirmDialog
          open={dialog.type === 'destroy'}
          title="Destroy Vault"
          message="This will permanently delete ALL vault data — every persona, fact, rule, and audit event. This action is irreversible."
          confirmText="DESTROY"
          confirmLabel="Destroy Vault"
          variant="danger"
          onConfirm={destroyVault}
          onCancel={closeDialog}
        />
      </div>
    </Layout>
  );
}
