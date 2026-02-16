import { useId, useMemo } from 'react';
import { computeSparkline } from '../lib/sparkline';

interface SparklineProps {
  /** Array of numeric values to plot */
  data: number[];
  /** SVG width */
  width?: number;
  /** SVG height */
  height?: number;
  /** Stroke color (Tailwind classes won't work — use CSS color) */
  strokeColor?: string;
  /** Fill gradient start color */
  fillColorStart?: string;
  /** Fill gradient end color (usually transparent) */
  fillColorEnd?: string;
  /** Stroke width */
  strokeWidth?: number;
  /** Show dots on data points */
  showDots?: boolean;
  /** Accessible label */
  label?: string;
}

/**
 * Lightweight SVG sparkline — no charting library required.
 * Renders a smooth area chart with gradient fill.
 */
export function Sparkline({
  data,
  width = 200,
  height = 48,
  strokeColor = '#0172ED',
  fillColorStart = 'rgba(1, 114, 237, 0.3)',
  fillColorEnd = 'rgba(1, 114, 237, 0)',
  strokeWidth = 2,
  showDots = false,
  label = 'Activity sparkline',
}: SparklineProps) {
  const reactId = useId();
  const gradientId = `sparkline-grad-${reactId.replace(/:/g, '')}`;

  const { polyline, area, points, empty } = useMemo(
    () => computeSparkline(data, width, height, strokeWidth),
    [data, width, height, strokeWidth],
  );

  if (empty || data.length === 0) {
    return (
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="w-full" style={{ height }}>
        <text x={width / 2} y={height / 2} textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize={11}>
          No data
        </text>
      </svg>
    );
  }

  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="overflow-visible w-full" style={{ height }}>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={fillColorStart} />
          <stop offset="100%" stopColor={fillColorEnd} />
        </linearGradient>
      </defs>
      {/* Gradient fill area */}
      <path d={area} fill={`url(#${gradientId})`} />
      {/* Line */}
      <polyline
        points={polyline}
        fill="none"
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Optional dots */}
      {showDots &&
        points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={3} fill={strokeColor} stroke="#0D1117" strokeWidth={1.5} />
        ))}
      {/* Highlight last point */}
      {points.length > 0 && (
        <circle
          cx={points[points.length - 1].x}
          cy={points[points.length - 1].y}
          r={3.5}
          fill={strokeColor}
          stroke="#0D1117"
          strokeWidth={2}
        />
      )}
    </svg>
  );
}
