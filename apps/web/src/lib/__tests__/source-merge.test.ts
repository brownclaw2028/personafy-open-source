import { describe, expect, it } from 'vitest';
import type { Persona } from '../types';
import type { VaultPersona } from '../vault';
import { mergeImportedPersonas, parseExtractedAtMs } from '../source-merge';

describe('source-merge', () => {
  it('deduplicates legacy and canonical fact keys during merge', () => {
    const existing: VaultPersona[] = [
      {
        id: 'shopping',
        name: 'Shopping',
        category: 'Shopping',
        icon: 'ShoppingBag',
        description: 'Shopping persona',
        completionScore: 0.2,
        facts: [
          {
            key: 'shirt_size',
            value: 'medium',
            sensitivity: 'medium',
            confidence: 0.6,
            source: 'seed',
            extractedAt: 1000,
          },
        ],
      },
    ];

    const incoming: Persona[] = [
      {
        id: 'shopping',
        name: 'Shopping',
        category: 'Shopping',
        icon: 'ShoppingBag',
        description: 'Shopping persona',
        completionScore: 0.5,
        facts: [
          {
            key: 'apparel.shirt.size',
            value: 'M',
            sensitivity: 'medium',
            confidence: 0.9,
            source: 'Gmail: Order',
            extractedAt: 2000,
          },
        ],
      },
    ];

    const merged = mergeImportedPersonas(existing, incoming);
    const shopping = merged.find((persona) => persona.category === 'Shopping');
    expect(shopping).toBeTruthy();

    expect(shopping!.facts).toHaveLength(1);
    expect(shopping!.facts[0].key).toBe('apparel.shirt.size');
    expect(shopping!.facts[0].value).toBe('M');
    expect(shopping!.facts[0].confidence).toBe(0.9);
  });

  it('drops impossible shoe sizes and food-delivery clothing budget signals', () => {
    const incoming: Persona[] = [
      {
        id: 'shopping',
        name: 'Shopping',
        category: 'Shopping',
        icon: 'ShoppingBag',
        description: 'Shopping persona',
        completionScore: 0.4,
        facts: [
          {
            key: 'apparel.shoe.size',
            value: '32',
            sensitivity: 'medium',
            confidence: 0.9,
            source: 'Gmail: Random order',
            extractedAt: 1,
          },
          {
            key: 'apparel.shoe.size',
            value: '10.5',
            sensitivity: 'medium',
            confidence: 0.8,
            source: 'Gmail: Nike order',
            extractedAt: 2,
          },
          {
            key: 'budget.monthly_clothing',
            value: 'mid-range ($50-150 range)',
            sensitivity: 'medium',
            confidence: 0.5,
            source: 'Gmail: Your DoorDash order',
            extractedAt: 3,
          },
        ],
      },
    ];

    const merged = mergeImportedPersonas([], incoming);
    const shoppingFacts = merged[0].facts;

    expect(shoppingFacts.some((fact) => fact.key === 'apparel.shoe.size' && fact.value === '32')).toBe(false);
    expect(shoppingFacts.some((fact) => fact.key === 'apparel.shoe.size' && fact.value === '10.5')).toBe(true);
    expect(shoppingFacts.some((fact) => fact.key === 'budget.monthly_clothing')).toBe(false);
  });

  it('clamps confidence values to the [0, 1] range', () => {
    const incoming: Persona[] = [
      {
        id: 'shopping',
        name: 'Shopping',
        category: 'Shopping',
        icon: 'ShoppingBag',
        description: 'Shopping persona',
        completionScore: 0.1,
        facts: [
          {
            key: 'apparel.preferred_brands',
            value: 'Nike',
            sensitivity: 'low',
            confidence: 1.12,
            source: 'seed',
            extractedAt: 1,
          },
          {
            key: 'apparel.fit_preference',
            value: 'slim fit',
            sensitivity: 'low',
            confidence: -0.25,
            source: 'seed',
            extractedAt: 2,
          },
        ],
      },
    ];

    const merged = mergeImportedPersonas([], incoming);
    const byKey = new Map(merged[0].facts.map((fact) => [fact.key, fact]));

    expect(byKey.get('apparel.preferred_brands')?.confidence).toBe(1);
    expect(byKey.get('apparel.fit_preference')?.confidence).toBe(0);
  });

  it('preserves review metadata and evidence on merged facts', () => {
    const incoming = [{
      id: 'travel',
      name: 'Travel',
      category: 'Travel',
      icon: 'Plane',
      description: 'Travel persona',
      completionScore: 0.4,
      facts: [
        {
          key: 'flight.seat_preference',
          value: 'window seat',
          sensitivity: 'low',
          confidence: 0.84,
          source: 'Upload: travel-notes.txt',
          extractedAt: 1,
          extractionMethod: 'general',
          requiresConfirmation: false,
          reviewStatus: 'accepted',
          evidence: [{
            sourceId: 'travel-notes.txt#1',
            sourceName: 'travel-notes.txt',
            snippet: 'I always choose a window seat.',
            segmentIndex: 0,
          }],
        },
      ],
    }] as unknown as Persona[];

    const merged = mergeImportedPersonas([], incoming);
    const fact = merged[0].facts[0];

    expect(fact.extractionMethod).toBe('general');
    expect(fact.requiresConfirmation).toBe(false);
    expect(fact.reviewStatus).toBe('accepted');
    expect(fact.evidence?.[0].snippet).toContain('window seat');
  });

  it('parses extracted timestamps from numbers and ISO strings', () => {
    expect(parseExtractedAtMs(1700000000000)).toBe(1700000000000);
    expect(parseExtractedAtMs('2026-02-11T12:00:00.000Z')).toBe(Date.parse('2026-02-11T12:00:00.000Z'));
    expect(parseExtractedAtMs('')).toBeUndefined();
    expect(parseExtractedAtMs('not-a-date')).toBeUndefined();
  });
});
