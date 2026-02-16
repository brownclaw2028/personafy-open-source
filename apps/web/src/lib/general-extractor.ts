import { BaseExtractor } from './base-extractor';
import { normalizeFactKey } from './factKeys';
import type { Fact } from './types';

type ExtractorSourceType = 'chatgpt' | 'gmail' | 'amazon' | 'claude' | 'notion' | 'gemini' | 'calendar';

const QUERY_INTENT_PATTERN =
  /\b(how do i|where can i|what should i|what is|can you|could you|recommend|suggest|looking for|search(?:ing)? for|find me|help me|tips for|best .* for|which one|should i)\b/i;
const PERSONAL_CONTEXT_PATTERN = /\b(i|i'm|i am|i've|ive|my|we|our)\b/i;
const STABLE_PREFERENCE_PATTERN =
  /\b(prefer|love|like|hate|avoid|always|usually|typically|wear|use|own|book|fly|run|eat|drink|shop|track|subscribe|allergic)\b/i;

const SENSITIVITY_RANK: Record<Fact['sensitivity'], number> = {
  low: 0,
  medium: 1,
  high: 2,
};

export interface GeneralExtractionRecord {
  sourceType: ExtractorSourceType;
  sourceId: string;
  sourceName: string;
  content: string;
}

export interface GeneralFactEvidence {
  sourceId: string;
  sourceName: string;
  snippet: string;
  segmentIndex: number;
}

export interface GeneralExtractedFact extends Fact {
  extractionMethod: 'general';
  evidence: GeneralFactEvidence[];
  requiresConfirmation?: boolean;
  reviewStatus?: 'accepted' | 'pending' | 'rejected';
}

function splitIntoSegments(content: string): string[] {
  return content
    .split(/[\r\n]+|(?<=[.!?])\s+/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length >= 12);
}

function isLikelyStablePreference(segment: string): boolean {
  if (segment.includes('?')) return false;
  if (QUERY_INTENT_PATTERN.test(segment)) return false;
  if (!PERSONAL_CONTEXT_PATTERN.test(segment)) return false;
  return STABLE_PREFERENCE_PATTERN.test(segment);
}

function factSignatureFromKeyValue(key: string, value: string): string {
  return `${normalizeFactKey(key)}::${value.trim().toLowerCase()}`;
}

function factSignature(fact: Fact): string {
  return factSignatureFromKeyValue(fact.key, fact.value);
}

function mergeSensitivity(current: Fact['sensitivity'], incoming: Fact['sensitivity']): Fact['sensitivity'] {
  return SENSITIVITY_RANK[incoming] > SENSITIVITY_RANK[current] ? incoming : current;
}

function normalizeSnippet(segment: string): string {
  const compact = segment.trim().replace(/\s+/g, ' ');
  if (compact.length <= 240) return compact;
  return `${compact.slice(0, 237).trim()}...`;
}

class GeneralExtractor extends BaseExtractor {
  private evidenceBySignature = new Map<string, GeneralFactEvidence[]>();

  constructor(sourceType: ExtractorSourceType) {
    super(sourceType);
  }

  protected initPatterns(): void {
    // General extractor is sentence-gated and reuses shared category methods.
  }

  extractRecord(record: GeneralExtractionRecord): void {
    const segments = splitIntoSegments(record.content);
    for (let i = 0; i < segments.length; i += 1) {
      const segment = segments[i];
      if (!isLikelyStablePreference(segment.toLowerCase())) continue;

      const before = this.snapshotFactConfidence();
      this.extractStableFacts(segment, record.sourceName, record.sourceId);
      this.captureEvidenceDelta(record, segment, i, before);
    }
  }

  private snapshotFactConfidence(): Map<string, number> {
    const snapshot = new Map<string, number>();
    for (const fact of this.extractedFacts) {
      snapshot.set(factSignature(fact), fact.confidence);
    }
    return snapshot;
  }

  private captureEvidenceDelta(
    record: GeneralExtractionRecord,
    segment: string,
    segmentIndex: number,
    previous: Map<string, number>,
  ): void {
    const snippet = normalizeSnippet(segment);
    for (const fact of this.extractedFacts) {
      const signature = factSignature(fact);
      const prevConfidence = previous.get(signature);
      const confidenceChanged = prevConfidence == null || fact.confidence > prevConfidence + 1e-6;
      if (!confidenceChanged) continue;

      const evidence = this.evidenceBySignature.get(signature) ?? [];
      const duplicate = evidence.some(
        (item) => item.sourceId === record.sourceId && item.segmentIndex === segmentIndex && item.snippet === snippet,
      );
      if (duplicate) continue;
      if (evidence.length >= 6) continue;

      evidence.push({
        sourceId: record.sourceId,
        sourceName: record.sourceName,
        snippet,
        segmentIndex,
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

    // Shared extraction helpers set metadata when available; keep sourceId
    // explicit so callers can reason about origin in evidence downstream.
    void sourceId;
  }

  getAllFactsWithEvidence(): GeneralExtractedFact[] {
    this.organizeExtractedFacts();
    return this.extractedFacts.map((fact) => ({
      ...fact,
      extractionMethod: 'general',
      evidence: this.evidenceBySignature.get(factSignature(fact)) ?? [],
    }));
  }

  public override getAllFacts(): Fact[] {
    return this.getAllFactsWithEvidence() as Fact[];
  }
}

export function mergeFactCollections(...collections: Fact[][]): Fact[] {
  const merged = new Map<string, Fact>();

  for (const collection of collections) {
    for (const rawFact of collection) {
      const normalizedFact: Fact = {
        ...rawFact,
        key: normalizeFactKey(rawFact.key),
        value: rawFact.value.trim(),
        confidence: Math.max(0, Math.min(1, rawFact.confidence)),
      };
      if (!normalizedFact.value) continue;

      const signature = factSignature(normalizedFact);
      const existing = merged.get(signature);
      if (!existing) {
        merged.set(signature, normalizedFact);
        continue;
      }

      const incomingTs = typeof normalizedFact.extractedAt === 'number' ? normalizedFact.extractedAt : 0;
      const existingTs = typeof existing.extractedAt === 'number' ? existing.extractedAt : 0;
      const incomingPreferred =
        normalizedFact.confidence > existing.confidence
        || (normalizedFact.confidence === existing.confidence && incomingTs > existingTs);
      const preferred = incomingPreferred ? normalizedFact : existing;
      const secondary = incomingPreferred ? existing : normalizedFact;

      merged.set(signature, {
        ...preferred,
        confidence: Math.max(existing.confidence, normalizedFact.confidence),
        sensitivity: mergeSensitivity(preferred.sensitivity, secondary.sensitivity),
      });
    }
  }

  return [...merged.values()].sort((a, b) => b.confidence - a.confidence);
}

export function extractGeneralFactsWithEvidence(records: GeneralExtractionRecord[]): GeneralExtractedFact[] {
  const extractors = new Map<ExtractorSourceType, GeneralExtractor>();

  for (const record of records) {
    if (!record.content || !record.content.trim()) continue;
    const extractor = extractors.get(record.sourceType) ?? new GeneralExtractor(record.sourceType);
    extractor.extractRecord(record);
    extractors.set(record.sourceType, extractor);
  }

  const collections = [...extractors.values()].map((extractor) => extractor.getAllFactsWithEvidence());
  return mergeFactCollections(...collections) as GeneralExtractedFact[];
}

export function extractGeneralFacts(records: GeneralExtractionRecord[]): Fact[] {
  return extractGeneralFactsWithEvidence(records) as Fact[];
}
