import { describe, it, expect } from 'vitest';
import { sanitizeData, computeSparkline } from '../sparkline';

// ─── sanitizeData ──────────────────────────────────────────────────────────

describe('sanitizeData', () => {
  it('passes through normal positive numbers', () => {
    expect(sanitizeData([1, 2, 3])).toEqual([1, 2, 3]);
  });

  it('clamps negative numbers to 0', () => {
    expect(sanitizeData([-5, 3, -1])).toEqual([0, 3, 0]);
  });

  it('replaces NaN with 0', () => {
    expect(sanitizeData([NaN, 5, NaN])).toEqual([0, 5, 0]);
  });

  it('replaces Infinity with 0', () => {
    expect(sanitizeData([Infinity, 5, -Infinity])).toEqual([0, 5, 0]);
  });

  it('handles all-NaN array', () => {
    expect(sanitizeData([NaN, NaN, NaN])).toEqual([0, 0, 0]);
  });

  it('handles empty array', () => {
    expect(sanitizeData([])).toEqual([]);
  });

  it('preserves zero values', () => {
    expect(sanitizeData([0, 0, 5, 0])).toEqual([0, 0, 5, 0]);
  });

  it('preserves floating point values', () => {
    expect(sanitizeData([1.5, 2.7, 0.1])).toEqual([1.5, 2.7, 0.1]);
  });

  it('handles mixed invalid values', () => {
    expect(sanitizeData([NaN, Infinity, -Infinity, -3, 0, 7])).toEqual([0, 0, 0, 0, 0, 7]);
  });
});

// ─── computeSparkline — empty/degenerate cases ────────────────────────────

describe('computeSparkline — empty/degenerate', () => {
  const W = 200;
  const H = 48;
  const SW = 2;

  it('returns empty for empty array', () => {
    const result = computeSparkline([], W, H, SW);
    expect(result.empty).toBe(true);
    expect(result.polyline).toBe('');
    expect(result.area).toBe('');
    expect(result.points).toEqual([]);
  });

  it('returns empty for all-zero array', () => {
    const result = computeSparkline([0, 0, 0], W, H, SW);
    expect(result.empty).toBe(true);
    expect(result.polyline).toBe('');
    expect(result.area).toBe('');
    expect(result.points).toEqual([]);
  });

  it('returns empty for all-NaN array', () => {
    const result = computeSparkline([NaN, NaN, NaN], W, H, SW);
    expect(result.empty).toBe(true);
  });

  it('returns empty for all-negative array', () => {
    const result = computeSparkline([-5, -10, -3], W, H, SW);
    expect(result.empty).toBe(true);
  });

  it('returns empty for all-Infinity array', () => {
    const result = computeSparkline([Infinity, -Infinity, Infinity], W, H, SW);
    expect(result.empty).toBe(true);
  });

  it('returns empty for mixed all-invalid (NaN + negative + Infinity)', () => {
    const result = computeSparkline([NaN, -5, Infinity, -Infinity], W, H, SW);
    expect(result.empty).toBe(true);
  });
});

// ─── computeSparkline — single data point ─────────────────────────────────

describe('computeSparkline — single data point', () => {
  const W = 200;
  const H = 48;
  const SW = 2;

  it('renders single positive value at center X', () => {
    const result = computeSparkline([10], W, H, SW);
    expect(result.empty).toBe(false);
    expect(result.points).toHaveLength(1);
    // Single point should be centered horizontally
    const padding = SW + 2;
    const chartWidth = W - padding * 2;
    expect(result.points[0].x).toBe(padding + chartWidth / 2);
  });

  it('renders single value with correct Y (at top since it is the max)', () => {
    const result = computeSparkline([10], W, H, SW);
    const padding = SW + 2;
    // max = 10, v = 10, so y = padding + 0 = padding
    expect(result.points[0].y).toBe(padding);
  });

  it('polyline has one point', () => {
    const result = computeSparkline([5], W, H, SW);
    expect(result.polyline).not.toBe('');
    // One point → polyline is "x,y"
    expect(result.polyline.split(' ')).toHaveLength(1);
  });

  it('area path is valid (closes back to bottom)', () => {
    const result = computeSparkline([5], W, H, SW);
    expect(result.area).toContain('M ');
    expect(result.area).toContain('Z');
  });
});

// ─── computeSparkline — normal data ───────────────────────────────────────

