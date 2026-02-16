import { describe, expect, it } from 'vitest';
import type { GeneralExtractionRecord } from '../general-extractor';
import { __semanticTestOnly, extractSemanticFacts } from '../semantic-extractor';

describe('semantic extractor', () => {
  it('splits sentences and identifies semantic candidate statements', () => {
    const { splitIntoSentences, isSemanticCandidateSentence } = __semanticTestOnly();
    const segments = splitIntoSentences(
      'Can you recommend shoes? I always pick a window seat. My shoe size is 10.',
    );
    expect(segments.length).toBeGreaterThanOrEqual(2);
    expect(isSemanticCandidateSentence('Can you recommend shoes?')).toBe(false);
    expect(isSemanticCandidateSentence('I always pick a window seat.')).toBe(true);
  });

  it('extracts semantic facts from candidate windows', () => {
    const records: GeneralExtractionRecord[] = [
      {
        sourceType: 'chatgpt',
        sourceId: 'c1',
        sourceName: 'ChatGPT: semantic',
        content: 'Where can I find good flights? I always pick a window seat.',
      },
    ];

    const result = extractSemanticFacts(records);

    expect(result.stats.candidateWindows).toBeGreaterThan(0);
    expect(result.contracts.length).toBeGreaterThan(0);
    expect(
      result.facts.some((fact) => fact.key === 'flight.seat_preference' && fact.value === 'window seat'),
    ).toBe(true);
  });

  it('keeps neighboring context windows to recover adjacent preference details', () => {
    const records: GeneralExtractionRecord[] = [
      {
        sourceType: 'chatgpt',
        sourceId: 'c2',
        sourceName: 'ChatGPT: context window',
        content: 'I bought shoes. They are size 10 and fit perfectly.',
      },
    ];

    const result = extractSemanticFacts(records);
    expect(result.stats.candidateWindows).toBeGreaterThan(0);
    expect(result.facts.some((fact) => fact.key === 'apparel.shoe.size' && fact.value === '10')).toBe(true);
  });
});
