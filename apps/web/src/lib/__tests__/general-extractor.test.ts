import { describe, expect, it } from 'vitest';
import type { Fact } from '../types';
import { extractGeneralFacts, extractGeneralFactsWithEvidence, mergeFactCollections, type GeneralExtractionRecord } from '../general-extractor';

function byKey(facts: Fact[], key: string): Fact[] {
  return facts.filter((fact) => fact.key === key);
}

function makeFact(overrides: Partial<Fact>): Fact {
  return {
    key: 'apparel.shirt.size',
    value: 'M',
    confidence: 0.7,
    sensitivity: 'low',
    source: 'test',
    extractedAt: 1,
    ...overrides,
  };
}

describe('General extractor', () => {
  it('extracts stable preference statements', () => {
    const records: GeneralExtractionRecord[] = [
      {
        sourceType: 'chatgpt',
        sourceId: 'c1',
        sourceName: 'ChatGPT: test',
        content: 'I usually wear size 10 running shoes and I always pick a window seat.',
      },
    ];

    const facts = extractGeneralFacts(records);
    expect(byKey(facts, 'apparel.shoe.size').some((fact) => fact.value === '10')).toBe(true);
    expect(byKey(facts, 'flight.seat_preference').some((fact) => fact.value === 'window seat')).toBe(true);
  });

  it('captures evidence snippets for extracted general facts', () => {
    const records: GeneralExtractionRecord[] = [
      {
        sourceType: 'chatgpt',
        sourceId: 'c4',
        sourceName: 'ChatGPT: evidence',
        content: 'I always book a window seat and I usually stay at Marriott properties.',
      },
    ];

    const facts = extractGeneralFactsWithEvidence(records);
    const seat = facts.find((fact) => fact.key === 'flight.seat_preference');
    expect(seat).toBeDefined();
    expect(seat?.evidence.length).toBeGreaterThan(0);
  });

  it('ignores query/search style sentences', () => {
    const records: GeneralExtractionRecord[] = [
      {
        sourceType: 'chatgpt',
        sourceId: 'c2',
        sourceName: 'ChatGPT: search',
        content: 'Can you recommend the best running shoes size 10 for Tokyo?',
      },
    ];

    const facts = extractGeneralFacts(records);
    expect(facts).toHaveLength(0);
  });

  it('extracts from stable sentence while skipping adjacent query sentence', () => {
    const records: GeneralExtractionRecord[] = [
      {
        sourceType: 'claude',
        sourceId: 'c3',
        sourceName: 'Claude: mixed',
        content: 'Where can I find good ramen in Seattle? I am pescatarian and usually eat sushi.',
      },
    ];

    const facts = extractGeneralFacts(records);
    expect(byKey(facts, 'dietary.restrictions').some((fact) => fact.value === 'pescatarian')).toBe(true);
    expect(byKey(facts, 'food.favorite_cuisines').some((fact) => fact.value === 'sushi')).toBe(true);
    expect(byKey(facts, 'travel.favorite_destinations')).toHaveLength(0);
  });
});

describe('Fact collection merge', () => {
  it('deduplicates key/value and keeps stronger confidence and sensitivity', () => {
    const merged = mergeFactCollections(
      [
        makeFact({
          key: 'apparel.shirt.size',
          value: 'M',
          confidence: 0.55,
          sensitivity: 'low',
          extractedAt: 100,
        }),
      ],
      [
        makeFact({
          key: 'apparel.shirt.size',
          value: 'm',
          confidence: 0.9,
          sensitivity: 'medium',
          extractedAt: 200,
        }),
        makeFact({
          key: 'work.tools',
          value: 'notion',
          confidence: 0.8,
          sensitivity: 'low',
          extractedAt: 150,
        }),
      ],
    );

    const shirt = merged.find((fact) => fact.key === 'apparel.shirt.size' && fact.value.toLowerCase() === 'm');
    expect(shirt).toBeDefined();
    expect(shirt!.confidence).toBe(0.9);
    expect(shirt!.sensitivity).toBe('medium');
    expect(merged.some((fact) => fact.key === 'work.tools' && fact.value === 'notion')).toBe(true);
    expect(merged.filter((fact) => fact.key === 'apparel.shirt.size')).toHaveLength(1);
  });
});
