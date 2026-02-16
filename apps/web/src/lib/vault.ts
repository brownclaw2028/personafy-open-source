// ─── Vault Types & Raw API ─────────────────────────────────────────────────
// Pure module — no React, no JSX. Safe to import anywhere.

export interface VaultFact {
  key: string;
  value: string;
  sensitivity: 'low' | 'medium' | 'high';
  confidence: number;
  source?: string;
  extractedAt?: number;
  extractionMethod?: 'specialized' | 'general' | 'manual' | 'import';
  requiresConfirmation?: boolean;
  reviewStatus?: 'accepted' | 'pending' | 'rejected';
  evidence?: VaultFactEvidence[];
}

export interface VaultFactEvidence {
  sourceId: string;
  sourceName: string;
  snippet: string;
  segmentIndex: number;
}

export type AutoReleasePolicy = 'follow_posture' | 'always_ask' | 'auto_low';
export type RetentionPeriod = 'never' | '30' | '90' | '180' | '365';

export interface PersonaSettings {
  /** Whether agents can see this persona in requests */
  visible: boolean;
  /** Auto-release policy for this persona's facts */
  autoRelease: AutoReleasePolicy;
  /** Data retention period (days or "never") */
  retention: RetentionPeriod;
}

export interface VaultPersona {
  id: string;
  name: string;
  category: string;
  icon: string;
  description: string;
  completionScore: number;
  facts: VaultFact[];
  /** Per-persona settings — optional, defaults applied in UI */
  personaSettings?: PersonaSettings;
}

export interface VaultRule {
  id: string;
  recipientDomain: string;
  purposeCategory: string;
  purposeAction: string;
  maxSensitivity: 'low' | 'medium' | 'high';
  allowedFields: string[];
  expiresAt: string;
  enabled: boolean;
}

export interface VaultAuditEvent {
  id: string;
  timestamp: string;
  requestId: string;
  decision: 'allow' | 'deny' | 'ask_approved' | 'ask_denied';
  recipientDomain: string;
  purpose: string;
  fieldsReleased: string[];
}

export interface PendingApproval {
  id: string;
  createdAtMs: number;
  expiresAtMs: number;
  status: 'pending' | 'approved' | 'denied';
  resolvedAtMs?: number;
  request: {
    agentId: string;
    purpose: string;
    persona: string;
    fields: string[];
  };
}

export interface PendingFactReview {
  id: string;
  createdAtMs: number;
  status: 'pending' | 'accepted' | 'rejected';
  resolvedAtMs?: number;
  reason: string;
  sourceType?: string;
  sourceName?: string;
  fact: VaultFact;
}

export interface VaultDevice {
  id: string;
  name: string;
  type: 'agent' | 'vault' | 'mobile';
  status: 'connected' | 'disconnected' | 'pairing';
  lastSeen: string;
  ip?: string;
  version?: string;
  /** Dev-only convenience for pairing UI. Real pairing happens via mTLS + vault backend. */
  pairingCode?: string;
  pairingExpiresAt?: string;
}

export interface VaultSettings {
  contextTtlMinutes: number;
  hideHighSensitivity: boolean;
  approvalNotifications: boolean;
  cloudSyncEnabled?: boolean;
}

export interface VaultData {
  version: string;
  createdAt: string;
  privacyPosture: string;
  settings?: VaultSettings;
  devices?: VaultDevice[];
  personas: VaultPersona[];
  rules: VaultRule[];
  auditLog: VaultAuditEvent[];
  approvalQueue?: PendingApproval[];
  factReviewQueue?: PendingFactReview[];
}

import { parseResponseError } from './utils';

const API_URL = '/api/vault';


type VaultFetchResult =
  | { ok: true; data: VaultData }
  | { ok: false; error: string; locked?: boolean; notFound?: boolean };

type VaultSaveResult =
  | { ok: true }
  | { ok: false; error: string; locked?: boolean };

function clampConfidence(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function clampTimestamp(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber)) return asNumber;
    const asDate = Date.parse(value);
    if (Number.isFinite(asDate)) return asDate;
  }
  return undefined;
}

function normalizeReviewStatus(value: unknown): VaultFact['reviewStatus'] | undefined {
  if (value === 'accepted' || value === 'pending' || value === 'rejected') {
    return value;
  }
  return undefined;
}

function normalizeExtractionMethod(value: unknown): VaultFact['extractionMethod'] | undefined {
  if (value === 'specialized' || value === 'general' || value === 'manual' || value === 'import') {
    return value;
  }
  return undefined;
}

function sanitizeFactEvidence(value: unknown): VaultFactEvidence[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const evidence: VaultFactEvidence[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as Record<string, unknown>;
    if (typeof entry.sourceId !== 'string' || !entry.sourceId.trim()) continue;
    if (typeof entry.sourceName !== 'string' || !entry.sourceName.trim()) continue;
    if (typeof entry.snippet !== 'string' || !entry.snippet.trim()) continue;
    const segmentIndexRaw = entry.segmentIndex;
    const segmentIndex = typeof segmentIndexRaw === 'number' && Number.isFinite(segmentIndexRaw)
      ? Math.max(0, Math.floor(segmentIndexRaw))
      : 0;
    evidence.push({
      sourceId: entry.sourceId.trim(),
      sourceName: entry.sourceName.trim(),
      snippet: entry.snippet.trim().replace(/\s+/g, ' ').slice(0, 320),
      segmentIndex,
    });
    if (evidence.length >= 8) break;
  }
  return evidence.length > 0 ? evidence : undefined;
}

