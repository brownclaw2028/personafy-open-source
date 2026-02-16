import { useState, useEffect, useCallback, useRef } from 'react';
import { Check, X, AlertTriangle, Info } from 'lucide-react';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: string;
  message: string;
  type: ToastType;
  exiting?: boolean;
}

const MAX_VISIBLE_TOASTS = 4;
const TOAST_DURATION = 3000;
const EXIT_ANIMATION_DURATION = 300;

let addToastFn: ((message: string, type?: ToastType) => void) | null = null;

/** Fire a toast from anywhere: `toast('Saved!')` or `toast('Error!', 'error')` */
// eslint-disable-next-line react-refresh/only-export-components
export function toast(message: string, type: ToastType = 'success') {
  addToastFn?.(message, type);
}

const icons = {
  success: Check,
  error: X,
  warning: AlertTriangle,
  info: Info,
};

const colors = {
  success: 'bg-accent/10 border-accent/30 text-accent',
  error: 'bg-red-400/10 border-red-400/30 text-red-400',
  warning: 'bg-yellow-400/10 border-yellow-400/30 text-yellow-400',
  info: 'bg-primary/10 border-primary/30 text-primary',
};

export function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timersRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  const dismissToast = useCallback((id: string) => {
    // Start exit animation
    setToasts(prev => prev.map(t => 
      t.id === id ? { ...t, exiting: true } : t
    ));
    
    // Remove after animation completes
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, EXIT_ANIMATION_DURATION);
  }, []);

  const addToast = useCallback((message: string, type: ToastType = 'success') => {
    const id = crypto.randomUUID().slice(0, 8);
    
    setToasts(prev => {
      const newToasts = [...prev, { id, message, type }];
      
      // If exceeding max, dismiss oldest non-exiting toasts
      const activeToasts = newToasts.filter(t => !t.exiting);
      if (activeToasts.length > MAX_VISIBLE_TOASTS) {
        const toRemove = activeToasts.slice(0, activeToasts.length - MAX_VISIBLE_TOASTS);
        toRemove.forEach(t => {
          // Clear existing timer
          const timer = timersRef.current.get(t.id);
          if (timer) {
            clearTimeout(timer);
            timersRef.current.delete(t.id);
          }
          // Start exit immediately
          setTimeout(() => dismissToast(t.id), 0);
        });
      }
      
      return newToasts;
    });

    // Set auto-dismiss timer
    const timer = setTimeout(() => {
      timersRef.current.delete(id);
      dismissToast(id);
    }, TOAST_DURATION);
    timersRef.current.set(id, timer);
  }, [dismissToast]);

  useEffect(() => {
    addToastFn = addToast;
    const timers = timersRef.current;
    return () => { 
      addToastFn = null;
      // Cleanup all timers on unmount
      timers.forEach(timer => clearTimeout(timer));
      timers.clear();
    };
  }, [addToast]);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col-reverse gap-2 pointer-events-none">
      {toasts.map(t => {
        const Icon = icons[t.type];
        const isUrgent = t.type === 'error' || t.type === 'warning';
        return (
          <div
            key={t.id}
            role={isUrgent ? 'alert' : 'status'}
            aria-live={isUrgent ? 'assertive' : 'polite'}
            className={`
              flex items-center gap-3 px-4 py-3 rounded-xl border backdrop-blur-sm
              pointer-events-auto
              ${t.exiting ? 'animate-slide-out' : 'animate-slide-up'}
              ${colors[t.type]}
            `}
          >
            <Icon className="w-4 h-4 flex-shrink-0" />
            <span className="text-sm font-medium text-white">{t.message}</span>
            <button
              onClick={() => dismissToast(t.id)}
              className="ml-2 opacity-60 hover:opacity-100 transition-opacity"
              aria-label="Dismiss"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
