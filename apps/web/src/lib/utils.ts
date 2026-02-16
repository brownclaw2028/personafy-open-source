// ─── Shared Utility Functions ──────────────────────────────────────────────
// Pure functions extracted from pages for testability and reuse.

import type { VaultFact, VaultAuditEvent, VaultData, VaultPersona } from './vault';
import { normalizeFactKey } from './factKeys';

/**
 * Extract an error message from a failed fetch Response.
 * Tries to parse JSON `{ error: "..." }`, falling back to `res.statusText`.
 */
export async function parseResponseError(res: Response, fallback = 'Request failed'): Promise<string> {
  try {
    const payload = await res.json();
    if (payload && typeof payload.error === 'string') return payload.error;
  } catch {
    // ignore
  }
  return res.statusText || fallback;
}

/**
 * Human-readable relative time string.
 * @param ts  ISO timestamp string
 * @param now Reference timestamp (default: Date.now())
 */
export function timeAgo(ts: string, now: number = Date.now()): string {
  const time = new Date(ts).getTime();
  if (Number.isNaN(time)) return 'Unknown';
  const diff = now - time;
  if (diff < 0) return 'Just now'; // future timestamps treated as "just now"
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

/**
 * Classify an audit event into a display type.
 */
export function eventType(e: VaultAuditEvent): 'approved' | 'denied' | 'auto_allowed' {
  if (e.decision === 'ask_denied' || e.decision === 'deny') return 'denied';
  if (e.decision === 'allow') return 'auto_allowed';
  return 'approved';
}

/**
 * Human-readable labels for common audit event action/purpose segments.
 * Transforms raw snake_case values into polished display text.
 */
const EVENT_ACTION_MAP: Record<string, string> = {
  auto_allow: 'Auto-Allowed',
  deny: 'Denied',
  approve: 'Approved',
  ask_approved: 'Approved',
  ask_denied: 'Denied',
  allow: 'Auto-Allowed',
  context_release: 'Data Access',
  'context release': 'Data Access',
  rule_created: 'Rule Created',
  vault_created: 'Vault Created',
  find_item: 'Find Item',
};

/**
 * Format a raw audit event action/purpose segment into a human-readable label.
 * Checks the known-label map first, then falls back to Title Case conversion.
 */
export function formatEventAction(raw: string): string {
  const lower = raw.trim().toLowerCase();
  if (EVENT_ACTION_MAP[lower]) return EVENT_ACTION_MAP[lower];
  // Fallback: replace underscores/hyphens with spaces and Title Case
  return lower
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Format a full audit purpose string (e.g. "shopping/find_item") into
 * a human-readable label like "Shopping > Find Item".
 */
export function formatPurposeDisplay(purpose: string): string {
  return purpose
    .split('/')
    .map(formatEventAction)
    .join(' > ');
}

/**
 * Create a standard audit event for a new auto-allow rule.
 * This is treated as a "config" event by Audit Log (purpose prefix: rule_created).
 */
export function createRuleCreatedAuditEvent({
  id,
  timestamp,
  requestId,
  recipientDomain,
  purposeCategory,
  purposeAction,
  allowedFields,
}: {
  id?: string;
  timestamp?: string;
  requestId: string;
  recipientDomain: string;
  purposeCategory: string;
  purposeAction: string;
  allowedFields: string[];
}): VaultAuditEvent {
  const auditId = id ?? `aud_${crypto.randomUUID().slice(0, 8)}`;
  const ts = timestamp ?? new Date().toISOString();

  return {
    id: auditId,
    timestamp: ts,
    requestId,
    decision: 'allow',
    recipientDomain,
    purpose: `rule_created/${purposeCategory}/${purposeAction}`,
    fieldsReleased: allowedFields,
  };
}

/**
 * Group facts by their key prefix (first segment before '.').
 * Facts without a '.' in their key go into the 'general' group.
 */
export function groupFactsByCategory(facts: VaultFact[]): Record<string, VaultFact[]> {
  return facts.reduce<Record<string, VaultFact[]>>((acc, fact) => {
    const normalizedKey = normalizeFactKey(fact.key);
    const parts = normalizedKey.split('.');
    const category = parts.length > 1 ? parts[0] : 'general';
    if (!acc[category]) acc[category] = [];
    acc[category].push(fact);
    return acc;
  }, {});
}

/**
 * Expected fact count per category for a "complete" persona.
 * Matches the extractor's thresholds.
 */
const EXPECTED_FACTS: Record<string, number> = {
  Shopping: 8,
  Travel: 6,
  'Food & Dining': 4,
  Work: 3,
  Fitness: 4,
  'Gift Giving': 3,
};

const DEFAULT_EXPECTED = 5;

/**
 * Compute a 0–1 completion score for a persona based on fact count
 * and average confidence. Mirrors the extractor logic so scores stay
 * consistent whether data came from import, QuickStart, or manual entry.
 */
export function computeCompletionScore(
  category: string,
  facts: VaultFact[],
): number {
  const count = facts.length;
  if (count === 0) return 0;
  const expected = EXPECTED_FACTS[category] ?? DEFAULT_EXPECTED;
  const avgConfidence = facts.reduce((s, f) => s + f.confidence, 0) / count;
  // Weight: 70% coverage, 30% confidence quality
  const coverage = Math.min(1, count / expected);
  return Math.min(1, coverage * 0.7 + avgConfidence * 0.3);
}

/**
 * Validate that a parsed JSON object has the required vault structure.
 * Returns `{ ok: true, data }` on success or `{ ok: false, error }` on failure.
 * Does NOT validate deep field types — only structural shape.
 */
export function validateVaultImport(
  raw: unknown,
): { ok: true; data: VaultData } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'Invalid vault format' };
  }
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.personas)) {
    return { ok: false, error: 'Missing personas array' };
  }
  if (!Array.isArray(obj.rules)) {
    return { ok: false, error: 'Missing rules array' };
  }
  if (!Array.isArray(obj.auditLog)) {
    return { ok: false, error: 'Missing auditLog array' };
  }
  if (typeof obj.privacyPosture !== 'string') {
    return { ok: false, error: 'Missing privacyPosture' };
  }
  const validPostures = new Set(['simple_lock', 'alarm_system', 'safe_room']);
  if (!validPostures.has(obj.privacyPosture)) {
    return { ok: false, error: `Unknown posture: ${obj.privacyPosture}` };
  }
  // Validate settings sub-structure (optional)
  if ('settings' in obj && obj.settings != null) {
    if (typeof obj.settings !== 'object' || Array.isArray(obj.settings)) {
      return { ok: false, error: 'settings must be an object' };
    }
    const s = obj.settings as Record<string, unknown>;

    if ('contextTtlMinutes' in s) {
      if (typeof s.contextTtlMinutes !== 'number' || !Number.isFinite(s.contextTtlMinutes)) {
        return { ok: false, error: 'settings.contextTtlMinutes must be a number' };
      }
      if (s.contextTtlMinutes < 0) {
        return { ok: false, error: 'settings.contextTtlMinutes must be >= 0' };
      }
    }

    if ('hideHighSensitivity' in s && typeof s.hideHighSensitivity !== 'boolean') {
      return { ok: false, error: 'settings.hideHighSensitivity must be a boolean' };
    }

    if ('approvalNotifications' in s && typeof s.approvalNotifications !== 'boolean') {
      return { ok: false, error: 'settings.approvalNotifications must be a boolean' };
    }

    if ('cloudSyncEnabled' in s && typeof s.cloudSyncEnabled !== 'boolean') {
      return { ok: false, error: 'settings.cloudSyncEnabled must be a boolean' };
    }
  }

  // Validate persona sub-structure (spot-check first persona if present)
  for (let i = 0; i < obj.personas.length; i++) {
    const p = obj.personas[i] as Record<string, unknown> | null;
    if (!p || typeof p !== 'object') {
      return { ok: false, error: `Persona at index ${i} is not an object` };
    }
    if (typeof p.id !== 'string' || !p.id) {
      return { ok: false, error: `Persona at index ${i} missing id` };
    }
    if (typeof p.name !== 'string' || !p.name) {
      return { ok: false, error: `Persona at index ${i} missing name` };
    }
    if (!Array.isArray(p.facts)) {
      return { ok: false, error: `Persona "${p.name}" missing facts array` };
    }
  }
  // Validate devices if present (optional field)
  if ('devices' in obj) {
    if (!Array.isArray(obj.devices)) {
      return { ok: false, error: 'devices must be an array' };
    }
    const validTypes = new Set(['vault', 'agent', 'mobile']);
    const validStatuses = new Set(['connected', 'disconnected', 'pairing']);
    for (let i = 0; i < (obj.devices as unknown[]).length; i++) {
      const d = (obj.devices as unknown[])[i] as Record<string, unknown> | null;
      if (!d || typeof d !== 'object') {
        return { ok: false, error: `Device at index ${i} is not an object` };
      }
      if (typeof d.id !== 'string' || !d.id) {
        return { ok: false, error: `Device at index ${i} missing id` };
      }
      if (typeof d.name !== 'string' || !d.name) {
        return { ok: false, error: `Device at index ${i} missing name` };
      }
      if (!validTypes.has(d.type as string)) {
        return { ok: false, error: `Device at index ${i} has invalid type: ${d.type}` };
      }
      if (!validStatuses.has(d.status as string)) {
        return { ok: false, error: `Device at index ${i} has invalid status: ${d.status}` };
      }
    }
  }
  return { ok: true, data: raw as VaultData };
}

