import { useEffect, useCallback } from 'react';

function applyDarkMode(): void {
  document.documentElement.classList.add('dark');
}

export function useDarkMode() {
  // Dark mode is always on — light mode is not supported with the current theme.
  const isDark = true;

  useEffect(() => {
    applyDarkMode();
  }, []);

  // toggle and setDarkMode are no-ops to preserve the API surface
  const toggle = useCallback(() => {}, []);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const setDarkMode = useCallback((_v: boolean) => { /* no-op */ }, []);

  return { isDark, toggle, setDarkMode };
}

// Initialize dark mode on page load (before React hydrates)
if (typeof window !== 'undefined') {
  applyDarkMode();
}
