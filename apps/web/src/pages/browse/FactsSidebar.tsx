import { ChevronRight, ChevronDown, Sparkles } from 'lucide-react';
import { CATEGORY_HEX_COLORS } from '../../components/extraction-colors';
import { formatFactKey } from '../../lib/utils';

export interface Fact {
  key: string;
  value: string;
  confidence: number;
  category: string;
}

type FactsTheme = 'dark' | 'light' | 'warm' | 'chatgpt';

const THEME_STYLES: Record<FactsTheme, {
  border: string;
  hoverBg: string;
  headerText: string;
  headerBorder: string;
  chevron: string;
  factKey: string;
  factValue: string;
  confidence: string;
  itemBorder: string;
  countBadgeBg: string;
  countBadgeText: string;
}> = {
  dark: {
    border: 'border-card-border/50',
    hoverBg: 'hover:bg-white/10',
    headerText: 'text-text-secondary',
    headerBorder: 'border-card-border/35',
    chevron: 'text-text-tertiary',
    factKey: 'text-text-tertiary',
    factValue: 'text-white',
    confidence: 'text-text-tertiary',
    itemBorder: 'border-card-border/35',
    countBadgeBg: 'bg-primary/20',
    countBadgeText: 'text-primary',
  },
  light: {
    border: 'border-gray-200',
    hoverBg: 'hover:bg-gray-50',
    headerText: 'text-gray-600',
    headerBorder: 'border-gray-200',
    chevron: 'text-gray-400',
    factKey: 'text-gray-500',
    factValue: 'text-gray-900',
    confidence: 'text-gray-400',
    itemBorder: 'border-gray-100',
    countBadgeBg: 'bg-blue-100',
    countBadgeText: 'text-blue-700',
  },
  warm: {
    border: 'border-[#e0dcd4]',
    hoverBg: 'hover:bg-[#f0ece4]',
    headerText: 'text-[#5c5a56]',
    headerBorder: 'border-[#e0dcd4]',
    chevron: 'text-[#8a8784]',
    factKey: 'text-[#5c5a56]',
    factValue: 'text-[#2d2b28]',
    confidence: 'text-[#8a8784]',
    itemBorder: 'border-[#e8e4dc]',
    countBadgeBg: 'bg-[#d97706]/15',
    countBadgeText: 'text-[#d97706]',
  },
  chatgpt: {
    border: 'border-[rgba(255,255,255,0.1)]',
    hoverBg: 'hover:bg-white/10',
    headerText: 'text-[#b4b4b4]',
    headerBorder: 'border-[rgba(255,255,255,0.08)]',
    chevron: 'text-[#8e8ea0]',
    factKey: 'text-[#8e8ea0]',
    factValue: 'text-[#ececf1]',
    confidence: 'text-[#8e8ea0]',
    itemBorder: 'border-[rgba(255,255,255,0.05)]',
    countBadgeBg: 'bg-[#10a37f]/20',
    countBadgeText: 'text-[#10a37f]',
  },
};

function getCategoryColor(category: string): string {
  return CATEGORY_HEX_COLORS[category] ?? '#6b7280';
}

interface FactsSidebarProps {
  facts: Fact[];
  isOpen: boolean;
  onToggle: () => void;
  theme?: FactsTheme;
}

export function FactsSidebar({ facts, isOpen, onToggle, theme = 'dark' }: FactsSidebarProps) {
  if (facts.length === 0) {
    return (
      <div className={`border-l ${THEME_STYLES[theme].border} w-12 flex items-center justify-center`}>
        <Sparkles className={`w-3.5 h-3.5 ${THEME_STYLES[theme].chevron}`} />
      </div>
    );
  }

  const s = THEME_STYLES[theme];

  return (
    <div className={`border-l ${s.border} transition-all duration-200 ${isOpen ? 'w-[280px]' : 'w-12'}`}>
      <button
        onClick={onToggle}
        className={`w-full flex items-center justify-between px-3 py-2.5 ${s.hoverBg} transition-colors`}
        aria-label={isOpen ? 'Collapse extracted facts' : 'Expand extracted facts'}
      >
        {isOpen ? (
          <>
            <div className="flex items-center gap-2">
              <Sparkles className={`w-3.5 h-3.5 ${s.headerText}`} />
              <span className={`text-xs font-semibold ${s.headerText}`}>
                Extracted Facts
              </span>
              <span className={`text-[11px] ${s.countBadgeBg} ${s.countBadgeText} rounded-full px-2 py-0.5 font-medium`}>
                {facts.length}
              </span>
            </div>
            <ChevronRight className={`w-3.5 h-3.5 ${s.chevron}`} />
          </>
        ) : (
          <ChevronDown className={`w-4 h-4 ${s.chevron} mx-auto`} />
        )}
      </button>
      {isOpen && (
        <>
          <div className={`border-b ${s.headerBorder}`} />
          <div className="overflow-y-auto max-h-[calc(100%-44px)]">
            {facts.map((fact, i) => (
              <div
                key={`${fact.key}-${i}`}
                className={`px-4 py-3 border-b ${s.itemBorder} ${s.hoverBg} border-l-4`}
                style={{ borderLeftColor: getCategoryColor(fact.category) }}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className={`text-xs ${s.factKey}`}>
                    {formatFactKey(fact.key)}
                  </div>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                    (() => {
                      const isLight = theme === 'light' || theme === 'warm';
                      if (fact.confidence >= 0.8) return isLight ? 'bg-green-100 text-green-700' : 'bg-green-500/20 text-green-400';
                      if (fact.confidence >= 0.6) return isLight ? 'bg-yellow-100 text-yellow-700' : 'bg-yellow-500/20 text-yellow-400';
                      return isLight ? 'bg-gray-100 text-gray-500' : 'bg-gray-500/20 text-gray-400';
                    })()
                  }`}>
                    {Math.round(fact.confidence * 100)}%
                  </span>
                </div>
                <div className={`text-sm font-medium ${s.factValue}`}>
                  {fact.value}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