/**
 * A single highlight line for a persona.
 */
interface PersonaHighlight {
  personaId: string;
  personaName: string;
  icon: string;
  /** 2-4 short fact snippets, e.g. ["32W/30L slim fit", "J.Crew", "$200-300"] */
  snippets: string[];
}

/**
 * Keys that produce the most interesting highlights per category.
 * Order matters — first match wins for each slot.
 */
const HIGHLIGHT_KEYS: Record<string, string[]> = {
  Shopping: [
    'apparel.fit_preference',
    'apparel.pants.waist',
    'apparel.preferred_brands',
    'budget.monthly_clothing',
    'apparel.shirt.size',
    'apparel.shoe.size',
  ],
  Travel: [
    'hotel.room_preference',
    'flight.seat_preference',
    'travel.loyalty_programs',
    'travel.favorite_destinations',
    'travel.frequency',
  ],
  'Food & Dining': [
    'dietary.restrictions',
    'dietary.allergies',
    'food.coffee_preferences',
    'food.favorite_cuisines',
  ],
  Work: ['work.communication_style', 'work.tools', 'work.productivity_preference'],
  Fitness: ['fitness.frequency', 'fitness.goal', 'fitness.running_shoes'],
  'Gift Giving': ['gifts.partner_interests', 'gifts.mom_interests', 'budget.gift_range'],
};

