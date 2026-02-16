import { AlertTriangle, CheckCircle2, Download, Loader2, RotateCcw, Square } from 'lucide-react';
import type { ModelHydrationState } from '../../lib/model-hydration-state';

interface ModelHydrationStatusProps {
  modelId: string;
  state: ModelHydrationState;
  webGpuEnabled: boolean;
  sabFastPathReady: boolean;
  sabIssueSummary: string;
  onRetry: () => void;
  onCancel: () => void;
  onEnableWebGpu: () => void;
}

function statusLabel(status: ModelHydrationState['status']): string {
  switch (status) {
    case 'not_downloaded':
      return 'Not downloaded';
    case 'downloading':
      return 'Downloading model';
    case 'warming':
      return 'Warming model';
    case 'ready':
      return 'Ready';
    case 'failed':
      return 'Failed';
    default:
      return status;
  }
}

function statusTone(status: ModelHydrationState['status']): string {
  switch (status) {
    case 'ready':
      return 'text-accent';
    case 'failed':
      return 'text-red-300';
    case 'downloading':
    case 'warming':
      return 'text-primary';
    default:
      return 'text-text-secondary';
  }
}

export function ModelHydrationStatus({
  modelId,
  state,
  webGpuEnabled,
  sabFastPathReady,
  sabIssueSummary,
  onRetry,
  onCancel,
  onEnableWebGpu,
}: ModelHydrationStatusProps) {
  const progressPct = Math.round(Math.max(0, Math.min(1, state.progress)) * 100);
  const inProgress = state.status === 'downloading' || state.status === 'warming';

  return (
    <div className="glass-card p-4 mb-6 border-primary/30">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Download className="w-4 h-4 text-primary" />
            <h3 className="text-white font-semibold">AI Runtime Hydration</h3>
            <span className={`text-xs ${statusTone(state.status)}`}>{statusLabel(state.status)}</span>
          </div>
          <p className="text-text-secondary text-sm">
            Model: <span className="text-white">{modelId}</span>
          </p>
          {!sabFastPathReady && (
            <p className="text-[12px] text-yellow-300 mt-1">SAB fast path unavailable: {sabIssueSummary}</p>
          )}
          {!webGpuEnabled && (
            <p className="text-[12px] text-yellow-300 mt-1">WebGPU semantic mode is disabled. Enable it to warm the model.</p>
          )}
          {state.error && (
            <p className="text-[12px] text-red-300 mt-1">{state.error}</p>
          )}
        </div>

        <div className="flex items-center gap-2">
          {!webGpuEnabled && (
            <button
              onClick={onEnableWebGpu}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 text-xs"
            >
              Enable WebGPU
            </button>
          )}

          {inProgress && (
            <button
              onClick={onCancel}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/20 text-text-secondary hover:text-white hover:border-white/40 text-xs"
            >
              <Square className="w-3.5 h-3.5" />
              Cancel
            </button>
          )}

          {(state.status === 'failed' || state.status === 'not_downloaded') && (
            <button
              onClick={onRetry}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 text-xs"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Retry
            </button>
          )}
        </div>
      </div>

      <div className="mt-3">
        <div className="h-2 rounded-full bg-black/30 overflow-hidden">
          <div className="h-full bg-primary transition-all duration-300" style={{ width: `${progressPct}%` }} />
        </div>
        <div className="mt-2 flex items-center justify-between text-[11px] text-text-tertiary">
          <span>{progressPct}%</span>
          {state.status === 'ready' && (
            <span className="inline-flex items-center gap-1 text-accent">
              <CheckCircle2 className="w-3.5 h-3.5" /> Ready for extraction
            </span>
          )}
          {inProgress && (
            <span className="inline-flex items-center gap-1 text-primary">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Hydrating runtime
            </span>
          )}
          {state.status === 'failed' && (
            <span className="inline-flex items-center gap-1 text-red-300">
              <AlertTriangle className="w-3.5 h-3.5" /> Requires retry
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