describe('computeSparkline — normal data', () => {
  const W = 200;
  const H = 48;
  const SW = 2;
  const padding = SW + 2;

  it('produces correct number of points', () => {
    const result = computeSparkline([1, 2, 3, 4, 5], W, H, SW);
    expect(result.points).toHaveLength(5);
    expect(result.empty).toBe(false);
  });

  it('first point starts at left padding', () => {
    const result = computeSparkline([1, 2, 3], W, H, SW);
    expect(result.points[0].x).toBe(padding);
  });

  it('last point ends at right edge (width - padding)', () => {
    const result = computeSparkline([1, 2, 3], W, H, SW);
    expect(result.points[2].x).toBe(W - padding);
  });

  it('points are evenly spaced horizontally', () => {
    const result = computeSparkline([1, 2, 3, 4, 5], W, H, SW);
    const xs = result.points.map((p) => p.x);
    const gaps = xs.slice(1).map((x, i) => x - xs[i]);
    // All gaps should be equal
    const firstGap = gaps[0];
    gaps.forEach((gap) => {
      expect(gap).toBeCloseTo(firstGap, 10);
    });
  });

  it('max value has Y at top padding', () => {
    const result = computeSparkline([0, 5, 10, 5, 0], W, H, SW);
    // Value 10 is the max → y should be at padding
    expect(result.points[2].y).toBe(padding);
  });

  it('zero value has Y at bottom of chart area', () => {
    const result = computeSparkline([0, 5, 10, 5, 0], W, H, SW);
    const chartHeight = H - padding * 2;
    // Value 0 → y = padding + chartHeight
    expect(result.points[0].y).toBe(padding + chartHeight);
    expect(result.points[4].y).toBe(padding + chartHeight);
  });

  it('polyline contains all points', () => {
    const result = computeSparkline([3, 6, 9], W, H, SW);
    const segments = result.polyline.split(' ');
    expect(segments).toHaveLength(3);
  });

  it('area path starts with M, ends with Z', () => {
    const result = computeSparkline([3, 6, 9], W, H, SW);
    expect(result.area.startsWith('M ')).toBe(true);
    expect(result.area.endsWith('Z')).toBe(true);
  });

  it('equal values produce a flat line', () => {
    const result = computeSparkline([5, 5, 5, 5], W, H, SW);
    // All Y values should be the same
    const ys = result.points.map((p) => p.y);
    const uniqueYs = [...new Set(ys)];
    expect(uniqueYs).toHaveLength(1);
  });
});

// ─── computeSparkline — partial invalid data ──────────────────────────────

describe('computeSparkline — partial invalid data', () => {
  const W = 200;
  const H = 48;
  const SW = 2;

  it('NaN values treated as zero among valid values', () => {
    const result = computeSparkline([NaN, 5, NaN], W, H, SW);
    expect(result.empty).toBe(false);
    expect(result.points).toHaveLength(3);
    // Middle point (value 5) should be at top
    const padding = SW + 2;
    expect(result.points[1].y).toBe(padding);
  });

  it('negative values treated as zero among valid values', () => {
    const result = computeSparkline([-10, 5, -20], W, H, SW);
    expect(result.empty).toBe(false);
    expect(result.points).toHaveLength(3);
  });

  it('Infinity treated as zero among valid values', () => {
    const result = computeSparkline([Infinity, 5, -Infinity], W, H, SW);
    expect(result.empty).toBe(false);
    expect(result.points).toHaveLength(3);
  });

  it('single valid value among invalid still renders', () => {
    const result = computeSparkline([NaN, NaN, 3, NaN], W, H, SW);
    expect(result.empty).toBe(false);
    expect(result.points).toHaveLength(4);
  });
});

// ─── computeSparkline — custom dimensions ─────────────────────────────────

describe('computeSparkline — custom dimensions', () => {
  it('works with very small dimensions', () => {
    const result = computeSparkline([1, 2, 3], 10, 10, 1);
    expect(result.empty).toBe(false);
    expect(result.points).toHaveLength(3);
    // All points should be within bounds
    result.points.forEach((p) => {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(10);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(10);
    });
  });

  it('works with large dimensions', () => {
    const result = computeSparkline([1, 2, 3], 1000, 500, 4);
    expect(result.empty).toBe(false);
    expect(result.points).toHaveLength(3);
  });

  it('zero strokeWidth still works', () => {
    const result = computeSparkline([1, 2, 3], 200, 48, 0);
    expect(result.empty).toBe(false);
    expect(result.points).toHaveLength(3);
  });

  it('padding cannot push chart to negative dimensions', () => {
    // Very large strokeWidth relative to dimensions
    const result = computeSparkline([1, 2, 3], 10, 10, 100);
    expect(result.empty).toBe(false);
    // chartWidth and chartHeight clamped to 0 via Math.max
    expect(result.points).toHaveLength(3);
  });
});

// ─── computeSparkline — two data points ───────────────────────────────────

describe('computeSparkline — two data points', () => {
  const W = 200;
  const H = 48;
  const SW = 2;
  const padding = SW + 2;

  it('two points span from left to right padding', () => {
    const result = computeSparkline([3, 7], W, H, SW);
    expect(result.points).toHaveLength(2);
    expect(result.points[0].x).toBe(padding);
    expect(result.points[1].x).toBe(W - padding);
  });

  it('ascending line: first point lower, second higher', () => {
    const result = computeSparkline([2, 10], W, H, SW);
    // Higher value → lower Y (SVG coordinates)
    expect(result.points[0].y).toBeGreaterThan(result.points[1].y);
  });

  it('descending line: first point higher, second lower', () => {
    const result = computeSparkline([10, 2], W, H, SW);
    expect(result.points[0].y).toBeLessThan(result.points[1].y);
  });
});

// ─── computeSparkline — large arrays ──────────────────────────────────────

describe('computeSparkline — large arrays', () => {
  it('handles 365 data points', () => {
    const data = Array.from({ length: 365 }, (_, i) => Math.sin(i / 10) * 50 + 50);
    const result = computeSparkline(data, 200, 48, 2);
    expect(result.empty).toBe(false);
    expect(result.points).toHaveLength(365);
  });

  it('handles 1000 data points', () => {
    const data = Array.from({ length: 1000 }, (_, i) => i % 100);
    const result = computeSparkline(data, 400, 100, 1);
    expect(result.empty).toBe(false);
    expect(result.points).toHaveLength(1000);
  });
});
