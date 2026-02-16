import { normalizeFactKey } from './factKeys';
import type { VaultFact, VaultFactEvidence, VaultPersona } from './vault';

type Sensitivity = VaultFact['sensitivity'];
type FactInput = Omit<VaultFact, 'extractedAt'> & { extractedAt?: number | string };
type PersonaInput = Omit<VaultPersona, 'facts'> & { facts: FactInput[] };

const SENSITIVITY_RANK: Record<Sensitivity, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

const FOOD_DELIVERY_SOURCE_PATTERN = /(doordash|uber\s*eats|ubereats|grubhub|opentable|toasttab|resy)/i;

function clampConfidence(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function normalizeSensitivity(value: unknown): Sensitivity {
  if (value === 'high' || value === 'medium' || value === 'low') return value;
  return 'low';
}

function normalizeExtractionMethod(value: unknown): VaultFact['extractionMethod'] | undefined {
  if (value === 'specialized' || value === 'general' || value === 'manual' || value === 'import') {
    return value;
  }
  return undefined;
}

function normalizeReviewStatus(value: unknown): VaultFact['reviewStatus'] | undefined {
  if (value === 'accepted' || value === 'pending' || value === 'rejected') return value;
  return undefined;
}

function sanitizeEvidence(value: unknown): VaultFactEvidence[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const evidence: VaultFactEvidence[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as Record<string, unknown>;
    if (typeof entry.sourceId !== 'string' || !entry.sourceId.trim()) continue;
    if (typeof entry.sourceName !== 'string' || !entry.sourceName.trim()) continue;
    if (typeof entry.snippet !== 'string' || !entry.snippet.trim()) continue;
    const segmentIndex = typeof entry.segmentIndex === 'number' && Number.isFinite(entry.segmentIndex)
      ? Math.max(0, Math.floor(entry.segmentIndex))
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

function mergeEvidence(
  left: VaultFactEvidence[] | undefined,
  right: VaultFactEvidence[] | undefined,
): VaultFactEvidence[] | undefined {
  const merged = sanitizeEvidence([...(left ?? []), ...(right ?? [])]);
  return merged && merged.length > 0 ? merged : undefined;
}

export function parseExtractedAtMs(value: number | string | undefined): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value !== 'string') return undefined;

  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const asNumber = Number(trimmed);
  if (Number.isFinite(asNumber)) return asNumber;

  const asDate = Date.parse(trimmed);
  return Number.isFinite(asDate) ? asDate : undefined;
}

function normalizeShirtSize(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return '';
  switch (normalized) {
    case 'extra small':
    case 'x-small':
    case 'xs':
      return 'XS';
    case 'small':
    case 's':
      return 'S';
    case 'medium':
    case 'm':
      return 'M';
    case 'large':
    case 'l':
      return 'L';
    case 'x-large':
    case 'xlarge':
    case 'xl':
      return 'XL';
    case 'xx-large':
    case 'xxl':
    case '2xl':
      return 'XXL';
    default:
      return value.trim().replace(/\s+/g, ' ');
  }
}

function normalizeFactValue(key: string, value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (!trimmed) return '';

  if (key === 'apparel.shirt.size') {
    return normalizeShirtSize(trimmed);
  }

  if (key === 'apparel.shoe.size') {
    const size = Number.parseFloat(trimmed);
    if (!Number.isFinite(size) || size < 3 || size > 18) return '';
    return Number.isInteger(size) ? String(size) : String(size);
  }

  if (key === 'apparel.pants.waist') {
    const waist = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(waist) || waist < 20 || waist > 60) return '';
    return String(waist);
  }

  if (key === 'apparel.pants.inseam') {
    const inseam = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(inseam) || inseam < 20 || inseam > 40) return '';
    return String(inseam);
  }

  return trimmed;
}

