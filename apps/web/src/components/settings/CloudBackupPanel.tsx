import { Cloud, RefreshCw, RotateCcw, UploadCloud, XCircle } from 'lucide-react';
import { Section, SettingRow, Toggle } from './SettingsWidgets';

type CloudBackupState = {
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

interface CloudBackupPanelProps {
  cloudBackup: CloudBackupState;
  onToggleEnabled: (enabled: boolean) => void;
  onBackupNow: () => void;
  onRetry: () => void;
  onCancel: () => void;
  onRestore: () => void;
  onDismissError: () => void;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value.toFixed(value >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`;
}

function formatTimestamp(value: string | null): string {
  if (!value) return 'Not yet';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Not yet';
  return parsed.toLocaleString();
}

export function CloudBackupPanel({
  cloudBackup,
  onToggleEnabled,
  onBackupNow,
  onRetry,
  onCancel,
  onRestore,
  onDismissError,
}: CloudBackupPanelProps) {
  const isRunning = (
    cloudBackup.status === 'preparing'
    || cloudBackup.status === 'uploading'
    || cloudBackup.status === 'finalizing'
    || cloudBackup.status === 'restoring'
  );
  const canBackup = cloudBackup.enabled && cloudBackup.available && !isRunning;
  const canRestore = cloudBackup.enabled && !isRunning;
  const canRetry = cloudBackup.status === 'error' && cloudBackup.retryable && !isRunning;
  const showProgress = cloudBackup.totalBytes > 0 || isRunning;

  return (
    <Section title="Cloud Backup (Optional)" icon={<Cloud className="w-5 h-5 text-primary" />}>
      <p className="text-text-secondary text-sm mb-4">
        Internal beta, off by default. Backups stay encrypted end-to-end and can be restored only after local decrypt verification.
      </p>

      <div className="space-y-4">
        <SettingRow
          icon={<UploadCloud className="w-4 h-4" />}
          title="Enable cloud backup"
          description="Opt in to multipart encrypted snapshot uploads and restore from latest backup snapshots."
          action={<Toggle enabled={cloudBackup.enabled} onToggle={() => onToggleEnabled(!cloudBackup.enabled)} />}
        />

        <div className="rounded-lg border border-card-border/50 bg-card/40 p-4 space-y-2 text-xs text-text-tertiary">
          <div className="flex items-center justify-between">
            <span>Provider</span>
            <span className="text-white font-medium">{cloudBackup.provider}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Status</span>
            <span className="text-white font-medium capitalize">{cloudBackup.status.replace('_', ' ')}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Last backup</span>
            <span>{formatTimestamp(cloudBackup.lastBackupAt)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Last restore</span>
            <span>{formatTimestamp(cloudBackup.lastRestoreAt)}</span>
          </div>
          {cloudBackup.lastSnapshotId && (
            <div className="flex items-center justify-between">
              <span>Snapshot</span>
              <span className="font-mono text-[11px] text-text-secondary">{cloudBackup.lastSnapshotId}</span>
            </div>
          )}
        </div>

        {!cloudBackup.available && cloudBackup.enabled && (
          <div className="border border-yellow-400/30 bg-yellow-400/10 rounded-lg p-3 text-xs text-yellow-200">
            Hippius backup is not enabled for this build. Configure
            {' '}
            <code>VITE_CLOUD_BACKUP_PROVIDER=hippius</code>
            {' '}
            and
            {' '}
            <code>VITE_ENABLE_HIPPIUS_BACKUP=true</code>
            .
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          <button
            onClick={onBackupNow}
            disabled={!canBackup}
            className="flex items-center gap-2 px-4 py-2.5 bg-card border border-card-border/50 rounded-lg text-text-secondary hover:text-white hover:border-accent/40 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <UploadCloud className="w-4 h-4" />
            Backup now
          </button>
          <button
            onClick={onRestore}
            disabled={!canRestore}
            className="flex items-center gap-2 px-4 py-2.5 bg-card border border-card-border/50 rounded-lg text-text-secondary hover:text-white hover:border-accent/40 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RotateCcw className="w-4 h-4" />
            Restore latest
          </button>
          <button
            onClick={onCancel}
            disabled={!isRunning}
            className="flex items-center gap-2 px-4 py-2.5 bg-card border border-card-border/50 rounded-lg text-text-secondary hover:text-white hover:border-accent/40 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <XCircle className="w-4 h-4" />
            Cancel
          </button>
          <button
            onClick={onRetry}
            disabled={!canRetry}
            className="flex items-center gap-2 px-4 py-2.5 bg-card border border-card-border/50 rounded-lg text-text-secondary hover:text-white hover:border-accent/40 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw className="w-4 h-4" />
            Retry
          </button>
        </div>

        {showProgress && (
          <div className="space-y-2">
            <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-2 bg-primary transition-all"
                style={{ width: `${Math.max(0, Math.min(100, cloudBackup.progressPercent))}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-xs text-text-tertiary">
              <span>
                {formatBytes(cloudBackup.uploadedBytes)}
                {' '}
                / {' '}
                {formatBytes(cloudBackup.totalBytes)}
              </span>
              <span>
                Parts
                {' '}
                {cloudBackup.completedParts}
                /
                {cloudBackup.totalParts}
                {' '}
                • Retries
                {' '}
                {cloudBackup.partRetries}
              </span>
            </div>
          </div>
        )}

        {cloudBackup.lastError && (
          <div className="border border-red-400/30 bg-red-400/10 rounded-lg p-3 text-xs text-red-200">
            <div className="flex items-start justify-between gap-3">
              <span>{cloudBackup.lastError}</span>
              <button onClick={onDismissError} className="text-red-200 hover:text-white transition-colors">
                Dismiss
              </button>
            </div>
          </div>
        )}

        {cloudBackup.diagnostics.length > 0 && (
          <div className="rounded-lg border border-card-border/40 bg-card/30 p-3">
            <div className="text-[11px] uppercase tracking-wide text-text-tertiary mb-2">Diagnostics</div>
            <ul className="space-y-1 text-xs text-text-secondary list-disc pl-4">
              {cloudBackup.diagnostics.slice(0, 4).map((row) => (
                <li key={row}>{row}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Section>
  );
}
