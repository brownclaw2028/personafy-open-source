import { useSyncExternalStore } from 'react';

type Listener = () => void;

interface NowStore {
  getSnapshot: () => number;
  subscribe: (listener: Listener) => () => void;
}

interface CachedStore extends NowStore {
  subscribers: number;
  timerId: number | null;
}

const storeCache = new Map<number, CachedStore>();

function getOrCreateStore(intervalMs: number): CachedStore {
  const existing = storeCache.get(intervalMs);
  if (existing) return existing;

  let now = Date.now();
  const listeners = new Set<Listener>();

  const notify = () => {
    for (const l of listeners) l();
  };

  const store: CachedStore = {
    subscribers: 0,
    timerId: null,
    getSnapshot: () => now,
    subscribe: (listener) => {
      listeners.add(listener);
      store.subscribers++;
      if (store.timerId == null) {
        store.timerId = window.setInterval(() => {
          now = Date.now();
          notify();
        }, intervalMs);
      }
      return () => {
        listeners.delete(listener);
        store.subscribers--;
        if (store.subscribers === 0) {
          if (store.timerId != null) {
            window.clearInterval(store.timerId);
            store.timerId = null;
          }
          storeCache.delete(intervalMs);
        }
      };
    },
  };

  storeCache.set(intervalMs, store);
  return store;
}

/**
 * Returns an updating `Date.now()` value without using setState in effects.
 *
 * We use `useSyncExternalStore` to keep ESLint's `react-hooks/set-state-in-effect`
 * happy while still providing a periodic tick for UI (e.g., time-ago labels).
 *
 * All components using the same `intervalMs` share a single timer instance.
 *
 * Note: `intervalMs` should be stable for the lifetime of a component.
 */
export function useNow(intervalMs: number): number {
  const store = getOrCreateStore(intervalMs);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
