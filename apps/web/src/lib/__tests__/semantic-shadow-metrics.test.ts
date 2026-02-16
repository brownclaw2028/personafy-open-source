import { describe, expect, it } from 'vitest';
import { computeSemanticShadowMetrics } from '../semantic-shadow-metrics';

describe('semantic shadow metrics', () => {
  it('computes overlap and proxy precision/recall metrics', () => {
    const baseline = [
      { key: 'flight.seat_preference', value: 'window seat' },
      { key: 'apparel.shoe.size', value: '10' },
      { key: 'dietary.restrictions', value: 'vegetarian' },
    ];
    const semantic = [
      { key: 'flight.seat_preference', value: 'window seat' },
      { key: 'apparel.shoe.size', value: '10' },
      { key: 'dynamic.hobbies.photography', value: 'film photography' },
    ];

    const metrics = computeSemanticShadowMetrics(baseline, semantic);
    expect(metrics.overlapCount).toBe(2);
    expect(metrics.semanticOnlyCount).toBe(1);
    expect(metrics.baselineOnlyCount).toBe(1);
    expect(metrics.precisionProxy).toBeCloseTo(2 / 3, 5);
    expect(metrics.recallProxy).toBeCloseTo(2 / 3, 5);
    expect(metrics.f1Proxy).toBeCloseTo(2 / 3, 5);
  });

  it('handles empty semantic set without divide-by-zero', () => {
    const metrics = computeSemanticShadowMetrics(
      [{ key: 'food.favorite_cuisines', value: 'thai' }],
      [],
    );

    expect(metrics.baselineCount).toBe(1);
    expect(metrics.semanticCount).toBe(0);
    expect(metrics.overlapCount).toBe(0);
    expect(metrics.precisionProxy).toBe(0);
    expect(metrics.recallProxy).toBe(0);
    expect(metrics.f1Proxy).toBe(0);
  });
});
