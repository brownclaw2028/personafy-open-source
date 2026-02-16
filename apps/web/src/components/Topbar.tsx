import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Search, Bell, Shield, X, User, Globe, FileText, Activity as ActivityIcon, Monitor, Upload } from 'lucide-react';
import { useVault } from '../lib/VaultProvider';
import { normalizeCompletionScore, formatPurposeDisplay } from '../lib/utils';

interface TopbarProps {
  userName?: string;
  userInitials?: string;
  onNavClick?: (itemId: string) => void;
}

/** A single search result with type + navigation target. */
interface SearchResult {
  type: 'persona' | 'fact' | 'rule' | 'device' | 'activity';
  label: string;
  sublabel: string;
  /** Path to navigate to (e.g. "personas/shopping") */
  navTarget: string;
  /** Optional badge text */
  badge?: string;
  badgeColor?: string;
  /** For fact results — sensitivity masking */
  masked?: boolean;
}

export function Topbar({ userName = 'User', userInitials = 'U', onNavClick }: TopbarProps) {
  const { vault, loading, locked, recentApprovalCount } = useVault();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchTriggerRef = useRef<HTMLButtonElement>(null);
  const searchDialogRef = useRef<HTMLDivElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const wasSearchOpenRef = useRef(false);

  // Debounce search query by 150ms before running the search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 150);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const postureLabels: Record<string, string> = {
    simple_lock: 'Relaxed',
    alarm_system: 'Balanced',
    safe_room: 'Strict',
  };
  const postureName = vault
    ? (postureLabels[vault.privacyPosture ?? ''] ?? vault.privacyPosture?.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) ?? 'Not Set')
    : locked ? 'Locked' : loading ? 'Loading...' : 'Protected';

  // Use centralized approval count from VaultProvider
  const recentActivityCount = recentApprovalCount;

  const postureColor =
    locked
      ? 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20'
      : vault?.privacyPosture === 'safe_room'
        ? 'text-red-400 bg-red-400/10 border-red-400/20'
        : vault?.privacyPosture === 'alarm_system'
          ? 'text-accent bg-accent/10 border-accent/20'
          : 'text-primary bg-primary/10 border-primary/20';

  // --- Build search results across all vault entities (debounced + early exit at 12) ---
  const MAX_RESULTS = 12;
  /** Match if query appears at a word boundary or start of string */
  const wordMatch = (text: string, q: string) => {
    if (text.startsWith(q)) return true;
    // Check word boundaries: after space, dot, underscore, slash
    const idx = text.indexOf(q);
    if (idx < 0) return false;
    if (idx === 0) return true;
    const prev = text[idx - 1];
    return prev === ' ' || prev === '.' || prev === '_' || prev === '/' || prev === '-';
  };
  const searchResults: SearchResult[] = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase();
    if (q.length < 2 || !vault) return [];

    const results: SearchResult[] = [];

    // 1. Persona name matches (word-boundary matching for better prefix search)
    for (const p of vault.personas ?? []) {
      if (results.length >= MAX_RESULTS) break;
      if (typeof p.name === 'string' && wordMatch(p.name.toLowerCase(), q)) {
        results.push({
          type: 'persona',
          label: p.name,
          sublabel: `${p.facts.length} facts · ${Math.round(normalizeCompletionScore(p.completionScore ?? 0) * 100)}% complete`,
          navTarget: `personas/${p.id}`,
          badge: p.category,
          badgeColor: 'bg-primary/10 text-primary',
        });
      }
    }

    // 2. Fact key/value matches (with persona context)
    outer2: for (const p of vault.personas ?? []) {
      for (const f of p.facts ?? []) {
        if (results.length >= MAX_RESULTS) break outer2;
        if (
          typeof f.key === 'string' &&
          typeof f.value === 'string' &&
          (wordMatch(f.key.toLowerCase(), q) || wordMatch(f.value.toLowerCase(), q))
        ) {
          const isHigh = f.sensitivity === 'high';
          results.push({
            type: 'fact',
            label: `${f.key}: ${isHigh ? '••••••' : f.value}`,
            sublabel: p.name,
            navTarget: `personas/${p.id}`,
            badge: f.sensitivity,
            badgeColor:
              f.sensitivity === 'high'
                ? 'bg-red-400/10 text-red-400'
                : f.sensitivity === 'medium'
                  ? 'bg-yellow-400/10 text-yellow-400'
                  : 'bg-accent/10 text-accent',
            masked: isHigh,
          });
        }
      }
    }

    // 3. Rule domain matches
    for (const r of vault.rules ?? []) {
      if (results.length >= MAX_RESULTS) break;
      if (typeof r.recipientDomain === 'string' && r.recipientDomain.toLowerCase().includes(q)) {
        results.push({
          type: 'rule',
          label: r.recipientDomain,
          sublabel: `${r.purposeCategory} → ${r.purposeAction.replace(/_/g, ' ')} · ${r.allowedFields.length} fields`,
          navTarget: 'rules',
          badge: r.enabled ? 'active' : 'disabled',
          badgeColor: r.enabled ? 'bg-accent/10 text-accent' : 'bg-white/10 text-text-tertiary',
        });
      }
    }

    // 4. Device name/type matches
    for (const d of vault.devices ?? []) {
      if (results.length >= MAX_RESULTS) break;
      if (typeof d.name === 'string' && typeof d.type === 'string') {
        if (d.name.toLowerCase().includes(q) || d.type.toLowerCase().includes(q)) {
          results.push({
            type: 'device',
            label: d.name,
            sublabel: `${d.type.charAt(0).toUpperCase()}${d.type.slice(1)} device · ${d.status}`,
            navTarget: 'devices',
            badge: d.status,
            badgeColor:
              d.status === 'connected'
                ? 'bg-accent/10 text-accent'
                : d.status === 'pairing'
                  ? 'bg-yellow-400/10 text-yellow-400'
                  : 'bg-white/10 text-text-tertiary',
          });
        }
      }
    }

    // 5. Audit event domain/purpose matches
    for (const e of vault.auditLog ?? []) {
      if (results.length >= MAX_RESULTS) break;
      if (typeof e.purpose !== 'string' || typeof e.recipientDomain !== 'string') continue;
      if (e.purpose.startsWith('rule_created')) continue;
      if (!Array.isArray(e.fieldsReleased)) continue;
      if (
        e.recipientDomain.toLowerCase().includes(q) ||
        e.purpose.toLowerCase().includes(q)
      ) {
        const label =
          e.decision === 'ask_approved' || e.decision === 'allow'
            ? 'approved'
            : 'denied';
        results.push({
          type: 'activity',
          label: e.recipientDomain,
          sublabel: `${formatPurposeDisplay(e.purpose)} · ${e.fieldsReleased.length} fields`,
          navTarget: 'approvals',
          badge: label,
          badgeColor:
            label === 'approved'
              ? 'bg-accent/10 text-accent'
              : 'bg-red-400/10 text-red-400',
        });
      }
    }

    return results;
  }, [debouncedQuery, vault]);

  // Group results by type for section headers (with stable global offsets for keyboard nav)
  const groupedResults = useMemo(() => {
    const groups: {
      type: SearchResult['type'];
      label: string;
      icon: typeof Search;
      results: SearchResult[];
      startIndex: number;
    }[] = [];
    const typeOrder: { type: SearchResult['type']; label: string; icon: typeof Search }[] = [
      { type: 'persona', label: 'Personas', icon: User },
      { type: 'fact', label: 'Facts', icon: FileText },
      { type: 'rule', label: 'Rules', icon: Globe },
      { type: 'device', label: 'Devices', icon: Monitor },
      { type: 'activity', label: 'Activity', icon: ActivityIcon },
    ];

    let offset = 0;
    for (const t of typeOrder) {
      const items = searchResults.filter((r) => r.type === t.type);
      if (items.length > 0) {
        groups.push({ ...t, results: items, startIndex: offset });
        offset += items.length;
      }
    }
    return groups;
  }, [searchResults]);

  // Flat list for keyboard navigation
  const flatResults = useMemo(() => groupedResults.flatMap((g) => g.results), [groupedResults]);

  const updateSearchQuery = (value: string) => {
    setSearchQuery(value);
    setActiveIndex(-1);
  };

  const navigateToResult = useCallback(
    (result: SearchResult) => {
      setSearchOpen(false);
      setSearchQuery('');
      setActiveIndex(-1);
      onNavClick?.(result.navTarget);
    },
    [onNavClick],
  );

  // Keyboard shortcut: Cmd+K or Ctrl+K to open search, Escape to close, arrows + enter for nav
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
      if (e.key === 'Escape' && searchOpen) {
        setSearchOpen(false);
        setSearchQuery('');
        setActiveIndex(-1);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [searchOpen]);

  // Arrow keys + Enter within the search dialog
  useEffect(() => {
    if (!searchOpen) return;

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (flatResults.length === 0) return;
        setActiveIndex((prev) => (prev < flatResults.length - 1 ? prev + 1 : 0));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (flatResults.length === 0) return;
        setActiveIndex((prev) => (prev > 0 ? prev - 1 : flatResults.length - 1));
      } else if (e.key === 'Enter' && activeIndex >= 0 && activeIndex < flatResults.length) {
        e.preventDefault();
        navigateToResult(flatResults[activeIndex]);
      }
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [searchOpen, flatResults, activeIndex, navigateToResult]);

  // Scroll active item into view
  useEffect(() => {
    if (activeIndex < 0 || !resultsRef.current) return;
    const items = resultsRef.current.querySelectorAll<HTMLElement>('[data-search-item]');
    items[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  // Focus management: auto-focus input when opened, restore to trigger when closed
  useEffect(() => {
    if (searchOpen) {
      requestAnimationFrame(() => searchInputRef.current?.focus());
    } else if (wasSearchOpenRef.current) {
      searchTriggerRef.current?.focus();
    }
    wasSearchOpenRef.current = searchOpen;
  }, [searchOpen]);

  // Focus trap within search dialog
  useEffect(() => {
    if (!searchOpen) return;
    const dialog = searchDialogRef.current;
    if (!dialog) return;

    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleTab);
    return () => document.removeEventListener('keydown', handleTab);
  }, [searchOpen]);

  const closeSearch = () => {
    setSearchOpen(false);
    setSearchQuery('');
    setActiveIndex(-1);
  };

  // (Flat index handled via groupedResults.startIndex)

  return (
    <>
      <div className="hidden md:flex items-center justify-between h-14 px-6 border-b border-card-border/35 bg-background/80 backdrop-blur-sm sticky top-0 z-30">
        {/* Search trigger */}
        <button
          ref={searchTriggerRef}
          type="button"
          onClick={() => setSearchOpen(true)}
          aria-keyshortcuts="Control+k Meta+k"
          className="flex items-center gap-2 px-3 py-1.5 bg-white/[0.10] border border-card-border/35 rounded-lg text-text-tertiary hover:text-text-secondary hover:border-accent/30 transition-colors text-sm w-64"
        >
          <Search className="w-4 h-4" />
          <span>Search vault...</span>
          <kbd className="ml-auto text-[10px] px-1.5 py-0.5 bg-white/[0.12] rounded border border-card-border/50 font-mono">
            ⌘K
          </kbd>
        </button>

        {/* Right side */}
        <div className="flex items-center gap-3">
          {/* Privacy posture badge */}
          <button
            type="button"
            onClick={() => onNavClick?.('settings')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium transition-colors hover:opacity-80 ${postureColor}`}
          >
            <Shield className="w-3 h-3" />
            {postureName}
          </button>

          {/* Recent activity bell */}
          <button
            type="button"
            onClick={() => onNavClick?.('approvals')}
            className="relative p-2 rounded-lg text-text-tertiary hover:text-white hover:bg-white/10 transition-colors"
            aria-label={`${recentActivityCount} recent approval${recentActivityCount !== 1 ? 's' : ''} in last 24 hours`}
          >
            <Bell className="w-[18px] h-[18px]" />
            {recentActivityCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 flex items-center justify-center text-[9px] font-bold text-white bg-accent rounded-full">
                {recentActivityCount}
              </span>
            )}
          </button>

          {/* User avatar */}
          <button
            type="button"
            onClick={() => onNavClick?.('settings')}
            className="w-8 h-8 bg-gradient-primary rounded-full flex items-center justify-center text-white text-xs font-semibold hover:shadow-glow transition-shadow"
            aria-label={`${userName} settings`}
          >
            {userInitials}
          </button>
        </div>
      </div>

      {/* Search overlay — accessible modal dialog with focus trap + keyboard nav */}
      {searchOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50"
            onClick={closeSearch}
            aria-hidden="true"
          />
          <div
            ref={searchDialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="Search vault"
            className="fixed top-[15%] left-1/2 -translate-x-1/2 w-full max-w-lg z-50 animate-scale-in"
          >
            <div className="glass-card overflow-hidden shadow-2xl">
              {/* Search input */}
              <div className="flex items-center gap-3 px-4 py-3 border-b border-card-border/35">
                <Search className="w-5 h-5 text-text-tertiary flex-shrink-0" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => updateSearchQuery(e.target.value)}
                  placeholder="Search personas, facts, rules, activity..."
                  className="flex-1 bg-transparent text-white placeholder-text-tertiary focus:outline-none text-sm"
                  aria-label="Search vault"
                  role="combobox"
                  aria-expanded={searchOpen && searchQuery.trim().length >= 2}
                  aria-activedescendant={activeIndex >= 0 ? `search-result-${activeIndex}` : undefined}
                  aria-controls="search-results-list"
                />
                <button
                  type="button"
                  onClick={closeSearch}
                  className="text-text-tertiary hover:text-white transition-colors"
                  aria-label="Close search"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Results — grouped by type */}
              {searchQuery.trim().length >= 2 && (
                <div ref={resultsRef} id="search-results-list" role="listbox" className="max-h-80 overflow-y-auto">
                  {groupedResults.length > 0 ? (
                    <div className="py-1">
                      {groupedResults.map((group) => {
                        const GroupIcon = group.icon;
                        return (
                          <div key={group.type}>
                            {/* Section header */}
                            <div className="flex items-center gap-2 px-4 py-2 text-text-tertiary">
                              <GroupIcon className="w-3.5 h-3.5" />
                              <span className="text-[10px] uppercase tracking-wider font-semibold">{group.label}</span>
                              <span className="text-[10px] bg-white/[0.12] px-1.5 py-0.5 rounded-full">{group.results.length}</span>
                            </div>
                            {/* Items */}
                            {group.results.map((r, i) => {
                              const idx = group.startIndex + i;
                              const isActive = idx === activeIndex;
                              return (
                                <button
                                  key={`${r.type}-${r.label}-${idx}`}
                                  id={`search-result-${idx}`}
                                  data-search-item
                                  role="option"
                                  aria-selected={isActive}
                                  type="button"
                                  onClick={() => navigateToResult(r)}
                                  onMouseEnter={() => setActiveIndex(idx)}
                                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                                    isActive ? 'bg-white/[0.08]' : 'hover:bg-white/10'
                                  }`}
                                >
                                  <div
                                    className={`w-2 h-2 rounded-full flex-shrink-0 ${
                                      r.type === 'persona'
                                        ? 'bg-primary'
                                        : r.type === 'fact'
                                          ? 'bg-accent'
                                          : r.type === 'rule'
                                            ? 'bg-yellow-400'
                                            : 'bg-purple-400'
                                    }`}
                                  />
                                  <div className="flex-1 min-w-0">
                                    <div className={`text-sm font-medium truncate ${r.masked ? 'text-text-tertiary' : 'text-white'}`}>
                                      {r.label}
                                    </div>
                                    <div className="text-text-tertiary text-xs truncate">{r.sublabel}</div>
                                  </div>
                                  {r.badge && (
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded capitalize flex-shrink-0 ${r.badgeColor ?? ''}`}>
                                      {r.badge}
                                    </span>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="py-8 text-center text-text-tertiary text-sm">
                      <p>No results for &ldquo;{searchQuery}&rdquo;</p>
                      <button
                        onClick={() => { setSearchOpen(false); onNavClick?.('sources'); }}
                        className="mt-3 inline-flex items-center gap-1.5 text-accent hover:text-accent/80 text-xs font-medium transition-colors"
                      >
                        <Upload className="w-3.5 h-3.5" />
                        Import more data to enrich your vault
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Hints */}
              {searchQuery.trim().length < 2 && (
                <div className="px-4 py-4 text-text-tertiary text-xs space-y-1.5">
                  <div>Search across personas, facts, rules, and activity.</div>
                  <div className="flex items-center gap-3">
                    <span>
                      <kbd className="px-1 py-0.5 bg-white/[0.12] rounded border border-card-border/50 font-mono text-[10px]">↑↓</kbd>{' '}
                      navigate
                    </span>
                    <span>
                      <kbd className="px-1 py-0.5 bg-white/[0.12] rounded border border-card-border/50 font-mono text-[10px]">↵</kbd>{' '}
                      open
                    </span>
                    <span>
                      <kbd className="px-1 py-0.5 bg-white/[0.12] rounded border border-card-border/50 font-mono text-[10px]">Esc</kbd>{' '}
                      close
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