function shouldDropFact(key: string, value: string, source?: string): boolean {
  if (key === 'budget.monthly_clothing' && FOOD_DELIVERY_SOURCE_PATTERN.test(source ?? '')) {
    return true;
  }
  return value.length === 0;
}

function sanitizeFact(input: FactInput): VaultFact | null {
  const key = normalizeFactKey(input.key);
  const value = normalizeFactValue(key, input.value);
  if (shouldDropFact(key, value, input.source)) return null;

  return {
    key,
    value,
    sensitivity: normalizeSensitivity(input.sensitivity),
    confidence: clampConfidence(input.confidence),
    source: input.source?.trim() || undefined,
    extractedAt: parseExtractedAtMs(input.extractedAt),
    extractionMethod: normalizeExtractionMethod(input.extractionMethod),
    requiresConfirmation: typeof input.requiresConfirmation === 'boolean' ? input.requiresConfirmation : undefined,
    reviewStatus: normalizeReviewStatus(input.reviewStatus),
    evidence: sanitizeEvidence(input.evidence),
  };
}

function factSignature(fact: VaultFact): string {
  return `${fact.key}::${fact.value.toLowerCase()}`;
}

function chooseHigherSensitivity(a: Sensitivity, b: Sensitivity): Sensitivity {
  return SENSITIVITY_RANK[a] >= SENSITIVITY_RANK[b] ? a : b;
}

function mergeFacts(existing: FactInput[], incoming: FactInput[]): VaultFact[] {
  const bySignature = new Map<string, VaultFact>();

  const upsert = (raw: FactInput) => {
    const fact = sanitizeFact(raw);
    if (!fact) return;

    const signature = factSignature(fact);
    const current = bySignature.get(signature);
    if (!current) {
      bySignature.set(signature, fact);
      return;
    }

    const currentTs = current.extractedAt ?? 0;
    const incomingTs = fact.extractedAt ?? 0;
    const incomingIsNewer = incomingTs > currentTs;
    bySignature.set(signature, {
      ...current,
      confidence: Math.max(current.confidence, fact.confidence),
      sensitivity: chooseHigherSensitivity(current.sensitivity, fact.sensitivity),
      source: incomingIsNewer ? (fact.source ?? current.source) : (current.source ?? fact.source),
      extractedAt: incomingIsNewer ? fact.extractedAt : current.extractedAt,
      extractionMethod: incomingIsNewer
        ? (fact.extractionMethod ?? current.extractionMethod)
        : (current.extractionMethod ?? fact.extractionMethod),
      requiresConfirmation: (current.requiresConfirmation ?? false) || (fact.requiresConfirmation ?? false),
      reviewStatus: incomingIsNewer
        ? (fact.reviewStatus ?? current.reviewStatus)
        : (current.reviewStatus ?? fact.reviewStatus),
      evidence: mergeEvidence(current.evidence, fact.evidence),
    });
  };

  for (const fact of existing) upsert(fact);
  for (const fact of incoming) upsert(fact);

  return [...bySignature.values()];
}

export function mergeImportedPersonas(
  existingPersonas: VaultPersona[],
  incomingPersonas: PersonaInput[],
): VaultPersona[] {
  const mergedPersonas: VaultPersona[] = existingPersonas.map((persona) => ({
    ...persona,
    facts: mergeFacts([], persona.facts),
  }));

  for (const incoming of incomingPersonas) {
    const matchIndex = mergedPersonas.findIndex((existing) => existing.category === incoming.category);
    if (matchIndex < 0) {
      mergedPersonas.push({
        ...incoming,
        facts: mergeFacts([], incoming.facts),
      });
      continue;
    }

    const existing = mergedPersonas[matchIndex];
    const mergedFacts = mergeFacts(existing.facts, incoming.facts);
    mergedPersonas[matchIndex] = {
      ...existing,
      facts: mergedFacts,
      completionScore: Math.min(1, Math.round((mergedFacts.length / 8) * 100) / 100),
    };
  }

  return mergedPersonas;
}