const FALLBACK_KEYS = ['preferred_brands', 'budget', 'style', 'preference'];

/**
 * Derive 2-4 highlight snippets per persona for a dashboard summary.
 * Returns at most `maxPersonas` results (default 4).
 */
export function deriveHighlights(
  personas: VaultPersona[],
  maxPersonas = 4,
): PersonaHighlight[] {
  const results: PersonaHighlight[] = [];

  for (const p of personas) {
    if (p.facts.length === 0) continue;
    if (results.length >= maxPersonas) break;

    const hasPriorityKeys = p.category in HIGHLIGHT_KEYS;
    const priorityKeys = hasPriorityKeys ? HIGHLIGHT_KEYS[p.category] : FALLBACK_KEYS;
    const snippets: string[] = [];
    const used = new Set<string>();

    // First pass: pick from priority keys in order
    for (const key of priorityKeys) {
      if (snippets.length >= 4) break;
      const fact = p.facts.find((f) => {
        const normalizedKey = normalizeFactKey(f.key);
        const matches = hasPriorityKeys ? normalizedKey === key : normalizedKey.includes(key);
        return matches && !used.has(normalizedKey + ':' + f.value);
      });
      if (fact) {
        used.add(normalizeFactKey(fact.key) + ':' + fact.value);
        snippets.push(formatSnippet(fact));
      }
    }

    // Second pass: fill remaining slots with any unused facts (prefer low sensitivity)
    if (snippets.length < 2) {
      const sorted = [...p.facts]
        .filter((f) => !used.has(normalizeFactKey(f.key) + ':' + f.value))
        .sort((a, b) => sensitivityRank(a.sensitivity) - sensitivityRank(b.sensitivity));
      for (const f of sorted) {
        if (snippets.length >= 3) break;
        snippets.push(formatSnippet(f));
      }
    }

    if (snippets.length > 0) {
      results.push({
        personaId: p.id,
        personaName: p.name,
        icon: p.icon,
        snippets,
      });
    }
  }

  return results;
}

function sensitivityRank(s: string): number {
  if (s === 'low') return 0;
  if (s === 'medium') return 1;
  return 2; // high — deprioritize
}

/**
 * Format a fact value into a concise snippet.
 * Truncates long values and capitalizes the first letter.
 */
