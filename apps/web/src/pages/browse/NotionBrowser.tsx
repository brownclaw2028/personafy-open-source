import React, { useState, useMemo, useEffect } from 'react';
import '../browse/browser-themes.css';
import { FileText, ChevronRight } from 'lucide-react';
import { ExtractionHighlight } from '../../components/ExtractionHighlight';
import type { ExtractionMatch } from '../../components/ExtractionHighlight';
import type { NotionPage } from '../../lib/notion-extractor';
import { loadCanonicalSourceDataset } from '../../lib/canonical-package-lineage';
import { FactsSidebar } from './FactsSidebar';
import { SearchInput } from './SearchInput';
import {
  buildNotionGeneralRecords,
  extractBrowseFactsFromRecords,
} from './record-fact-extraction';

// Extend NotionPage with optional icon field present in demo data
interface NotionPageWithIcon extends NotionPage {
  icon?: string;
}

// -- Extraction patterns for content ------------------------------------------

const CONTENT_PATTERNS: Array<{ regex: RegExp; factKey: string; category: string; confidence: number }> = [
  { regex: /\b(running|marathon|trail|hiking|climbing|yoga|meditation|pilates)\b/gi, factKey: 'fitness.activity', category: 'Fitness', confidence: 0.75 },
  { regex: /\b(plant-based|vegan|vegetarian|pescatarian)\b/gi, factKey: 'dietary.preference', category: 'Food & Dining', confidence: 0.85 },
  { regex: /\b(Hoka|Nike|Adidas|Allbirds|Patagonia|lululemon)\b/gi, factKey: 'apparel.brand', category: 'Shopping', confidence: 0.8 },
  { regex: /\bsize\s+(\d+(?:\.\d)?)\b/gi, factKey: 'apparel.size', category: 'Shopping', confidence: 0.85 },
  { regex: /\b(Strava|Headspace|Calm|MyFitnessPal)\b/gi, factKey: 'apps.preferred', category: 'Fitness', confidence: 0.8 },
  { regex: /\b(San Francisco|SF|Marin|Big Sur|Tokyo|Kyoto|NYC|Chicago|Portland|Seattle)\b/gi, factKey: 'location.mentioned', category: 'Travel', confidence: 0.7 },
  { regex: /\b(TypeScript|React|Python|VS Code|Figma|Linear)\b/gi, factKey: 'work.tools', category: 'Work', confidence: 0.75 },
  { regex: /\b(minimalist|Japanese style|Muji|Sonos|Philips Hue)\b/gi, factKey: 'home.style', category: 'Home & Living', confidence: 0.7 },
  { regex: /\b(Spotify|Netflix|Audible|Kindle)\b/gi, factKey: 'entertainment.service', category: 'Entertainment', confidence: 0.75 },
  { regex: /\b(coffee|espresso|pour.over|light roast|oat milk)\b/gi, factKey: 'food.coffee', category: 'Food & Dining', confidence: 0.7 },
  { regex: /\b(vitamin D|B12|creatine|omega|supplement)\b/gi, factKey: 'health.supplements', category: 'Health & Wellness', confidence: 0.75 },
  { regex: /\b(Airbnb|boutique hotel|mid-range)\b/gi, factKey: 'travel.accommodation', category: 'Travel', confidence: 0.7 },
];

function extractContentMatches(text: string): ExtractionMatch[] {
  const matches: ExtractionMatch[] = [];
  for (const pattern of CONTENT_PATTERNS) {
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        factKey: pattern.factKey,
        category: pattern.category,
        confidence: pattern.confidence,
      });
    }
  }
  return matches;
}

// -- Simple markdown renderer -------------------------------------------------

interface RenderedLine {
  type: 'h2' | 'h3' | 'li' | 'p' | 'blank';
  text: string;
  offset: number; // character offset in original content
}

