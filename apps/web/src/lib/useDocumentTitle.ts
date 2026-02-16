import { useEffect } from 'react';

const APP_NAME = 'Personafy';

/**
 * Set the document title. Restores to base app name on unmount.
 * @param title  Page-specific title (e.g. "Home"). Pass empty string for just the app name.
 */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = title ? `${title} — ${APP_NAME}` : APP_NAME;
    return () => {
      document.title = APP_NAME;
    };
  }, [title]);
}
