import { BaseExtractor } from './base-extractor';
import { normalizeFactKey } from './factKeys';
import type {
  GeneralExtractedFact,
  GeneralExtractionRecord,
  GeneralFactEvidence,
} from './general-extractor';
import {
  inferSemanticDomainFromKey,
  type SemanticExtractionContract,
  type SemanticExtractionStats,
  validateSemanticContract,
} from './semantic-contracts';

const QUERY_INTENT_PATTERN =
  /\b(how do i|where can i|what should i|what is|can you|could you|recommend|suggest|looking for|search(?:ing)? for|find me|help me|tips for|best .* for|which one|should i)\b/i;

// Broad high-recall sieve before semantic contract mapping.
const SEMANTIC_SIEVE_PATTERN =
  /\b(i|my|mine|we|our).{0,40}\b(am|is|are|have|has|need|require|want|prefer|love|like|hate|avoid|wear|use|own|book|buy|bought|pick|choose|allergic|allergy|size|measure|diet)\b/i;

const SENSITIVITY_RANK: Record<GeneralExtractedFact['sensitivity'], number> = {
  low: 0,
  medium: 1,
  high: 2,
};

interface SemanticCandidateBuildResult {
  records: GeneralExtractionRecord[];
  sourceTextById: Map<string, string>;
  stats: Pick<SemanticExtractionStats, 'recordsProcessed' | 'segmentsProcessed' | 'candidateSegments' | 'candidateWindows'>;
}

export interface SemanticExtractionResult {
  facts: GeneralExtractedFact[];
  contracts: SemanticExtractionContract[];
  stats: SemanticExtractionStats;
}

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function normalizeSnippet(segment: string): string {
  const compact = normalizeWhitespace(segment);
  if (compact.length <= 240) return compact;
  return `${compact.slice(0, 237).trim()}...`;
}

function splitIntoSentences(content: string): string[] {
  const trimmed = content.trim();
  if (!trimmed) return [];

  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
    return Array.from(segmenter.segment(trimmed))
      .map((entry) => normalizeWhitespace(entry.segment))
      .filter((entry) => entry.length >= 8);
  }

  return trimmed
    .split(/[\r\n]+|(?<=[.!?])\s+/)
    .map((entry) => normalizeWhitespace(entry))
    .filter((entry) => entry.length >= 8);
}

function isSemanticCandidateSentence(sentence: string): boolean {
  const normalized = normalizeWhitespace(sentence);
  if (!normalized || normalized.includes('?')) return false;
  if (QUERY_INTENT_PATTERN.test(normalized)) return false;
  return SEMANTIC_SIEVE_PATTERN.test(normalized);
}

function buildCandidateRecords(records: GeneralExtractionRecord[]): SemanticCandidateBuildResult {
  const candidateRecords: GeneralExtractionRecord[] = [];
  const sourceTextById = new Map<string, string>();
  let segmentsProcessed = 0;
  let candidateSegments = 0;

  for (const record of records) {
    const segments = splitIntoSentences(record.content);
    segmentsProcessed += segments.length;

    for (let idx = 0; idx < segments.length; idx += 1) {
      if (!isSemanticCandidateSentence(segments[idx])) continue;
      candidateSegments += 1;

      const windowSegments = [segments[idx - 1], segments[idx], segments[idx + 1]]
        .filter((segment): segment is string => Boolean(segment))
        .map((segment) => normalizeWhitespace(segment))
        .filter((segment) => segment.length > 0);

      const sourceId = `${record.sourceId}::sem:${idx}`;
      const sourceName = `${record.sourceName} [semantic]`;
      const windowText = windowSegments.join(' ');

      candidateRecords.push({
        sourceType: record.sourceType,
        sourceId,
        sourceName,
        content: windowText,
      });
      sourceTextById.set(sourceId, windowText);
    }
  }

  return {
    records: candidateRecords,
    sourceTextById,
    stats: {
      recordsProcessed: records.length,
      segmentsProcessed,
      candidateSegments,
      candidateWindows: candidateRecords.length,
    },
  };
}

function factSignature(key: string, value: string): string {
  return `${normalizeFactKey(key)}::${normalizeWhitespace(value).toLowerCase()}`;
}

