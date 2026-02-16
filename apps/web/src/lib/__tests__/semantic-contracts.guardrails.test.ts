import { describe, expect, it } from 'vitest';
import type { GeneralExtractionRecord } from '../general-extractor';
import { applySemanticJsonGuardrails } from '../semantic-json-guardrails';

const RECORDS: GeneralExtractionRecord[] = [
  {
    sourceType: 'gmail',
    sourceId: 's1',
    sourceName: 'Record One',
    content: 'I always choose aisle seats for long flights and prefer nonstop routes.',
  },
  {
    sourceType: 'gmail',
    sourceId: 's2',
    sourceName: 'Record Two',
    content: 'I avoid red-eye flights because they wreck my sleep schedule.',
  },
];

describe('semantic JSON guardrails', () => {
  it('accepts valid current contracts with source evidence', () => {
    const result = applySemanticJsonGuardrails({
      records: RECORDS,
      contracts: [
        {
          domain: 'travel',
          canonical_key: 'flight.seat_preference',
          dynamic_key: null,
          value: 'aisle',
          temporal_status: 'current',
          is_negation: false,
          evidence_snippet: 'choose aisle seats',
          confidence: 0.82,
          sensitivity: 'low',
          source_id: 's1',
          source_name: 'Record One',
        },
      ],
    });

    expect(result.rejectedContracts).toBe(0);
    expect(result.contracts).toHaveLength(1);
    expect(result.facts).toHaveLength(1);
    expect(result.facts[0].key).toBe('flight.seat_preference');
  });

  it('rejects contracts with evidence not present in source', () => {
    const result = applySemanticJsonGuardrails({
      records: RECORDS,
      contracts: [
        {
          domain: 'travel',
          canonical_key: 'flight.seat_preference',
          dynamic_key: null,
          value: 'window',
          temporal_status: 'current',
          is_negation: false,
          evidence_snippet: 'always choose window seats',
          confidence: 0.9,
          sensitivity: 'low',
          source_id: 's1',
          source_name: 'Record One',
        },
      ],
    });

    expect(result.contracts).toHaveLength(0);
    expect(result.facts).toHaveLength(0);
    expect(result.rejectedContracts).toBe(1);
  });

  it('rejects non-current temporal contracts', () => {
    const result = applySemanticJsonGuardrails({
      records: RECORDS,
      contracts: [
        {
          domain: 'travel',
          canonical_key: 'flight.seat_preference',
          dynamic_key: null,
          value: 'window',
          temporal_status: 'past',
          is_negation: false,
          evidence_snippet: 'choose aisle seats',
          confidence: 0.7,
          sensitivity: 'low',
          source_id: 's1',
          source_name: 'Record One',
        },
      ],
    });

    expect(result.contracts).toHaveLength(0);
    expect(result.rejectedContracts).toBe(1);
  });

  it('deduplicates facts from duplicate accepted contracts', () => {
    const result = applySemanticJsonGuardrails({
      records: RECORDS,
      contracts: [
        {
          domain: 'travel',
          canonical_key: 'flight.seat_preference',
          dynamic_key: null,
          value: 'aisle',
          temporal_status: 'current',
          is_negation: false,
          evidence_snippet: 'choose aisle seats',
          confidence: 0.7,
          sensitivity: 'low',
          source_id: 's1',
          source_name: 'Record One',
        },
        {
          domain: 'travel',
          canonical_key: 'flight.seat_preference',
          dynamic_key: null,
          value: 'aisle',
          temporal_status: 'current',
          is_negation: false,
          evidence_snippet: 'choose aisle seats',
          confidence: 0.9,
          sensitivity: 'low',
          source_id: 's1',
          source_name: 'Record One',
        },
      ],
    });

    expect(result.contracts).toHaveLength(2);
    expect(result.facts).toHaveLength(1);
    expect(result.facts[0].confidence).toBe(0.9);
  });
});
