import { describe, expect, it } from 'vitest';
import type { Fact } from '../types';
import type { GeneralExtractedFact } from '../general-extractor';
import { gateGeneralFactsForReview, mergePendingFactReviews } from '../fact-review-gate';

function makeGeneralFact(overrides: Partial<GeneralExtractedFact>): GeneralExtractedFact {
  return {
    key: 'flight.seat_preference',
    value: 'window seat',
    confidence: 0.9,
    sensitivity: 'low',
    source: 'upload.txt',
    extractedAt: 100,
    extractionMethod: 'general',
    evidence: [
      {
        sourceId: 'upload.txt#1',
        sourceName: 'upload.txt',
        snippet: 'I always prefer a window seat on flights.',
        segmentIndex: 0,
      },
    ],
    ...overrides,
  };
}

describe('gateGeneralFactsForReview', () => {
  it('queues low-confidence general facts for manual review', () => {
    const result = gateGeneralFactsForReview({
      primaryFacts: [],
      generalFacts: [
        makeGeneralFact({
          key: 'food.favorite_cuisines',
          value: 'thai',
          confidence: 0.55,
        }),
      ],
      nowMs: 123,
    });

    expect(result.acceptedFacts).toHaveLength(0);
    expect(result.pendingReviews).toHaveLength(1);
    expect(result.pendingReviews[0].status).toBe('pending');
    expect(result.pendingReviews[0].fact.reviewStatus).toBe('pending');
  });

  it('accepts corroborated facts and boosts confidence floor', () => {
    const primary: Fact[] = [{
      key: 'flight.seat_preference',
      value: 'window seat',
      confidence: 0.71,
      sensitivity: 'low',
      source: 'gmail',
      extractedAt: 10,
    }];

    const result = gateGeneralFactsForReview({
      primaryFacts: primary,
      generalFacts: [makeGeneralFact({ confidence: 0.62 })],
      nowMs: 123,
    });

    expect(result.pendingReviews).toHaveLength(0);
    expect(result.acceptedFacts).toHaveLength(1);
    expect(result.acceptedFacts[0].confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('deduplicates pending reviews by key/value signature', () => {
    const incoming = gateGeneralFactsForReview({
      primaryFacts: [],
      generalFacts: [
        makeGeneralFact({ confidence: 0.6 }),
        makeGeneralFact({ confidence: 0.52, extractedAt: 200 }),
      ],
      nowMs: 500,
    }).pendingReviews;

    const merged = mergePendingFactReviews([], incoming);
    expect(merged).toHaveLength(1);
    expect(merged[0].fact.confidence).toBe(0.6);
  });

  it('always queues dynamic schema keys for manual review even when corroborated', () => {
    const dynamicFact = makeGeneralFact({
      key: 'dynamic.hobbies.photography',
      value: 'film photography',
      confidence: 0.95,
      sensitivity: 'low',
    });

    const primary: Fact[] = [{
      key: 'dynamic.hobbies.photography',
      value: 'film photography',
      confidence: 0.91,
      sensitivity: 'low',
      source: 'notion',
      extractedAt: 42,
    }];

    const result = gateGeneralFactsForReview({
      primaryFacts: primary,
      generalFacts: [dynamicFact],
      nowMs: 321,
    });

    expect(result.acceptedFacts).toHaveLength(0);
    expect(result.pendingReviews).toHaveLength(1);
    expect(result.pendingReviews[0].reason.toLowerCase()).toContain('dynamic schema');
    expect(result.pendingReviews[0].fact.sensitivity).toBe('high');
  });
});