class SemanticExtractorEngine extends BaseExtractor {
  private evidenceBySignature = new Map<string, GeneralFactEvidence[]>();

  protected initPatterns(): void {
    // Semantic extraction reuses BaseExtractor category methods directly.
  }

  extractCandidate(record: GeneralExtractionRecord): void {
    const before = this.snapshotFactConfidence();
    this.extractStableFacts(record.content, record.sourceName, record.sourceId);
    this.captureEvidenceDelta(record, before);
  }

  private snapshotFactConfidence(): Map<string, number> {
    const snapshot = new Map<string, number>();
    for (const fact of this.extractedFacts) {
      snapshot.set(factSignature(fact.key, fact.value), fact.confidence);
    }
    return snapshot;
  }

  private captureEvidenceDelta(record: GeneralExtractionRecord, previous: Map<string, number>): void {
    const snippet = normalizeSnippet(record.content);
    for (const fact of this.extractedFacts) {
      const signature = factSignature(fact.key, fact.value);
      const prevConfidence = previous.get(signature);
      const confidenceChanged = prevConfidence == null || fact.confidence > prevConfidence + 1e-6;
      if (!confidenceChanged) continue;

      const evidence = this.evidenceBySignature.get(signature) ?? [];
      const duplicate = evidence.some(
        (item) => item.sourceId === record.sourceId && item.segmentIndex === 0 && item.snippet === snippet,
      );
      if (duplicate) continue;
      if (evidence.length >= 8) continue;

      evidence.push({
        sourceId: record.sourceId,
        sourceName: record.sourceName,
        snippet,
        segmentIndex: 0,
      });
      this.evidenceBySignature.set(signature, evidence);
    }
  }

  private extractStableFacts(content: string, sourceName: string, sourceId: string): void {
    this.extractClothingFactsCommon(content, sourceName, {
      includeBudget: true,
      includeBrandLoyalty: true,
      includePriceSensitivity: true,
      includeSeasonalPatterns: false,
      includeReturnFrequency: false,
    });
    this.extractTravelFactsCommon(content, sourceName, {
      includeHotelChains: true,
      includeTravelStyle: true,
      includeTripFrequency: true,
    });
    this.extractFoodFactsCommon(content, sourceName, {
      includeCookingFrequency: true,
      includeMealPrep: true,
      includeRestaurantBudget: true,
      includeCuisineExploration: true,
    });
    this.extractWorkFactsCommon(content, sourceName);
    this.extractFitnessFactsCommon(content, sourceName, {
      includeWorkoutFrequency: true,
      includeEquipment: true,
      includeCompetition: true,
    });
    this.extractGiftFactsCommon(content, sourceName, {
      includeBudgetPerOccasion: true,
      includeGiftStyle: true,
    });
    this.extractEntertainmentFactsCommon(content, sourceName);
    this.extractHomeFactsCommon(content, sourceName);
    this.extractHealthFactsCommon(content, sourceName);

    void sourceId;
  }

  getFactsWithEvidence(): GeneralExtractedFact[] {
    this.organizeExtractedFacts();
    return this.extractedFacts.map((fact) => ({
      ...fact,
      extractionMethod: 'general',
      evidence: this.evidenceBySignature.get(factSignature(fact.key, fact.value)) ?? [],
    }));
  }
}

function mergeEvidence(
  left: GeneralExtractedFact['evidence'],
  right: GeneralExtractedFact['evidence'],
): GeneralExtractedFact['evidence'] {
  const seen = new Set<string>();
  return [...left, ...right]
    .filter((entry) => {
      const signature = `${entry.sourceId}|${entry.segmentIndex}|${entry.snippet.toLowerCase()}`;
      if (seen.has(signature)) return false;
      seen.add(signature);
      return true;
    })
    .slice(0, 8);
}

function mergeSensitivity(
  current: GeneralExtractedFact['sensitivity'],
  incoming: GeneralExtractedFact['sensitivity'],
): GeneralExtractedFact['sensitivity'] {
  return SENSITIVITY_RANK[incoming] > SENSITIVITY_RANK[current] ? incoming : current;
}

