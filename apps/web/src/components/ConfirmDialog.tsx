import { useState, useEffect, useRef, useId } from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  /** If set, user must type this string to confirm (destructive actions) */
  confirmText?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'danger';
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmText,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const messageId = useId();

  // Reset typed text, lock scroll, set initial focus when dialog opens
  useEffect(() => {
    if (!open) return;
    setTyped(''); // eslint-disable-line react-hooks/set-state-in-effect -- dialog reset on open
    // Lock background scroll
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Focus input if confirm text required, otherwise focus cancel
    requestAnimationFrame(() => {
      if (confirmText) inputRef.current?.focus();
      else cancelRef.current?.focus();
    });
    return () => { document.body.style.overflow = prevOverflow; };
  }, [open, confirmText]);

  const dialogRef = useRef<HTMLDivElement>(null);

  // Escape to close + focus trap
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onCancel(); return; }
      if (e.key !== 'Tab') return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onCancel]);

  if (!open) return null;

  const isDanger = variant === 'danger';
  const canConfirm = confirmText ? typed === confirmText : true;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
        onClick={onCancel}
        aria-hidden="true"
      />
      {/* Dialog */}
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md z-50 animate-scale-in"
      >
        <div className="glass-card p-6 shadow-2xl">
          {/* Close */}
          <button
            type="button"
            onClick={onCancel}
            className="absolute top-4 right-4 text-text-tertiary hover:text-white transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>

          {/* Icon + Title */}
          <div className="flex items-start gap-3 mb-4">
            {isDanger && (
              <div className="w-10 h-10 bg-red-400/10 rounded-xl flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-5 h-5 text-red-400" />
              </div>
            )}
            <div>
              <h3 id={titleId} className="text-white font-semibold text-lg">
                {title}
              </h3>
              <p id={messageId} className="text-text-secondary text-sm mt-1 whitespace-pre-line">
                {message}
              </p>
            </div>
          </div>

          {/* Confirm text input */}
          {confirmText && (
            <div className="mb-4">
              <label className="text-text-tertiary text-xs mb-1.5 block">
                Type <code className="text-red-400 font-mono">{confirmText}</code> to confirm
              </label>
              <input
                ref={inputRef}
                type="text"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && canConfirm) onConfirm(); }}
                placeholder={confirmText}
                className="w-full px-3 py-2 bg-card border border-card-border/50 rounded-lg text-white placeholder-text-tertiary text-sm font-mono focus:outline-none focus:border-red-400/50"
              />
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3">
            <button
              type="button"
              ref={cancelRef}
              onClick={onCancel}
              className="flex-1 px-4 py-2.5 border border-card-border/50 rounded-lg text-text-secondary hover:text-white hover:border-accent/40 text-sm font-medium transition-colors"
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={!canConfirm}
              className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                isDanger
                  ? 'bg-red-400/10 border border-red-400/30 text-red-400 hover:bg-red-400/20'
                  : 'bg-primary text-white hover:bg-primary/90 shadow-glow'
              }`}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