function parseContent(content: string): RenderedLine[] {
  const lines = content.split('\n');
  const result: RenderedLine[] = [];
  let offset = 0;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === '') {
      result.push({ type: 'blank', text: '', offset });
    } else if (trimmed.startsWith('### ')) {
      result.push({ type: 'h3', text: trimmed.slice(4), offset: offset + line.indexOf('### ') + 4 });
    } else if (trimmed.startsWith('## ')) {
      result.push({ type: 'h2', text: trimmed.slice(3), offset: offset + line.indexOf('## ') + 3 });
    } else if (trimmed.startsWith('- ')) {
      result.push({ type: 'li', text: trimmed.slice(2), offset: offset + line.indexOf('- ') + 2 });
    } else {
      result.push({ type: 'p', text: trimmed, offset: offset + (line.length - trimmed.length) });
    }

    offset += line.length + 1; // +1 for the \n
  }

  return result;
}

const RenderLine = React.memo(function RenderLine({ line, matches }: { line: RenderedLine; matches: ExtractionMatch[] }) {
  const highlighted = matches.length > 0 ? (
    <ExtractionHighlight text={line.text} matches={matches} showTooltips theme="light" />
  ) : (
    <span>{line.text}</span>
  );

  switch (line.type) {
    case 'h2':
      return <h2 className="text-2xl font-semibold text-[#37352f] border-b border-[#edece9] pb-1 mt-8 mb-3">{highlighted}</h2>;
    case 'h3':
      return <h3 className="text-xl font-semibold text-[#37352f] mt-6 mb-2">{highlighted}</h3>;
    case 'li':
      return (
        <div className="flex items-start gap-2 ml-1 my-0.5">
          <span className="text-[#37352f] mt-[7px] text-[6px] flex-shrink-0">&#x25CF;</span>
          <span className="text-base text-[#37352f] leading-[1.6]">{highlighted}</span>
        </div>
      );
    case 'p':
      return <p className="text-base text-[#37352f] leading-[1.6] my-1">{highlighted}</p>;
    case 'blank':
      return <div className="h-3" />;
    default:
      return null;
  }
});

// -- Helpers ------------------------------------------------------------------

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// -- Main Component -----------------------------------------------------------

interface NotionBrowserProps {
  persona: string;
  className?: string;
}

