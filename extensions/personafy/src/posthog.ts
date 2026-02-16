// ─── PostHog Server-Side Analytics ──────────────────────────────────────────
// Every function no-ops when no API key is provided.
// NEVER send vault field values — only metadata.

import { PostHog } from "posthog-node";

let client: PostHog | null = null;
let distinctId = "personafy-extension";

/**
 * Initialize the PostHog Node client.
 * No-ops when apiKey is falsy.
 */
export function initPostHogNode(apiKey?: string): void {
  if (!apiKey) return;
  client = new PostHog(apiKey, {
    host: "https://us.i.posthog.com",
    flushAt: 10,
    flushInterval: 5000,
  });
}

/** Set the distinct ID for all subsequent captures. */
export function setDistinctId(id: string): void {
  distinctId = id;
}

/** Capture a custom event. Adds `source: 'extension'` automatically. */
export function captureEvent(
  name: string,
  properties?: Record<string, unknown>,
): void {
  client?.capture({
    distinctId,
    event: name,
    properties: { source: "extension", ...properties },
  });
}

/** Flush pending events and shut down the client. */
export async function shutdownPostHog(): Promise<void> {
  if (!client) return;
  await client.shutdown();
  client = null;
}
