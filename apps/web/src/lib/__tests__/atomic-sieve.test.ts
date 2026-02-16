import { describe, expect, it } from 'vitest';
import type { GeneralExtractionRecord } from '../general-extractor';
import { runAtomicSieve } from '../atomic-sieve';

const RECORDS: GeneralExtractionRecord[] = [
  {
    sourceType: 'amazon',
    sourceId: 'amz-1',
    sourceName: 'Amazon: Orders',
    content: [
      'Your order has shipped. Tracking number 12345.',
      'Subtotal $45.99. Sales tax $2.13.',
      'I always buy fragrance-free detergent and prefer unscented soap.',
      'Unsubscribe from these emails.',
    ].join(' '),
  },
];

describe('atomic sieve', () => {
  it('drops transactional noise while retaining stable preference evidence', () => {
    const result = runAtomicSieve(RECORDS);

    expect(result.stats.sentencesDroppedNoise).toBeGreaterThan(0);
    expect(result.stats.sentencesRetained).toBeGreaterThan(0);
    expect(result.chunks.length).toBeGreaterThan(0);

    const combined = result.chunks.map((chunk) => chunk.text).join(' ');
    expect(combined.toLowerCase()).toContain('prefer unscented soap');
    expect(combined.toLowerCase()).not.toContain('unsubscribe');
  });

  it('supports configurable chunk and window sizes', () => {
    const richRecord: GeneralExtractionRecord = {
      sourceType: 'gmail',
      sourceId: 'g-1',
      sourceName: 'Gmail: Travel',
      content: [
        'I prefer aisle seats on flights.',
        'I usually avoid red-eye departures.',
        'I like boutique hotels near downtown.',
        'I always pack carry-on only.',
        'I prefer direct flights when possible.',
      ].join(' '),
    };

    const result = runAtomicSieve([richRecord], {
      maxSentencesPerChunk: 2,
      minSentencesPerChunk: 1,
      windowSize: 2,
      windowStride: 1,
    });

    expect(result.chunks.length).toBeGreaterThanOrEqual(3);
    expect(result.windows.length).toBeGreaterThanOrEqual(2);
    expect(result.chunks.every((chunk) => chunk.sentenceCount <= 2)).toBe(true);
    expect(result.windows.every((window) => window.chunkIds.length <= 2)).toBe(true);
  });

  it('includes sentence-level metadata for evidence traceability', () => {
    const result = runAtomicSieve([
      {
        sourceType: 'chatgpt',
        sourceId: 'c-1',
        sourceName: 'ChatGPT: Notes',
        content: 'I prefer slim fit chinos. I usually buy navy and gray.',
      },
    ], {
      maxSentencesPerChunk: 2,
      minSentencesPerChunk: 1,
    });

    expect(result.chunks.length).toBe(1);
    const chunk = result.chunks[0];
    expect(chunk.sentences).toHaveLength(2);
    expect(chunk.sentences[0].charStart).toBeGreaterThanOrEqual(0);
    expect(chunk.sentences[0].charEnd).toBeGreaterThan(chunk.sentences[0].charStart);
    expect(chunk.sentenceStartIndex).toBe(0);
    expect(chunk.sentenceEndIndex).toBe(1);
  });

  it('enforces global sentence budget to keep memory growth bounded', () => {
    const generated = Array.from({ length: 120 }, (_unused, index) =>
      `I prefer option ${index + 1} for daily routines.`,
    ).join(' ');

    const result = runAtomicSieve([
      {
        sourceType: 'notion',
        sourceId: 'n-1',
        sourceName: 'Notion: Long Page',
        content: generated,
      },
    ], {
      maxSentencesTotal: 30,
      maxSentencesPerRecord: 120,
      maxSentencesPerChunk: 5,
      minSentencesPerChunk: 1,
    });

    expect(result.stats.sentencesRetained).toBeLessThanOrEqual(30);
    expect(result.stats.truncatedByBudget).toBe(true);
    expect(result.chunks.length).toBeGreaterThan(0);
  });
});
