// ─── PostHog Client-Side Analytics ──────────────────────────────────────────
// Every function no-ops when VITE_POSTHOG_KEY is absent, so PostHog is
// fully opt-in. NEVER send vault field values — only metadata.

import type posthogLib from 'posthog-js';

let posthog: typeof posthogLib | null = null;

/**
 * Initialize PostHog. Call once in App.tsx.
 * No-ops when VITE_POSTHOG_KEY is not set.
 */
export function initPostHog(): void {
  const key = import.meta.env.VITE_POSTHOG_KEY;
  if (!key) return;

  // Lazy import so the library isn't bundled when unused.
  import('posthog-js').then((mod) => {
    posthog = mod.default;
    posthog.init(key, {
      api_host: 'https://us.i.posthog.com',
      capture_pageview: false, // We handle SPA routing manually
      autocapture: false,
      session_recording: {
        maskAllInputs: true,
        maskTextSelector: '*',
      },
      persistence: 'localStorage',
    });
  });
}

/** Track a page view (call on every route change). */
export function trackPageView(path: string): void {
  posthog?.capture('$pageview', { $current_url: path });
}

/** Capture a custom event with optional properties. */
export function trackEvent(name: string, properties?: Record<string, unknown>): void {
  posthog?.capture(name, properties);
}