function formatSnippet(fact: VaultFact): string {
  const normalizedKey = normalizeFactKey(fact.key);
  // For high-sensitivity facts, mask the value
  if (fact.sensitivity === 'high') {
    return humanizeKey(normalizedKey);
  }
  const val = fact.value.trim();
  // Combine key context for size/measurement facts
  if (normalizedKey.includes('size') || normalizedKey.includes('inseam') || normalizedKey.includes('waist')) {
    return `${humanizeKey(normalizedKey)}: ${val}`;
  }
  // For short values, just capitalize
  if (val.length <= 30) {
    return val.charAt(0).toUpperCase() + val.slice(1);
  }
  return val.slice(0, 28).trim() + '…';
}

function humanizeKey(key: string): string {
  const normalized = normalizeFactKey(key);
  return normalized
    .replace(/[._]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Format a fact key for display: drops the top-level category prefix
 * and humanizes the remaining segments.
 * e.g. "apparel.pants.waist" → "Pants Waist"
 *      "food.favorite_cuisines" → "Favorite Cuisines"
 *      "fitness.primary_activity" → "Primary Activity"
 */
export function formatFactKey(key: string): string {
  const normalized = normalizeFactKey(key);
  const parts = normalized.split('.');
  const display = parts.length > 1 ? parts.slice(1).join('.') : normalized;
  return display
    .replace(/[._]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Score Normalization ──────────────────────────────────────────────────

/**
 * Normalize a completion score to the 0–1 range.
 *
 * Vault data may store `completionScore` as either:
 *  - A decimal in [0, 1] (e.g. 0.85 meaning 85%)
 *  - An integer in (1, 100] (e.g. 85 meaning 85%)
 *
 * All display code assumes 0–1 and multiplies by 100 for display,
 * so values > 1 must be divided by 100 first.
 */
export function normalizeCompletionScore(score: number): number {
  if (score > 1) return Math.min(1, score / 100);
  return Math.max(0, score);
}

// ─── Fact Sorting ─────────────────────────────────────────────────────────

export type FactSortOption = 'default' | 'key_asc' | 'sensitivity_desc' | 'confidence_desc';

const SENSITIVITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

/**
 * Sort a list of facts by the given criterion.
 * Returns a new array (never mutates the input).
 * - `default`: preserves original order
 * - `key_asc`: alphabetical by key
 * - `sensitivity_desc`: high → medium → low
 * - `confidence_desc`: highest confidence first
 */
export function sortFacts(facts: VaultFact[], sort: FactSortOption): VaultFact[] {
  if (sort === 'default' || facts.length <= 1) return facts;

  return [...facts].sort((a, b) => {
    const keyA = normalizeFactKey(a.key);
    const keyB = normalizeFactKey(b.key);
    switch (sort) {
      case 'key_asc':
        return keyA.localeCompare(keyB);
      case 'sensitivity_desc': {
        const diff = (SENSITIVITY_RANK[a.sensitivity] ?? 3) - (SENSITIVITY_RANK[b.sensitivity] ?? 3);
        // Stable secondary sort by key when sensitivity is equal
        return diff !== 0 ? diff : keyA.localeCompare(keyB);
      }
      case 'confidence_desc': {
        const diff = b.confidence - a.confidence;
        return diff !== 0 ? diff : keyA.localeCompare(keyB);
      }
      default:
        return 0;
    }
  });
}

// ─── Duplicate Fact Detection ─────────────────────────────────────────────

interface DuplicateGroup {
  /** The shared fact key */
  key: string;
  /** Number of facts with this key */
  count: number;
  /** The distinct values for this key */
  values: string[];
}

/**
 * Detect facts that share the same key (potential duplicates).
 * Returns only groups with 2+ entries, sorted by count descending.
 */
export function detectDuplicateFacts(facts: VaultFact[]): DuplicateGroup[] {
  const byKey = new Map<string, string[]>();
  for (const f of facts) {
    const normalizedKey = normalizeFactKey(f.key);
    const existing = byKey.get(normalizedKey);
    if (existing) {
      existing.push(f.value);
    } else {
      byKey.set(normalizedKey, [f.value]);
    }
  }

  const groups: DuplicateGroup[] = [];
  for (const [key, values] of byKey) {
    if (values.length >= 2) {
      groups.push({ key, count: values.length, values });
    }
  }

  // Sort by count descending, then key alphabetically
  return groups.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}
