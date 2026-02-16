import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Mail, Star, Send, File, Pencil, Inbox } from 'lucide-react';
import '../browse/browser-themes.css';
import { ExtractionHighlight } from '../../components/ExtractionHighlight';
import type { ExtractionMatch } from '../../components/ExtractionHighlight';
import type { GmailEmail } from '../../lib/gmail-extractor';
import { loadCanonicalSourceDataset } from '../../lib/canonical-package-lineage';
import {
  extractFilteredMailboxInsights,
  extractSelectedEmailInsights,
  MailboxExtractionCancelledError,
} from './gmail-scope-extraction';
import {
  buildGmailGeneralRecords,
  extractBrowseFactsFromRecords,
} from './record-fact-extraction';
import { FactsSidebar } from './FactsSidebar';
import { SearchInput } from './SearchInput';

// ── Category detection from sender domain ─────────────────────────────────

const CATEGORY_DOMAINS: Record<string, string[]> = {
  shopping: ['amazon.com', 'target.com', 'walmart.com', 'bestbuy.com', 'nordstrom.com',
    'nike.com', 'adidas.com', 'uniqlo.com', 'patagonia.com', 'everlane.com', 'rei.com',
    'apple.com', 'bonobos.com', 'jcrew.com', 'gap.com', 'allbirds.com'],
  travel: ['united.com', 'delta.com', 'aa.com', 'southwest.com', 'marriott.com',
    'hilton.com', 'airbnb.com', 'booking.com', 'expedia.com', 'kayak.com'],
  food: ['doordash.com', 'ubereats.com', 'grubhub.com', 'opentable.com', 'yelp.com',
    'toasttab.com', 'resy.com'],
  fitness: ['myfitnesspal.com', 'strava.com', 'peloton.com', 'equinox.com',
    'orangetheory.com', 'classpass.com'],
  finance: ['chase.com', 'bankofamerica.com', 'wellsfargo.com', 'citi.com',
    'americanexpress.com', 'capitalone.com', 'fidelity.com', 'venmo.com', 'paypal.com'],
  social: ['instagram.com', 'facebook.com', 'twitter.com', 'linkedin.com', 'tiktok.com'],
  subscriptions: ['netflix.com', 'spotify.com', 'nytimes.com', 'hulu.com', 'hbomax.com',
    'audible.com', 'youtube.com', 'adobe.com', 'figma.com'],
};

function detectCategory(from: string): string {
  const domainMatch = from.match(/@([a-zA-Z0-9.-]+)/);
  if (!domainMatch) return 'other';
  const domain = domainMatch[1].toLowerCase();

  for (const [category, domains] of Object.entries(CATEGORY_DOMAINS)) {
    if (domains.some(d => domain.endsWith(d))) return category;
  }

  // Heuristic: work emails (not from known services)
  if (domain.includes('company.com') || domain.includes('corp.') || domain.includes('work.')) {
    return 'work';
  }

  return 'other';
}

const CATEGORY_TAGS = ['all', 'shopping', 'travel', 'food', 'fitness', 'finance', 'social', 'subscriptions', 'work', 'other'];

// ── Row height for virtual scrolling ─────────────────────────────────────
const ROW_HEIGHT = 40;

