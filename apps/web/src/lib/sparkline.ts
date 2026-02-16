/**
 * Pure computation logic for Sparkline SVG rendering.
 * Extracted for testability — no React, no DOM.
 */

export interface SparklinePoint {
  x: number;
  y: number;
}

export interface SparklineComputed {
  /** Polyline points string for SVG <polyline> */
  polyline: string;
  /** Area path string for SVG <path> (closed gradient fill) */
  area: string;
  /** Individual point coordinates */
  points: SparklinePoint[];
  /** True when there's nothing to render (empty or all-zero data) */
  empty: boolean;
}

/**
 * Sanitize raw data: keep finite numbers ≥ 0, replace everything else with 0.
 */
export function sanitizeData(data: number[]): number[] {
  return data.map((v) => (Number.isFinite(v) ? Math.max(v, 0) : 0));
}

/**
 * Compute SVG geometry for a sparkline chart.
 *
 * @param data        Raw numeric values (may contain NaN, Infinity, negatives)
 * @param width       SVG viewport width
 * @param height      SVG viewport height
 * @param strokeWidth Stroke width (affects padding)
 */
export function computeSparkline(
  data: number[],
  width: number,
  height: number,
  strokeWidth: number,
): SparklineComputed {
  const clean = sanitizeData(data);

  if (clean.length === 0) {
    return { polyline: '', area: '', points: [], empty: true };
  }

  if (clean.every((v) => v === 0)) {
    return { polyline: '', area: '', points: [], empty: true };
  }

  const max = Math.max(...clean, 1); // Avoid division by zero
  const padding = strokeWidth + 2;
  const chartWidth = Math.max(width - padding * 2, 0);
  const chartHeight = Math.max(height - padding * 2, 0);

  const pts = clean.map((v, i) => ({
    x: padding + (clean.length === 1 ? chartWidth / 2 : (i / (clean.length - 1)) * chartWidth),
    y: padding + chartHeight - (v / max) * chartHeight,
  }));

  const polyline = pts.map((p) => `${p.x},${p.y}`).join(' ');

  const area = [
    `M ${pts[0].x},${height - padding}`,
    `L ${pts[0].x},${pts[0].y}`,
    ...pts.slice(1).map((p) => `L ${p.x},${p.y}`),
    `L ${pts[pts.length - 1].x},${height - padding}`,
    'Z',
  ].join(' ');

  return { polyline, area, points: pts, empty: false };
}
