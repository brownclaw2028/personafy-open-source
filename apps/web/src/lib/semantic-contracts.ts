import { normalizeFactKey } from './factKeys';
import type { Fact } from './types';

export type SemanticDomain =
  | 'shopping'
  | 'travel'
  | 'food'
  | 'work'
  | 'fitness'
  | 'gifts'
  | 'health'
  | 'home'
  | 'general';

export type SemanticTemporalStatus = 'current' | 'past' | 'hypothetical';

export interface SemanticExtractionContract {
  domain: SemanticDomain;
  canonical_key: string | null;
  dynamic_key: string | null;
  value: string;
  temporal_status: SemanticTemporalStatus;
  is_negation: boolean;
  evidence_snippet: string;
  confidence: number;
  sensitivity: Fact['sensitivity'];
  source_id: string;
  source_name: string;
}

export interface SemanticExtractionStats {
  recordsProcessed: number;
  segmentsProcessed: number;
  candidateSegments: number;
  candidateWindows: number;
  contractsAccepted: number;
  contractsRejected: number;
}

const SEMANTIC_DOMAINS: readonly SemanticDomain[] = [
  'shopping',
  'travel',
  'food',
  'work',
  'fitness',
  'gifts',
  'health',
  'home',
  'general',
] as const;

const TEMPORAL_STATUSES: readonly SemanticTemporalStatus[] = [
  'current',
  'past',
  'hypothetical',
] as const;

const SENSITIVITY_LEVELS: readonly Fact['sensitivity'][] = ['low', 'medium', 'high'] as const;

const KEY_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/i;

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function clampConfidence(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 0.7;
  return Math.max(0, Math.min(1, raw));
}

function isSemanticDomain(value: unknown): value is SemanticDomain {
  return typeof value === 'string' && (SEMANTIC_DOMAINS as readonly string[]).includes(value);
}

function isTemporalStatus(value: unknown): value is SemanticTemporalStatus {
  return typeof value === 'string' && (TEMPORAL_STATUSES as readonly string[]).includes(value);
}

function isSensitivity(value: unknown): value is Fact['sensitivity'] {
  return typeof value === 'string' && (SENSITIVITY_LEVELS as readonly string[]).includes(value);
}

function sanitizeKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const key = normalizeFactKey(value);
  if (!key) return null;
  if (!KEY_PATTERN.test(key)) return null;
  return key;
}

export function routeDynamicKey(key: string): string {
  const normalized = normalizeFactKey(key);
  if (!normalized) return 'dynamic.unknown';
  const withoutPrefix = normalized.startsWith('dynamic.')
    ? normalized.slice('dynamic.'.length)
    : normalized;
  if (!withoutPrefix || withoutPrefix === 'dynamic') return 'dynamic.unknown';
  return `dynamic.${withoutPrefix}`;
}

function sourceContainsEvidence(sourceText: string, evidenceSnippet: string): boolean {
  const source = normalizeWhitespace(sourceText).toLowerCase();
  const evidence = normalizeWhitespace(evidenceSnippet).toLowerCase();
  if (!source || !evidence) return false;
  return source.includes(evidence);
}

export function inferSemanticDomainFromKey(key: string): SemanticDomain {
  const normalized = normalizeFactKey(key);
  if (normalized.startsWith('apparel.') || normalized.startsWith('brand.') || normalized.startsWith('budget.') || normalized.startsWith('shopping.')) {
    return 'shopping';
  }
  if (normalized.startsWith('travel.') || normalized.startsWith('flight.') || normalized.startsWith('hotel.')) {
    return 'travel';
  }
  if (normalized.startsWith('food.') || normalized.startsWith('dietary.') || normalized.startsWith('restaurant.')) {
    return 'food';
  }
  if (normalized.startsWith('work.')) return 'work';
  if (normalized.startsWith('fitness.') || normalized.startsWith('health.fitness')) return 'fitness';
  if (normalized.startsWith('gift.')) return 'gifts';
  if (normalized.startsWith('health.') || normalized.startsWith('medical.')) return 'health';
  if (normalized.startsWith('home.')) return 'home';
  return 'general';
}

export function validateSemanticContract(
  raw: unknown,
  sourceText: string,
): SemanticExtractionContract | null {
  if (!raw || typeof raw !== 'object') return null;
  const input = raw as Record<string, unknown>;

  const domain = isSemanticDomain(input.domain) ? input.domain : null;
  if (!domain) return null;

  const rawCanonicalKey = sanitizeKey(input.canonical_key);
  const rawDynamicKey = sanitizeKey(input.dynamic_key);
  const canonicalKey = rawCanonicalKey && !rawCanonicalKey.startsWith('dynamic.')
    ? rawCanonicalKey
    : null;
  const dynamicFromCanonical = rawCanonicalKey && rawCanonicalKey.startsWith('dynamic.')
    ? routeDynamicKey(rawCanonicalKey)
    : null;
  const dynamicFromInput = rawDynamicKey ? routeDynamicKey(rawDynamicKey) : null;
  const dynamicKey = dynamicFromInput ?? dynamicFromCanonical;

  // A contract must map to exactly one key path.
  if ((canonicalKey == null && dynamicKey == null) || (canonicalKey != null && dynamicKey != null)) {
    return null;
  }

  if (typeof input.value !== 'string') return null;
  const value = normalizeWhitespace(input.value);
  if (!value) return null;

  if (!isTemporalStatus(input.temporal_status)) return null;

  if (typeof input.is_negation !== 'boolean') return null;

  if (typeof input.evidence_snippet !== 'string') return null;
  const evidenceSnippet = normalizeWhitespace(input.evidence_snippet);
  if (!evidenceSnippet) return null;
  if (!sourceContainsEvidence(sourceText, evidenceSnippet)) return null;

  if (typeof input.source_id !== 'string' || !input.source_id.trim()) return null;
  if (typeof input.source_name !== 'string' || !input.source_name.trim()) return null;

  const sensitivity = isSensitivity(input.sensitivity) ? input.sensitivity : 'low';

  return {
    domain,
    canonical_key: canonicalKey,
    dynamic_key: dynamicKey,
    value,
    temporal_status: input.temporal_status,
    is_negation: input.is_negation,
    evidence_snippet: evidenceSnippet,
    confidence: clampConfidence(input.confidence),
    sensitivity,
    source_id: input.source_id.trim(),
    source_name: input.source_name.trim(),
  };
}
