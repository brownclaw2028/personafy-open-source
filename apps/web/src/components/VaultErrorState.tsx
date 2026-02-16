import { AlertTriangle, RefreshCw, Lock, Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';

interface VaultErrorStateProps {
  error: string;
  locked?: boolean;
  onUnlock?: (passphrase: string) => Promise<void> | void;
  unlocking?: boolean;
  onRetry?: () => void;
  retrying?: boolean;
}

/**
 * Full-page error state when vault data fails to load.
 * Shows the error message and a retry button.
 */
export function VaultErrorState({
  error,
  locked,
  onUnlock,
  unlocking,
  onRetry,
  retrying,
}: VaultErrorStateProps) {
  const [passphrase, setPassphrase] = useState('');
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const isUnlocking = unlocking || submitting;

  const handleUnlock = async () => {
    if (!onUnlock || !passphrase.trim()) return;
    setSubmitting(true);
    try {
      await onUnlock(passphrase);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] animate-fade-in">
      <div className="glass-card p-8 max-w-md text-center">
        {locked ? (
          <>
            <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <Lock className="w-7 h-7 text-primary" />
            </div>
            <h2 className="text-xl font-bold text-white mb-2">Vault locked</h2>
            <p className="text-text-secondary text-sm mb-6">
              Enter your passphrase to unlock your vault.
            </p>

            <div className="text-left space-y-3 mb-5">
              <label className="block text-xs font-medium text-text-secondary">Passphrase</label>
              <div className="relative">
                <input
                  type={showPassphrase ? 'text' : 'password'}
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  className="w-full px-3 py-2 pr-10 bg-card border border-card-border/50 rounded-lg text-white placeholder-text-tertiary focus:outline-none focus:border-accent/50 text-sm"
                  placeholder="Enter passphrase"
                />
                <button
                  type="button"
                  onClick={() => setShowPassphrase(!showPassphrase)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-white transition-colors"
                  aria-label={showPassphrase ? 'Hide passphrase' : 'Show passphrase'}
                >
                  {showPassphrase ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {error && (
                <p className="text-xs text-red-400">{error}</p>
              )}
            </div>

            <button
              onClick={handleUnlock}
              disabled={!passphrase.trim() || isUnlocking}
              className={`inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 w-full ${
                isUnlocking
                  ? 'bg-card text-text-tertiary cursor-not-allowed'
                  : 'bg-primary text-white hover:bg-primary/90 shadow-glow'
              }`}
            >
              <Lock className={`w-4 h-4 ${isUnlocking ? 'animate-pulse' : ''}`} />
              {isUnlocking ? 'Unlocking…' : 'Unlock Vault'}
            </button>
          </>
        ) : (
          <>
            <div className="w-14 h-14 rounded-2xl bg-red-400/10 flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-7 h-7 text-red-400" />
            </div>
            <h2 className="text-xl font-bold text-white mb-2">Unable to load vault</h2>
            <p className="text-text-secondary text-sm mb-6">{error}</p>
            {onRetry && (
              <button
                onClick={onRetry}
                disabled={retrying}
                className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
                  retrying
                    ? 'bg-card text-text-tertiary cursor-not-allowed'
                    : 'bg-primary text-white hover:bg-primary/90 shadow-glow'
                }`}
              >
                <RefreshCw className={`w-4 h-4 ${retrying ? 'animate-spin' : ''}`} />
                {retrying ? 'Retrying…' : 'Retry'}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
