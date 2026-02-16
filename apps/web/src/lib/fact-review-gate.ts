import { normalizeFactKey } from './factKeys';
import type { GeneralExtractedFact, GeneralFactEvidence } from './general-extractor';
import type { Fact } from './types';
import type { PendingFactReview } from './vault';

const LOW_CONFIDENCE_THRESHOLD = 0.78;

const HIGH_SENSITIVITY_KEY_PREFIXES = [
  'health.',
  'medical.',
  'identity.',
  'location.',
  'payment.',
  'device.',
  'contact.',
  'travel.home_',
  'travel.passport',
  'dietary.allergies',
] as const;

interface ReviewGateInput {
  primaryFacts: Fact[];
  generalFacts: GeneralExtractedFact[];
  nowMs?: number;
}

interface ReviewGateStats {
  processed: number;
  accepted: number;
  pending: number;
  corroborated: number;
}

export interface ReviewGateResult {
  acceptedFacts: GeneralExtractedFact[];
  pendingReviews: PendingFactReview[];
  stats: ReviewGateStats;
}

function factSignature(key: string, value: string): string {
  return `${normalizeFactKey(key)}::${value.trim().toLowerCase()}`;
}

function factSignatureForFact(fact: { key: string; value: string }): string {
  return factSignature(fact.key, fact.value);
}

function hashString(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  const asHex = Math.abs(hash).toString(16);
  return asHex.padStart(8, '0').slice(0, 8);
}

function normalizeEvidence(evidence: GeneralFactEvidence[] | undefined): GeneralFactEvidence[] {
  if (!evidence || evidence.length === 0) return [];

  const seen = new Set<string>();
  const normalized: GeneralFactEvidence[] = [];

  for (const item of evidence) {
    const snippet = item.snippet.trim().replace(/\s+/g, ' ');
    if (!snippet) continue;
    const signature = `${item.sourceId}|${item.segmentIndex}|${snippet.toLowerCase()}`;
    if (seen.has(signature)) continue;
    seen.add(signature);
    normalized.push({
      sourceId: item.sourceId,
      sourceName: item.sourceName,
      snippet: snippet.length > 260 ? `${snippet.slice(0, 257).trim()}...` : snippet,
      segmentIndex: item.segmentIndex,
    });
    if (normalized.length >= 6) break;
  }

  return normalized;
}

function mergeEvidence(
  a: GeneralFactEvidence[] | undefined,
  b: GeneralFactEvidence[] | undefined,
): GeneralFactEvidence[] {
  return normalizeEvidence([...(a ?? []), ...(b ?? [])]);
}