// ── Helper to extract sender name ────────────────────────────────────────
function senderName(from: string): string {
  // "John Doe <john@example.com>" -> "John Doe"
  const match = from.match(/^([^<]+)</);
  if (match) return match[1].trim();
  // "john@example.com" -> "john"
  const atMatch = from.match(/^([^@]+)@/);
  if (atMatch) return atMatch[1].replace(/[._]/g, ' ');
  return from;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  if (diffDays < 7) {
    return d.toLocaleDateString(undefined, { weekday: 'short' });
  }
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ── Avatar color from sender name ─────────────────────────────────────────
const AVATAR_COLORS = [
  '#1a73e8', '#e8710a', '#137333', '#a142f4', '#e52592',
  '#129eaf', '#d93025', '#9334e6', '#1967d2', '#e37400',
];

function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

// ── Main Component ───────────────────────────────────────────────────────

interface GmailBrowserProps {
  persona: string;
  className?: string;
}

type ExtractionScope = 'selected' | 'filtered';
type FilteredMailboxRunState = 'idle' | 'running' | 'complete' | 'cancelled' | 'error';

export function GmailBrowser({ persona, className }: GmailBrowserProps) {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [factsOpen, setFactsOpen] = useState(true);
  const [showOnlyWithFacts, setShowOnlyWithFacts] = useState(false);
  const [extractionScope, setExtractionScope] = useState<ExtractionScope>('selected');
  const [filteredMailboxFacts, setFilteredMailboxFacts] = useState<Array<{ key: string; value: string; confidence: number; category: string }>>([]);
  const [filteredMailboxRunState, setFilteredMailboxRunState] = useState<FilteredMailboxRunState>('idle');
  const [filteredMailboxProcessed, setFilteredMailboxProcessed] = useState(0);
  const [filteredMailboxError, setFilteredMailboxError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const filteredMailboxAbortRef = useRef<AbortController | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(600);

  // Lazy-load persona data on demand
  const [emails, setEmails] = useState<GmailEmail[]>([]);
  const [loading, setLoading] = useState(true);
  // Reset loading state synchronously when persona changes
  const [prevPersona, setPrevPersona] = useState(persona);
  if (persona !== prevPersona) { setPrevPersona(persona); setLoading(true); }
  useEffect(() => {
    let cancelled = false;
    loadCanonicalSourceDataset<GmailEmail>('gmail', persona)
      .then(data => { if (!cancelled) setEmails(data); })
      .catch(err => { if (!cancelled) { console.error('Failed to load data:', err); setEmails([]); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [persona]);

  // Categorize emails
  const categorizedEmails = useMemo(() => {
    return emails.map(e => ({ ...e, _category: detectCategory(e.from) }));
  }, [emails]);

  // Pre-compute extraction match counts for all emails (list indicators + sorting)
  const emailFactCounts = useMemo(() => {
    const counts = new Map<string, number>();
    if (emails.length === 0) return counts;
    for (const email of emails) {
      const facts = extractBrowseFactsFromRecords(buildGmailGeneralRecords([email]));
      counts.set(email.id, facts.length);
    }
    return counts;
  }, [emails]);

  // Filter and sort
  const filtered = useMemo(() => {
    let result = categorizedEmails;

    if (categoryFilter !== 'all') {
      result = result.filter(e => e._category === categoryFilter);
    }

    if (showOnlyWithFacts) {
      result = result.filter(e => (emailFactCounts.get(e.id) ?? 0) > 0);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(e =>
        e.subject.toLowerCase().includes(q) ||
        e.from.toLowerCase().includes(q) ||
        e.body.toLowerCase().includes(q)
      );
    }

    // Sort: emails with extracted facts first, then by date
    return [...result].sort((a, b) => {
      const aHas = (emailFactCounts.get(a.id) ?? 0) > 0 ? 1 : 0;
      const bHas = (emailFactCounts.get(b.id) ?? 0) > 0 ? 1 : 0;
      if (aHas !== bHas) return bHas - aHas;
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    });
  }, [categorizedEmails, categoryFilter, search, showOnlyWithFacts, emailFactCounts]);

  // Derive effective selected ID: use selectedId if it's in the filtered list, otherwise use first
  const effectiveSelectedId = useMemo(() => {
    if (selectedId && filtered.some(e => e.id === selectedId)) return selectedId;
    return filtered.length > 0 ? filtered[0].id : null;
  }, [filtered, selectedId]);

  const selectedEmail = useMemo(
    () => filtered.find(e => e.id === effectiveSelectedId) ?? null,
    [filtered, effectiveSelectedId]
  );

  const selectedExtractionResults = useMemo(() => {
    return extractSelectedEmailInsights(selectedEmail);
  }, [selectedEmail]);

  const activeFacts = extractionScope === 'selected'
    ? selectedExtractionResults.facts
    : filteredMailboxFacts;
  const activeMatches: ExtractionMatch[] = selectedExtractionResults.matches;

  const filteredSignature = useMemo(
    () => filtered.map((email) => email.id).join('|'),
    [filtered],
  );

  useEffect(() => {
    if (filteredMailboxAbortRef.current) {
      filteredMailboxAbortRef.current.abort();
      filteredMailboxAbortRef.current = null;
    }
    setFilteredMailboxFacts([]);
    setFilteredMailboxRunState('idle');
    setFilteredMailboxProcessed(0);
    setFilteredMailboxError(null);
  }, [filteredSignature]);

  useEffect(() => {
    return () => {
      if (filteredMailboxAbortRef.current) {
        filteredMailboxAbortRef.current.abort();
      }
    };
  }, []);

  const runFilteredMailboxExtraction = useCallback(async () => {
    if (filteredMailboxRunState === 'running') return;
    const controller = new AbortController();
    filteredMailboxAbortRef.current = controller;
    setFilteredMailboxRunState('running');
    setFilteredMailboxProcessed(0);
    setFilteredMailboxError(null);
    setFilteredMailboxFacts([]);

    try {
      const result = await extractFilteredMailboxInsights(filtered, {
        chunkSize: 20,
        signal: controller.signal,
        onProgress: ({ processed }) => {
          setFilteredMailboxProcessed(processed);
        },
      });
      if (controller.signal.aborted) return;
      setFilteredMailboxFacts(result.facts);
      setFilteredMailboxProcessed(filtered.length);
      setFilteredMailboxRunState('complete');
    } catch (error) {
      if (error instanceof MailboxExtractionCancelledError) {
        setFilteredMailboxRunState('cancelled');
        return;
      }

      setFilteredMailboxRunState('error');
      setFilteredMailboxError(error instanceof Error ? error.message : String(error));
    } finally {
      if (filteredMailboxAbortRef.current === controller) {
        filteredMailboxAbortRef.current = null;
      }
    }
  }, [filtered, filteredMailboxRunState]);

  const cancelFilteredMailboxExtraction = useCallback(() => {
    if (!filteredMailboxAbortRef.current) return;
    filteredMailboxAbortRef.current.abort();
    filteredMailboxAbortRef.current = null;
    setFilteredMailboxRunState('cancelled');
  }, []);

  const scopedRecordCount = extractionScope === 'selected'
    ? selectedExtractionResults.processedEmailIds.length
    : filteredMailboxProcessed;
  const scopedTotalCount = extractionScope === 'selected' ? 1 : filtered.length;

  const filteredMailboxStatusText = useMemo(() => {
    if (filtered.length === 0) return 'No emails in current filter';
    if (filteredMailboxRunState === 'running') {
      return `Processing ${filteredMailboxProcessed}/${filtered.length} emails...`;
    }
    if (filteredMailboxRunState === 'complete') {
      return `Processed ${filteredMailboxProcessed} emails`;
    }
    if (filteredMailboxRunState === 'cancelled') {
      return 'Extraction cancelled';
    }
    if (filteredMailboxRunState === 'error') {
      return filteredMailboxError ?? 'Extraction failed';
    }
    return 'Run filtered mailbox extraction';
  }, [filtered, filteredMailboxError, filteredMailboxProcessed, filteredMailboxRunState]);

  // Track container height via effect (avoid reading ref during render)
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerHeight(entry.contentRect.height);
      }
    });
    observer.observe(el);
    setContainerHeight(el.clientHeight);
    return () => observer.disconnect();
  }, []);

  // Virtual scrolling
  const totalHeight = filtered.length * ROW_HEIGHT;
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 2);
  const endIndex = Math.min(
    filtered.length,
    Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT) + 2
  );
  const visibleRows = filtered.slice(startIndex, endIndex);

  const handleScroll = useCallback(() => {
    if (listRef.current) {
      setScrollTop(listRef.current.scrollTop);
    }
  }, []);

  if (loading) {
    return (
      <div className={className ?? "flex items-center justify-center h-[calc(100vh-280px)] min-h-[500px] mt-4 bg-white rounded-lg border border-[#e0e0e0]"}>
        <p className="text-[#5f6368] text-sm">Loading emails...</p>
      </div>
    );
  }

  const sender = selectedEmail ? senderName(selectedEmail.from) : '';
  const senderInitial = sender.charAt(0).toUpperCase();
  const senderColor = sender ? avatarColor(sender) : '#1a73e8';

  return (
    <div className={className ? `gmail-browser bg-white rounded-lg overflow-hidden border border-[#e0e0e0] flex ${className}` : "gmail-browser bg-white rounded-lg overflow-hidden border border-[#e0e0e0] h-[calc(100vh-280px)] min-h-[500px] mt-4 flex"}>
      {/* LEFT NAV: Icon-only sidebar */}
      <div className="w-[60px] bg-[#f6f8fc] flex-shrink-0 border-r border-[#e0e0e0] flex flex-col items-center">
        {/* Compose FAB */}
        <button className="w-14 h-14 bg-[#c2e7ff] rounded-2xl mx-auto mt-3 mb-4 flex items-center justify-center hover:shadow-md transition-shadow shadow-sm">
          <Pencil className="w-5 h-5 text-[#001d35]" />
        </button>

        {/* Nav icons */}
        <div className="flex flex-col items-center gap-1">
          <button className="bg-[#d3e3fd] text-[#001d35] rounded-2xl p-2" title="Inbox">
            <Inbox className="w-5 h-5" />
          </button>
          <button className="text-[#5f6368] p-2 hover:bg-[#e8eaed] rounded-2xl transition-colors" title="Starred">
            <Star className="w-5 h-5" />
          </button>
          <button className="text-[#5f6368] p-2 hover:bg-[#e8eaed] rounded-2xl transition-colors" title="Sent">
            <Send className="w-5 h-5" />
          </button>
          <button className="text-[#5f6368] p-2 hover:bg-[#e8eaed] rounded-2xl transition-colors" title="Drafts">
            <File className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* MIDDLE: Email list */}
      <div className="w-[320px] flex-shrink-0 flex flex-col border-r border-[#e0e0e0] bg-white">
        {/* Search */}
        <div className="p-3 border-b border-[#e8eaed]">
          <SearchInput value={search} onChange={setSearch} placeholder="Search emails..." theme="gmail" />
        </div>

        {/* Category filter chips */}
        <div className="px-3 py-2 border-b border-[#e8eaed] flex flex-wrap gap-1.5">
          {CATEGORY_TAGS.map(cat => (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                categoryFilter === cat
                  ? 'bg-[#d3e3fd] text-[#001d35]'
                  : 'bg-[#f0f0f0] text-[#5f6368] hover:bg-[#e8eaed]'
              }`}
            >
              {cat === 'all' ? 'All' : cat.charAt(0).toUpperCase() + cat.slice(1)}
            </button>
          ))}
          <button
            onClick={() => setShowOnlyWithFacts(v => !v)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-all ml-1 border ${
              showOnlyWithFacts
                ? 'bg-[#e6f4ea] text-[#137333] border-[#137333]/30'
                : 'bg-white text-[#5f6368] border-[#dadce0] hover:bg-[#f0f0f0]'
            }`}
          >
            ● Has insights
          </button>
        </div>

        {/* Email count + scope indicator */}
        <div className="px-3 py-2 border-b border-[#e8eaed] text-[11px] text-[#5f6368]">
          <div className="flex items-center justify-between">
            <span>
              {filtered.length} email{filtered.length !== 1 ? 's' : ''}
              {!showOnlyWithFacts && (
                <span className="text-[#137333] ml-1">
                  · {filtered.filter(e => (emailFactCounts.get(e.id) ?? 0) > 0).length} with insights
                </span>
              )}
            </span>
            {search.trim() && categoryFilter !== 'all' && (
              <button
                onClick={() => setCategoryFilter('all')}
                className="text-[#1a73e8] hover:underline"
              >
                Search all categories
              </button>
            )}
          </div>

          <div className="flex items-center gap-1 mt-2">
            <button
              onClick={() => setExtractionScope('selected')}
              className={`px-2 py-0.5 rounded-full border text-[10px] font-medium transition-colors ${
                extractionScope === 'selected'
                  ? 'bg-[#d3e3fd] text-[#001d35] border-[#9fc3ff]'
                  : 'bg-white text-[#5f6368] border-[#dadce0] hover:bg-[#f0f0f0]'
              }`}
            >
              Selected Email
            </button>
            <button
              onClick={() => setExtractionScope('filtered')}
              className={`px-2 py-0.5 rounded-full border text-[10px] font-medium transition-colors ${
                extractionScope === 'filtered'
                  ? 'bg-[#d3e3fd] text-[#001d35] border-[#9fc3ff]'
                  : 'bg-white text-[#5f6368] border-[#dadce0] hover:bg-[#f0f0f0]'
              }`}
            >
              Filtered Mailbox
            </button>
            <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full border border-[#dadce0] bg-white">
              Scope: {scopedRecordCount}/{scopedTotalCount} records
            </span>
          </div>

          {extractionScope === 'filtered' && (
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className={`text-[10px] ${
                filteredMailboxRunState === 'error'
                  ? 'text-[#d93025]'
                  : filteredMailboxRunState === 'complete'
                  ? 'text-[#137333]'
                  : 'text-[#5f6368]'
              }`}>
                {filteredMailboxStatusText}
              </span>
              <div className="flex items-center gap-1">
                {filteredMailboxRunState === 'running' && (
                  <button
                    onClick={cancelFilteredMailboxExtraction}
                    className="px-2 py-0.5 rounded-md border border-[#dadce0] text-[#5f6368] hover:bg-[#f0f0f0]"
                  >
                    Cancel
                  </button>
                )}
                <button
                  onClick={runFilteredMailboxExtraction}
                  disabled={filteredMailboxRunState === 'running' || filtered.length === 0}
                  className="px-2 py-0.5 rounded-md bg-[#1a73e8] text-white disabled:bg-[#9aa0a6] disabled:cursor-not-allowed"
                >
                  {filteredMailboxRunState === 'running' ? 'Running...' : 'Run'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Virtual scrolled email list */}
        <div
          ref={listRef}
          className="flex-1 overflow-y-auto"
          onScroll={handleScroll}
        >
          <div style={{ height: totalHeight, position: 'relative' }}>
            {visibleRows.map((email, i) => {
              const idx = startIndex + i;
              const isSelected = email.id === effectiveSelectedId;
              const isStarred = email.labels?.includes('starred') || idx % 5 === 0; // visual variety
              const isUnread = idx % 3 === 0; // visual variety for unread appearance
              const factCount = emailFactCounts.get(email.id) ?? 0;

              return (
                <button
                  key={email.id}
                  onClick={() => setSelectedId(email.id)}
                  className={`absolute left-0 right-0 flex items-center gap-0 px-1 text-left transition-colors border-b border-[#e8eaed] ${
                    isSelected
                      ? 'bg-[#e8f0fe]'
                      : 'hover:bg-[#f2f2f2]'
                  }`}
                  style={{
                    top: idx * ROW_HEIGHT,
                    height: ROW_HEIGHT,
                  }}
                >
                  {/* Fact count indicator */}
                  <div className="w-7 flex-shrink-0 flex items-center justify-center" title={`${factCount} extracted insight${factCount !== 1 ? 's' : ''}`}>
                    {factCount > 0 ? (
                      <span className={`min-w-[16px] h-[14px] px-[3px] rounded-full text-[9px] font-bold flex items-center justify-center ${
                        factCount >= 4 ? 'bg-[#137333] text-white' :
                        factCount >= 2 ? 'bg-[#34a853] text-white' :
                        'bg-[#e6f4ea] text-[#137333]'
                      }`}>
                        {factCount}
                      </span>
                    ) : (
                      <span className="w-[6px] h-[6px] rounded-full bg-[#dadce0]" />
                    )}
                  </div>
                  {/* Star */}
                  <div className="w-6 flex-shrink-0 flex items-center justify-center">
                    <Star className={`w-[14px] h-[14px] ${isStarred ? 'text-[#f4b400] fill-[#f4b400]' : 'text-[#c4c7c5]'}`} />
                  </div>
                  {/* Sender */}
                  <span className={`w-[140px] flex-shrink-0 text-[12px] truncate pr-1 ${
                    isUnread ? 'font-medium text-[#202124]' : 'text-[#5f6368]'
                  }`}>
                    {senderName(email.from)}
                  </span>
                  {/* Subject + snippet */}
                  <span className="flex-1 min-w-0 text-[12px] truncate">
                    <span className={`${isUnread ? 'text-[#202124] font-medium' : 'text-[#202124]'}`}>
                      {email.subject}
                    </span>
                    <span className="text-[#5f6368]">
                      {' \u2014 '}{email.body.slice(0, 60).replace(/\n/g, ' ')}
                    </span>
                  </span>
                  {/* Date */}
                  <span className="text-[#5f6368] text-xs flex-shrink-0 ml-2 pr-2">
                    {formatDate(email.date)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* RIGHT: Email detail + extractions */}
      <div className="flex-1 flex flex-col overflow-hidden bg-white">
        {selectedEmail ? (
          <>
            {/* Email header */}
            <div className="p-4 border-b border-[#e8eaed]">
              <h2 className="text-[#202124] text-xl font-normal mb-3">
                {selectedEmail.subject}
              </h2>
              <div className="flex items-center gap-3">
                {/* Sender avatar */}
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-medium flex-shrink-0"
                  style={{ backgroundColor: senderColor }}
                >
                  {senderInitial}
                </div>
                <div className="min-w-0">
                  <div className="text-[#202124] text-sm font-medium">
                    {sender}
                  </div>
                  <div className="text-[#5f6368] text-sm truncate">
                    to me &middot; {new Date(selectedEmail.date).toLocaleDateString(undefined, {
                      weekday: 'short',
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </div>
                </div>
              </div>
              {selectedEmail.labels.length > 0 && (
                <div className="flex items-center gap-1 mt-2 ml-[52px]">
                  {selectedEmail.labels.map(label => (
                    <span key={label} className="text-[10px] px-2 py-0.5 bg-transparent border border-[#dadce0] rounded-sm text-[#5f6368]">
                      {label}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Email body + extraction sidebar */}
            <div className="flex-1 flex overflow-hidden">
              {/* Body */}
              <div className="flex-1 p-6 overflow-y-auto">
                <div className="text-[#202124] text-[15px] leading-relaxed whitespace-pre-wrap">
                  <ExtractionHighlight
                    text={selectedEmail.body}
                    matches={activeMatches}
                    showTooltips
                    theme="light"
                  />
                </div>
              </div>

              {/* Extracted facts sidebar */}
              <FactsSidebar
                facts={activeFacts}
                isOpen={factsOpen}
                onToggle={() => setFactsOpen(!factsOpen)}
                theme="light"
              />
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <Mail className="w-12 h-12 mx-auto mb-3 text-[#5f6368] opacity-30" />
              <p className="text-sm text-[#5f6368]">Select an email to view details</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