function sanitizeVaultFact(raw: unknown): VaultFact | null {
  if (!raw || typeof raw !== 'object') return null;
  const fact = raw as Record<string, unknown>;
  if (typeof fact.key !== 'string' || typeof fact.value !== 'string') return null;
  const key = fact.key.trim();
  const value = fact.value.trim();
  if (!key || !value) return null;

  const sensitivity = fact.sensitivity === 'high' || fact.sensitivity === 'medium' || fact.sensitivity === 'low'
    ? fact.sensitivity
    : 'low';
  const source = typeof fact.source === 'string' && fact.source.trim() ? fact.source.trim() : undefined;
  const extractedAt = clampTimestamp(fact.extractedAt);
  const extractionMethod = normalizeExtractionMethod(fact.extractionMethod);
  const requiresConfirmation = typeof fact.requiresConfirmation === 'boolean'
    ? fact.requiresConfirmation
    : undefined;
  const reviewStatus = normalizeReviewStatus(fact.reviewStatus);
  const evidence = sanitizeFactEvidence(fact.evidence);

  return {
    key,
    value,
    sensitivity,
    confidence: clampConfidence(fact.confidence),
    source,
    extractedAt,
    extractionMethod,
    requiresConfirmation,
    reviewStatus,
    evidence,
  };
}

function buildHeaders(passphrase?: string): HeadersInit | undefined {
  if (!passphrase) return undefined;
  return { 'X-Vault-Passphrase': passphrase };
}

export async function fetchVault(
  signal?: AbortSignal,
  passphrase?: string,
): Promise<VaultFetchResult> {
  try {
    const res = await fetch(API_URL, {
      signal,
      cache: 'no-store',
      headers: buildHeaders(passphrase),
    });
    if (!res.ok) {
      const error = await parseResponseError(res);
      const locked = res.status === 401 || res.status === 423;
      const notFound = res.status === 404;
      return { ok: false, error, locked, notFound };
    }
    const data = await res.json();
    // Ensure settings always has sane defaults (guards against saves that
    // accidentally omit the field, e.g. vault imports from older versions).
    if (!data.settings) {
      data.settings = {
        contextTtlMinutes: 10,
        hideHighSensitivity: true,
        approvalNotifications: true,
        cloudSyncEnabled: false,
      };
    }
    if (Array.isArray(data.personas)) {
      for (const persona of data.personas) {
        if (!Array.isArray(persona.facts)) continue;
        persona.facts = persona.facts
          .map((fact: unknown) => sanitizeVaultFact(fact))
          .filter((fact: VaultFact | null): fact is VaultFact => fact != null);
      }
    }
    if (Array.isArray(data.factReviewQueue)) {
      data.factReviewQueue = data.factReviewQueue
        .map((item: unknown) => {
          if (!item || typeof item !== 'object') return null;
          const review = item as Record<string, unknown>;
          const fact = sanitizeVaultFact(review.fact);
          if (!fact) return null;
          if (typeof review.id !== 'string' || !review.id.trim()) return null;
          const createdAtMs = clampTimestamp(review.createdAtMs);
          if (createdAtMs == null) return null;
          const status = review.status === 'pending' || review.status === 'accepted' || review.status === 'rejected'
            ? review.status
            : 'pending';
          const resolvedAtMs = clampTimestamp(review.resolvedAtMs);
          return {
            id: review.id.trim(),
            createdAtMs,
            status,
            resolvedAtMs,
            reason: typeof review.reason === 'string' ? review.reason : 'Fact requires confirmation.',
            sourceType: typeof review.sourceType === 'string' ? review.sourceType : undefined,
            sourceName: typeof review.sourceName === 'string' ? review.sourceName : undefined,
            fact,
          } as PendingFactReview;
        })
        .filter((review: PendingFactReview | null): review is PendingFactReview => review != null);
    }
    return { ok: true, data };
  } catch {
    return { ok: false, error: 'Could not load vault data' };
  }
}

export async function saveVault(
  data: VaultData,
  passphrase?: string,
  options?: { forceCreate?: boolean },
): Promise<VaultSaveResult> {
  try {
    const extraHeaders: Record<string, string> = {};
    if (options?.forceCreate) {
      extraHeaders['X-Vault-Force-Create'] = '1';
    }
    const res = await fetch(API_URL, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(buildHeaders(passphrase) ?? {}),
        ...extraHeaders,
      },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const error = await parseResponseError(res);
      const locked = res.status === 401 || res.status === 423;
      return { ok: false, error, locked };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: 'Failed to save vault data' };
  }
}
