import { useState, useEffect, useCallback, useMemo, useRef, createContext, useContext } from 'react';
import { X, Keyboard } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface ShortcutGroup {
  title: string;
  shortcuts: { keys: string[]; description: string }[];
}

const shortcutGroups: ShortcutGroup[] = [
  {
    title: 'Navigation',
    shortcuts: [
      { keys: ['g', 'h'], description: 'Go to Home' },
      { keys: ['g', 'p'], description: 'Go to Personas' },
      { keys: ['g', 'r'], description: 'Go to Rules' },
      { keys: ['g', 'a'], description: 'Go to Audit Log' },
      { keys: ['g', 'd'], description: 'Go to Devices' },
      { keys: ['g', 's'], description: 'Go to Sources' },
      { keys: ['g', 'b'], description: 'Go to Data Browser' },
      { keys: ['g', ','], description: 'Go to Settings' },
    ],
  },
  {
    title: 'Actions',
    shortcuts: [
      { keys: ['n'], description: 'New item (context-sensitive)' },
      { keys: ['e'], description: 'Edit selected item' },
      { keys: ['Esc'], description: 'Close dialog / cancel' },
    ],
  },
  {
    title: 'Search & UI',
    shortcuts: [
      { keys: ['⌘', 'K'], description: 'Search vault (personas, facts, rules, devices)' },
      { keys: ['?'], description: 'Show keyboard shortcuts' },
      { keys: ['↑', '↓'], description: 'Navigate search results' },
      { keys: ['Enter'], description: 'Select search result / submit form' },
    ],
  },
  {
    title: 'Tabs (PersonaDetail)',
    shortcuts: [
      { keys: ['←', '→'], description: 'Navigate tabs' },
      { keys: ['Home'], description: 'Jump to first tab' },
      { keys: ['End'], description: 'Jump to last tab' },
    ],
  },
];

// Context for programmatically opening the modal
interface KeyboardShortcutsContextValue {
  open: () => void;
}

const KeyboardShortcutsContext = createContext<KeyboardShortcutsContextValue | null>(null);

// eslint-disable-next-line react-refresh/only-export-components
export function useKeyboardShortcuts() {
  const ctx = useContext(KeyboardShortcutsContext);
  if (!ctx) {
    throw new Error('useKeyboardShortcuts must be used within KeyboardShortcuts');
  }
  return ctx;
}

/**
 * Global keyboard shortcuts help panel + navigation shortcuts handler.
 * Press `?` (when no input is focused) to toggle.
 * Navigation: g+h (home), g+p (personas), g+r (rules), g+a (audit)
 * Actions: n (new), e (edit) - emits custom events for pages to handle
 */