export function NotionBrowser({ persona, className }: NotionBrowserProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [factsOpen, setFactsOpen] = useState(true);

  // Lazy-load persona data on demand
  const [pages, setPages] = useState<NotionPageWithIcon[]>([]);
  const [loading, setLoading] = useState(true);
  const [prevPersona, setPrevPersona] = useState(persona);
  if (persona !== prevPersona) { setPrevPersona(persona); setLoading(true); }
  useEffect(() => {
    let cancelled = false;
    loadCanonicalSourceDataset<NotionPageWithIcon>('notion', persona)
      .then(data => { if (!cancelled) setPages(data); })
      .catch(err => { if (!cancelled) { console.error('Failed to load data:', err); setPages([]); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [persona]);

  // Extract unique categories from properties
  const categories = useMemo(() => {
    const cats = new Set<string>();
    for (const page of pages) {
      const cat = page.properties?.Category;
      if (cat) cats.add(cat);
    }
    return ['all', ...Array.from(cats).sort()];
  }, [pages]);

  // Filter pages
  const filtered = useMemo(() => {
    let result = pages;

    if (categoryFilter !== 'all') {
      result = result.filter(p => p.properties?.Category === categoryFilter);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(p =>
        p.title.toLowerCase().includes(q) ||
        p.content.toLowerCase().includes(q)
      );
    }

    // Sort by last edited, newest first
    return [...result].sort((a, b) =>
      new Date(b.last_edited_time ?? '').getTime() - new Date(a.last_edited_time ?? '').getTime()
    );
  }, [pages, categoryFilter, searchQuery]);

  // Clamp selection to valid range
  const safeSelectedIndex = filtered.length > 0 ? Math.min(selectedIndex, filtered.length - 1) : 0;
  const selectedPage = filtered[safeSelectedIndex] ?? null;

  // Parse content into renderable lines
  const parsedContent = useMemo(() => {
    if (!selectedPage) return [];
    return parseContent(selectedPage.content);
  }, [selectedPage]);

  // Run extraction on selected page for facts sidebar
  const extractionResults = useMemo(() => {
    if (!selectedPage) return { facts: [] as Array<{ key: string; value: string; confidence: number; category: string }> };
    const facts = extractBrowseFactsFromRecords(buildNotionGeneralRecords(selectedPage));
    return { facts };
  }, [selectedPage]);

  // Pre-compute extraction matches per line, filtered against sidebar facts
  const lineMatches = useMemo(() => {
    return parsedContent.map(line => {
      const rawMatches = extractContentMatches(line.text);
      return rawMatches.filter(m => {
        const matchedText = line.text.slice(m.start, m.end).toLowerCase();
        return extractionResults.facts.some(f =>
          f.value.toLowerCase().includes(matchedText) ||
          matchedText.includes(f.value.toLowerCase())
        );
      });
    });
  }, [parsedContent, extractionResults.facts]);

  if (loading) {
    return (
      <div className={className ? `notion-browser bg-white rounded-lg overflow-hidden border border-[#e9e9e7] flex items-center justify-center ${className}` : "notion-browser bg-white rounded-lg overflow-hidden border border-[#e9e9e7] flex items-center justify-center h-[calc(100vh-280px)] min-h-[500px] mt-4"}>
        <p className="text-[#9b9a97] text-sm">Loading pages...</p>
      </div>
    );
  }

  return (
    <div className={className ? `notion-browser bg-white rounded-lg overflow-hidden border border-[#e9e9e7] flex ${className}` : "notion-browser bg-white rounded-lg overflow-hidden border border-[#e9e9e7] flex h-[calc(100vh-280px)] min-h-[500px] mt-4"}>
      {/* LEFT: Sidebar */}
      <div className="w-[260px] flex-shrink-0 flex flex-col bg-[#f7f6f3] border-r border-[#e9e9e7]">
        {/* Workspace name */}
        <div className="text-[#37352f] text-sm font-semibold px-3 py-3">
          Workspace
        </div>
        <div className="border-b border-[#e9e9e7]" />

        {/* Search */}
        <div className="p-3 border-b border-[#e9e9e7]">
          <SearchInput value={searchQuery} onChange={setSearchQuery} placeholder="Search pages..." theme="notion" />
        </div>

        {/* Category filter chips */}
        <div className="px-3 py-2 border-b border-[#e9e9e7] flex flex-wrap gap-1.5">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
                categoryFilter === cat
                  ? 'bg-[#e6e6e4] text-[#37352f]'
                  : 'bg-transparent text-[#9b9a97] hover:bg-[#efefef]'
              }`}
            >
              {cat === 'all' ? 'All' : cat}
            </button>
          ))}
        </div>

        {/* Count */}
        <div className="px-3 py-1.5 border-b border-[#e9e9e7] text-[11px] text-[#9b9a97]">
          {filtered.length} page{filtered.length !== 1 ? 's' : ''}
        </div>

        {/* Page list */}
        <div className="flex-1 overflow-y-auto">
          {filtered.map((page, i) => {
            const isSelected = i === safeSelectedIndex;

            return (
              <button
                key={page.id}
                onClick={() => setSelectedIndex(i)}
                className={`w-full text-left px-3 py-2.5 transition-colors ${
                  isSelected
                    ? 'bg-[#ebebea]'
                    : 'hover:bg-[#f7f7f5]'
                }`}
              >
                <div className="flex items-center gap-2 mb-0.5">
                  {page.icon && (
                    <span className="text-base flex-shrink-0">{page.icon}</span>
                  )}
                  <span className="text-[#37352f] text-sm truncate">
                    {page.title}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-[#9b9a97] text-xs pl-7">
                  {page.properties?.Category && (
                    <span>{page.properties.Category}</span>
                  )}
                  {page.properties?.Category && (
                    <span className="w-1 h-1 rounded-full bg-[#9b9a97]/40" />
                  )}
                  <span>{formatDate(page.last_edited_time ?? '')}</span>
                </div>
              </button>
            );
          })}

          {filtered.length === 0 && (
            <div className="px-3 py-8 text-center text-[#9b9a97] text-sm">
              No pages match your search
            </div>
          )}
        </div>
      </div>

      {/* RIGHT: Page detail */}
      <div className="flex-1 flex flex-col overflow-hidden bg-white">
        {selectedPage ? (
          <>
            {/* Breadcrumb nav */}
            <div className="text-[#9b9a97] text-xs px-12 pt-4">
              <span>Workspace</span>
              {selectedPage.properties?.Category && (
                <>
                  <ChevronRight className="w-3 h-3 mx-1 inline text-[#9b9a97]" />
                  <span>{selectedPage.properties.Category}</span>
                </>
              )}
              <ChevronRight className="w-3 h-3 mx-1 inline text-[#9b9a97]" />
              <span className="text-[#37352f]">{selectedPage.title}</span>
            </div>

            {/* Large emoji icon */}
            {selectedPage.icon && (
              <div className="px-12 pt-2">
                <span className="text-[78px] leading-none">{selectedPage.icon}</span>
              </div>
            )}

            {/* Large page title */}
            <h2 className="text-[40px] font-bold text-[#37352f] px-12 pb-2 tracking-tight">
              {selectedPage.title}
            </h2>

            {/* Properties as inline pills */}
            {selectedPage.properties && Object.keys(selectedPage.properties).length > 0 && (
              <div className="flex flex-wrap gap-2 px-12 mb-2">
                {Object.entries(selectedPage.properties).map(([key, value]) => (
                  <span
                    key={key}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-[#f1f1ef] rounded text-xs"
                  >
                    <span className="text-[#9b9a97]">{key}:</span>
                    <span className="text-[#37352f]">{value}</span>
                  </span>
                ))}
              </div>
            )}

            {/* Tags */}
            {selectedPage.tags && selectedPage.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 px-12 mb-2">
                {selectedPage.tags.map(tag => (
                  <span key={tag} className="px-2 py-0.5 bg-[#f0f0ef] text-[#37352f] border border-[#e3e2e0] rounded text-[10px]">
                    {tag}
                  </span>
                ))}
              </div>
            )}

            {/* Metadata dates */}
            <div className="flex items-center gap-4 text-xs text-[#9b9a97] px-12 mb-4">
              <span>Created: {formatDate(selectedPage.created_time ?? '')}</span>
              <span>Edited: {formatDate(selectedPage.last_edited_time ?? '')}</span>
              <span className="px-1.5 py-0.5 bg-[#f0f0ef] border border-[#e3e2e0] rounded text-[10px] text-[#37352f]">{selectedPage.type}</span>
            </div>

            {/* Content + facts sidebar */}
            <div className="flex-1 flex min-h-0 overflow-hidden">
              {/* Content area */}
              <div className="flex-1 overflow-y-auto px-12 max-w-[900px]">
                {parsedContent.map((line, i) => (
                  <RenderLine key={i} line={line} matches={lineMatches[i] ?? []} />
                ))}
              </div>

              {/* Extracted facts sidebar */}
              <FactsSidebar
                facts={extractionResults.facts}
                isOpen={factsOpen}
                onToggle={() => setFactsOpen(!factsOpen)}
                theme="light"
              />
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <FileText className="w-12 h-12 mx-auto mb-3 text-[#9b9a97] opacity-30" />
              <p className="text-[#9b9a97] text-sm">Select a page to view its content</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