function dedupeSemanticFacts(facts: GeneralExtractedFact[]): GeneralExtractedFact[] {
  const merged = new Map<string, GeneralExtractedFact>();

  for (const fact of facts) {
    const key = normalizeFactKey(fact.key);
    const value = normalizeWhitespace(fact.value);
    if (!key || !value) continue;

    const signature = `${key}::${value.toLowerCase()}`;
    const normalizedFact: GeneralExtractedFact = {
      ...fact,
      key,
      value,
      confidence: Math.max(0, Math.min(1, fact.confidence)),
    };
    const existing = merged.get(signature);
    if (!existing) {
      merged.set(signature, normalizedFact);
      continue;
    }

    const incomingTs = typeof normalizedFact.extractedAt === 'number' ? normalizedFact.extractedAt : 0;
    const existingTs = typeof existing.extractedAt === 'number' ? existing.extractedAt : 0;
    const incomingPreferred = normalizedFact.confidence > existing.confidence
      || (normalizedFact.confidence === existing.confidence && incomingTs > existingTs);
    const preferred = incomingPreferred ? normalizedFact : existing;
    const secondary = incomingPreferred ? existing : normalizedFact;

    merged.set(signature, {
      ...preferred,
      confidence: Math.max(preferred.confidence, secondary.confidence),
      sensitivity: mergeSensitivity(preferred.sensitivity, secondary.sensitivity),
      evidence: mergeEvidence(preferred.evidence, secondary.evidence),
      extractionMethod: 'general',
    });
  }

  return [...merged.values()].sort((a, b) => b.confidence - a.confidence);
}

export function extractSemanticFacts(records: GeneralExtractionRecord[]): SemanticExtractionResult {
  const candidateBuild = buildCandidateRecords(records);

  if (candidateBuild.records.length === 0) {
    return {
      facts: [],
      contracts: [],
      stats: {
        ...candidateBuild.stats,
        contractsAccepted: 0,
        contractsRejected: 0,
      },
    };
  }

  const extractors = new Map<GeneralExtractionRecord['sourceType'], SemanticExtractorEngine>();
  for (const record of candidateBuild.records) {
    const extractor = extractors.get(record.sourceType) ?? new SemanticExtractorEngine(record.sourceType);
    extractor.extractCandidate(record);
    extractors.set(record.sourceType, extractor);
  }

  const extracted = [...extractors.values()].flatMap((extractor) => extractor.getFactsWithEvidence());
  const contracts: SemanticExtractionContract[] = [];
  const semanticFacts: GeneralExtractedFact[] = [];
  let contractsRejected = 0;

  for (const fact of extracted) {
    const primaryEvidence = fact.evidence[0];
    const sourceId = primaryEvidence?.sourceId ?? `${fact.source}::sem:unknown`;
    const sourceName = primaryEvidence?.sourceName ?? fact.source;
    const sourceText = candidateBuild.sourceTextById.get(sourceId) ?? '';
    const evidenceSnippet = primaryEvidence?.snippet ?? fact.value;

    const contract = validateSemanticContract({
      domain: inferSemanticDomainFromKey(fact.key),
      canonical_key: normalizeFactKey(fact.key),
      dynamic_key: null,
      value: fact.value,
      temporal_status: 'current',
      is_negation: fact.negated === true,
      evidence_snippet: evidenceSnippet,
      confidence: fact.confidence,
      sensitivity: fact.sensitivity,
      source_id: sourceId,
      source_name: sourceName,
    }, sourceText);

    if (!contract || contract.temporal_status !== 'current') {
      contractsRejected += 1;
      continue;
    }

    contracts.push(contract);
    semanticFacts.push({
      ...fact,
      key: contract.canonical_key ?? contract.dynamic_key ?? fact.key,
      value: contract.value,
      confidence: contract.confidence,
      sensitivity: contract.sensitivity,
      source: contract.source_name,
      negated: contract.is_negation || undefined,
      extractionMethod: 'general',
    });
  }

  return {
    facts: dedupeSemanticFacts(semanticFacts),
    contracts,
    stats: {
      ...candidateBuild.stats,
      contractsAccepted: contracts.length,
      contractsRejected,
    },
  };
}

export function __semanticTestOnly() {
  return {
    splitIntoSentences,
    isSemanticCandidateSentence,
  };
}