export function KeyboardShortcuts({ children }: { children?: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const navigate = useNavigate();
  
  // Track 'g' prefix for two-key navigation shortcuts
  const gPrefixRef = useRef(false);
  const gPrefixTimeoutRef = useRef<number | null>(null);

  const openModal = useCallback(() => setIsOpen(true), []);
  const closeModal = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((v) => !v), []);

  // Clear g prefix after timeout
  const clearGPrefix = useCallback(() => {
    gPrefixRef.current = false;
    if (gPrefixTimeoutRef.current) {
      clearTimeout(gPrefixTimeoutRef.current);
      gPrefixTimeoutRef.current = null;
    }
  }, []);

  const setGPrefix = useCallback(() => {
    gPrefixRef.current = true;
    if (gPrefixTimeoutRef.current) clearTimeout(gPrefixTimeoutRef.current);
    gPrefixTimeoutRef.current = window.setTimeout(clearGPrefix, 1000);
  }, [clearGPrefix]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't trigger when typing in an input/textarea/select
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      // Don't trigger when a contentEditable element is focused
      if ((e.target as HTMLElement)?.isContentEditable) return;
      // Skip if modifier keys are held (except for special shortcuts)
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.repeat) return;

      const key = e.key.toLowerCase();

      // ? - Toggle shortcuts help
      if (e.key === '?') {
        e.preventDefault();
        toggle();
        return;
      }

      // If modal is open, don't process other shortcuts
      if (isOpen) return;

      // g - Start navigation chord
      if (key === 'g' && !gPrefixRef.current) {
        setGPrefix();
        return;
      }

      // Navigation shortcuts (g + key)
      if (gPrefixRef.current) {
        clearGPrefix();
        switch (key) {
          case 'h':
            e.preventDefault();
            navigate('/');
            return;
          case 'p':
            e.preventDefault();
            navigate('/personas');
            return;
          case 'r':
            e.preventDefault();
            navigate('/rules');
            return;
          case 'a':
            e.preventDefault();
            navigate('/audit');
            return;
          case 'd':
            e.preventDefault();
            navigate('/devices');
            return;
          case 's':
            e.preventDefault();
            navigate('/sources');
            return;
          case 'b':
            e.preventDefault();
            navigate('/browse');
            return;
          case ',':
            e.preventDefault();
            navigate('/settings');
            return;
        }
      }

      // Action shortcuts
      switch (key) {
        case 'n':
          e.preventDefault();
          // Emit custom event for pages to handle "new" action
          window.dispatchEvent(new CustomEvent('keyboard:new'));
          return;
        case 'e':
          e.preventDefault();
          // Emit custom event for pages to handle "edit" action
          window.dispatchEvent(new CustomEvent('keyboard:edit'));
          return;
      }
    };

    // Escape listener registered only when open — avoids interfering with
    // other Escape handlers (ConfirmDialog, Topbar search) when closed.
    const escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Stop other Escape handlers (ConfirmDialog, Topbar search) from firing
        // while the shortcuts panel is the topmost overlay.
        e.stopImmediatePropagation();
        setIsOpen(false);
      }
    };

    document.addEventListener('keydown', handler);
    if (isOpen) {
      // Use capture phase so we intercept Escape before lower-level handlers
      document.addEventListener('keydown', escHandler, true);
    }
    return () => {
      document.removeEventListener('keydown', handler);
      document.removeEventListener('keydown', escHandler, true);
      if (gPrefixTimeoutRef.current) clearTimeout(gPrefixTimeoutRef.current);
    };
  }, [isOpen, toggle, navigate, setGPrefix, clearGPrefix]);

  // Lock body scroll when open — save/restore previous overflow
  const prevOverflowRef = useRef('');
  useEffect(() => {
    if (isOpen) {
      prevOverflowRef.current = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = prevOverflowRef.current; };
    }
  }, [isOpen]);

  const contextValue = useMemo<KeyboardShortcutsContextValue>(() => ({ open: openModal }), [openModal]);

  return (
    <KeyboardShortcutsContext.Provider value={contextValue}>
      {children}
      {isOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={closeModal}
            aria-hidden="true"
          />

          {/* Modal */}
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Keyboard shortcuts"
            className="relative bg-card border border-card-border/50 rounded-2xl shadow-2xl w-full max-w-lg mx-4 animate-scale-in overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-5 border-b border-card-border/35">
              <div className="flex items-center gap-2.5">
                <Keyboard className="w-5 h-5 text-accent" />
                <h2 className="text-lg font-bold text-white">Keyboard Shortcuts</h2>
              </div>
              <button
                onClick={closeModal}
                aria-label="Close"
                className="p-1.5 text-text-tertiary hover:text-white transition-colors rounded-lg hover:bg-white/[0.05]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Shortcuts list */}
            <div className="px-6 py-4 max-h-[60vh] overflow-y-auto">
              <div className="space-y-6">
                {shortcutGroups.map((group) => (
                  <div key={group.title}>
                    <h3 className="text-text-tertiary text-xs font-semibold uppercase tracking-wider mb-3">
                      {group.title}
                    </h3>
                    <div className="space-y-1">
                      {group.shortcuts.map((s, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between py-2 border-b border-card-border/35 last:border-0"
                        >
                          <span className="text-text-secondary text-sm">{s.description}</span>
                          <div className="flex items-center gap-1 flex-shrink-0 ml-4">
                            {s.keys.map((key, j) => (
                              <span key={j} className="flex items-center">
                                <kbd className="inline-flex items-center justify-center min-w-[24px] h-6 px-1.5 bg-white/[0.12] border border-card-border/50 rounded-md text-text-secondary text-xs font-mono">
                                  {key}
                                </kbd>
                                {j < s.keys.length - 1 && (
                                  <span className="text-text-tertiary text-[10px] mx-1">then</span>
                                )}
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-3 border-t border-card-border/35 bg-white/[0.08]">
              <p className="text-text-tertiary text-xs text-center">
                Press <kbd className="px-1.5 py-0.5 bg-white/[0.12] border border-card-border/50 rounded text-[10px] font-mono">?</kbd> to toggle this panel
              </p>
            </div>
          </div>
        </div>
      )}
    </KeyboardShortcutsContext.Provider>
  );
}
