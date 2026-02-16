import { useState } from 'react';
import { getColor, type HighlightTheme } from './extraction-colors';

export interface ExtractionMatch {
  start: number;
  end: number;
  factKey: string;
  category: string;
  confidence: number;
}

interface TooltipProps {
  factKey: string;
  confidence: number;
  category: string;
  theme: HighlightTheme;
}

function Tooltip({ factKey, confidence, category, theme }: TooltipProps) {
  const color = getColor(category, theme);
  const isLightTheme = theme === 'light' || theme === 'warm';

  return (
    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 pointer-events-none">
      <div className={`rounded-lg px-3 py-2 shadow-xl whitespace-nowrap text-xs ${
        isLightTheme
          ? 'bg-gray-900 border border-gray-800'
          : 'bg-card border border-card-border/50'
      }`}>
        <div className="flex items-center gap-2 mb-1">
          <span className={`inline-block w-2 h-2 rounded-full ${color.bg} ${color.border} border`} />
          <span className={`font-medium ${isLightTheme ? 'text-gray-300' : 'text-text-secondary'}`}>{category}</span>
        </div>
        <div className={`font-mono text-[11px] ${isLightTheme ? 'text-white' : 'text-white'}`}>{factKey}</div>
        <div className={`mt-0.5 ${isLightTheme ? 'text-gray-400' : 'text-text-tertiary'}`}>
          Confidence: {Math.round(confidence * 100)}%
        </div>
      </div>
      <div className={`w-2 h-2 rotate-45 absolute -bottom-1 left-1/2 -translate-x-1/2 ${
        isLightTheme
          ? 'bg-gray-900 border-b border-r border-gray-700'
          : 'bg-card border-b border-r border-card-border/50'
      }`} />
    </div>
  );
}

interface ExtractionHighlightProps {
  text: string;
  matches: ExtractionMatch[];
  showTooltips?: boolean;
  theme?: HighlightTheme;
}

export function ExtractionHighlight({
  text,
  matches,
  showTooltips = true,
  theme = 'dark',
}: ExtractionHighlightProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  if (matches.length === 0) {
    return <span>{text}</span>;
  }

  // Sort matches by start position and remove overlaps
  const sorted = [...matches].sort((a, b) => a.start - b.start);
  const nonOverlapping: ExtractionMatch[] = [];
  let lastEnd = 0;
  for (const m of sorted) {
    if (m.start >= lastEnd) {
      nonOverlapping.push(m);
      lastEnd = m.end;
    }
  }

  // Build segments
  const segments: Array<{ text: string; match?: ExtractionMatch; index?: number }> = [];
  let pos = 0;
  for (let i = 0; i < nonOverlapping.length; i++) {
    const m = nonOverlapping[i];
    if (pos < m.start) {
      segments.push({ text: text.slice(pos, m.start) });
    }
    segments.push({ text: text.slice(m.start, m.end), match: m, index: i });
    pos = m.end;
  }
  if (pos < text.length) {
    segments.push({ text: text.slice(pos) });
  }

  return (
    <span>
      {segments.map((seg, i) => {
        if (!seg.match) {
          return <span key={i}>{seg.text}</span>;
        }

        const color = getColor(seg.match.category, theme);
        const isHovered = hoveredIndex === seg.index;

        return (
          <span
            key={i}
            className={`relative inline cursor-default ${color.bg} ${color.border} border rounded px-1 py-0.5 transition-all duration-150 ${
              isHovered ? 'brightness-125' : ''
            }`}
            onMouseEnter={() => setHoveredIndex(seg.index ?? null)}
            onMouseLeave={() => setHoveredIndex(null)}
          >
            <span className={color.text}>{seg.text}</span>
            {showTooltips && isHovered && (
              <Tooltip
                factKey={seg.match.factKey}
                confidence={seg.match.confidence}
                category={seg.match.category}
                theme={theme}
              />
            )}
          </span>
        );
      })}
    </span>
  );
}