function containsSensitiveKey(key: string): boolean {
  const normalized = normalizeFactKey(key);
  return HIGH_SENSITIVITY_KEY_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function isDynamicKey(key: string): boolean {
  return normalizeFactKey(key).startsWith('dynamic.');
}

function requiresManualConfirmation(fact: GeneralExtractedFact): { required: boolean; reason: string } {
  if (isDynamicKey(fact.key)) {
    return { required: true, reason: 'dynamic_key' };
  }
  if (fact.sensitivity === 'high' || containsSensitiveKey(fact.key)) {
    return { required: true, reason: 'high_sensitivity' };
  }
  if (fact.confidence < LOW_CONFIDENCE_THRESHOLD) {
    return { required: true, reason: 'low_confidence' };
  }
  if ((fact.evidence?.length ?? 0) === 0) {
    return { required: true, reason: 'missing_evidence' };
  }
  return { required: false, reason: 'auto_accepted' };
}

function buildReviewReason(code: string): string {
  switch (code) {
    case 'dynamic_key':
      return 'Dynamic schema fact requires explicit confirmation before saving.';
    case 'high_sensitivity':
      return 'High-sensitivity fact from catch-all extraction requires confirmation.';
    case 'low_confidence':
      return 'Low-confidence catch-all fact requires confirmation before saving.';
    case 'missing_evidence':
      return 'Fact is missing evidence snippets and requires confirmation.';
    default:
      return 'Fact requires confirmation before saving.';
  }
}

function uniqueAcceptedFacts(facts: GeneralExtractedFact[]): GeneralExtractedFact[] {
  const bySignature = new Map<string, GeneralExtractedFact>();

  for (const fact of facts) {
    const signature = factSignatureForFact(fact);
    const existing = bySignature.get(signature);
    if (!existing) {
      bySignature.set(signature, fact);
      continue;
    }

    const incomingPreferred = fact.confidence > existing.confidence;
    const preferred = incomingPreferred ? fact : existing;
    const secondary = incomingPreferred ? existing : fact;

    bySignature.set(signature, {
      ...preferred,
      confidence: Math.max(preferred.confidence, secondary.confidence),
      evidence: mergeEvidence(preferred.evidence, secondary.evidence),
      sensitivity: preferred.sensitivity === 'high' || secondary.sensitivity === 'high'
        ? 'high'
        : (preferred.sensitivity === 'medium' || secondary.sensitivity === 'medium' ? 'medium' : 'low'),
      requiresConfirmation: false,
      reviewStatus: 'accepted',
      extractionMethod: 'general',
    });
  }

  return [...bySignature.values()].sort((a, b) => b.confidence - a.confidence);
}

function dedupePendingReviews(reviews: PendingFactReview[]): PendingFactReview[] {
  const bySignature = new Map<string, PendingFactReview>();
  for (const review of reviews) {
    const signature = pendingReviewSignature(review);
    const existing = bySignature.get(signature);
    if (!existing) {
      bySignature.set(signature, review);
      continue;
    }

    const currentEvidence = existing.fact.evidence?.length ?? 0;
    const incomingEvidence = review.fact.evidence?.length ?? 0;
    const incomingPreferred =
      review.fact.confidence > existing.fact.confidence
      || (review.fact.confidence === existing.fact.confidence && incomingEvidence > currentEvidence);
    if (incomingPreferred) bySignature.set(signature, review);
  }

  return [...bySignature.values()].sort((a, b) => b.fact.confidence - a.fact.confidence);
}

export function pendingReviewSignature(review: Pick<PendingFactReview, 'fact'>): string {
  return factSignatureForFact(review.fact);
}

export function mergePendingFactReviews(
  existing: PendingFactReview[],
  incoming: PendingFactReview[],
): PendingFactReview[] {
  const resolved = existing.filter((item) => item.status !== 'pending');
  const pending = dedupePendingReviews([
    ...existing.filter((item) => item.status === 'pending'),
    ...incoming,
  ]);
  return [...resolved, ...pending];
}

export function gateGeneralFactsForReview({
  primaryFacts,
  generalFacts,
  nowMs = Date.now(),
}: ReviewGateInput): ReviewGateResult {
  const primarySignatures = new Set(primaryFacts.map((fact) => factSignatureForFact(fact)));

  const accepted: GeneralExtractedFact[] = [];
  const pending: PendingFactReview[] = [];
  let corroboratedCount = 0;

  for (const fact of generalFacts) {
    const signature = factSignatureForFact(fact);
    const evidence = normalizeEvidence(fact.evidence);
    const dynamicKey = isDynamicKey(fact.key);
    const normalizedFact: GeneralExtractedFact = {
      ...fact,
      key: normalizeFactKey(fact.key),
      value: fact.value.trim(),
      confidence: Math.max(0, Math.min(1, fact.confidence)),
      sensitivity: dynamicKey ? 'high' : fact.sensitivity,
      evidence,
      extractionMethod: 'general',
    };
    if (!normalizedFact.value) continue;

    if (!dynamicKey && primarySignatures.has(signature)) {
      corroboratedCount += 1;
      accepted.push({
        ...normalizedFact,
        confidence: Math.max(normalizedFact.confidence, 0.9),
        requiresConfirmation: false,
        reviewStatus: 'accepted',
      });
      continue;
    }

    const reviewGate = requiresManualConfirmation(normalizedFact);
    if (!reviewGate.required) {
      accepted.push({
        ...normalizedFact,
        requiresConfirmation: false,
        reviewStatus: 'accepted',
      });
      continue;
    }

    pending.push({
      id: `fr_${hashString(signature)}`,
      createdAtMs: nowMs,
      status: 'pending',
      reason: buildReviewReason(reviewGate.reason),
      sourceType: normalizedFact.metadata?.sourceType,
      sourceName: normalizedFact.source,
      fact: {
        ...normalizedFact,
        requiresConfirmation: true,
        reviewStatus: 'pending',
      },
    });
  }

  const acceptedFacts = uniqueAcceptedFacts(accepted);
  const pendingReviews = dedupePendingReviews(pending);

  return {
    acceptedFacts,
    pendingReviews,
    stats: {
      processed: generalFacts.length,
      accepted: acceptedFacts.length,
      pending: pendingReviews.length,
      corroborated: corroboratedCount,
    },
  };
}
