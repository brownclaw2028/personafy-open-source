import { useState, useMemo } from 'react';
import { Layout } from '../components/Layout';
import { SkeletonPage } from '../components/LoadingSkeleton';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import {
  FileText,
  Download,
  Shield,
  Clock,
  CheckCircle,
  XCircle,
  Zap,
  Eye,
  Search,
  Filter,
  ChevronLeft,
  ChevronRight,
  Calendar,
} from 'lucide-react';
import { useVault, type VaultAuditEvent } from '../lib/VaultProvider';
import { VaultErrorState } from '../components/VaultErrorState';
import { formatPurposeDisplay } from '../lib/utils';

interface AuditLogProps {
  userName?: string;
  userInitials?: string;
  onNavClick?: (itemId: string) => void;
}

const PAGE_SIZE = 25;

function isConfigEvent(event: VaultAuditEvent): boolean {
  const d = event.decision as string;
  return d === 'rule_created' || d === 'vault_created' || event.purpose?.startsWith('rule_created') === true;
}

function getIcon(event: VaultAuditEvent) {
  if (isConfigEvent(event)) return <Shield className="w-4 h-4 text-primary" />;
  switch (event.decision) {
    case 'ask_approved': return <CheckCircle className="w-4 h-4 text-accent" />;
    case 'allow': return <Zap className="w-4 h-4 text-primary" />;
    case 'ask_denied':
    case 'deny': return <XCircle className="w-4 h-4 text-red-400" />;
    default: return <Eye className="w-4 h-4 text-yellow-400" />;
  }
}

type CategoryType = 'access' | 'config';

function getCategory(event: VaultAuditEvent): CategoryType {
  if (isConfigEvent(event)) return 'config';
  return 'access';
}

function formatPurpose(event: VaultAuditEvent): string {
  if (isConfigEvent(event)) {
    return `New rule created for ${event.recipientDomain}`;
  }
  const fieldCount = event.fieldsReleased.length;
  const fieldLabel = fieldCount === 1 ? '1 field' : `${fieldCount} fields`;
  const purpose = formatPurposeDisplay(event.purpose);
  switch (event.decision) {
    case 'allow':
      return `Auto-shared ${fieldLabel} with ${event.recipientDomain} — ${purpose}`;
    case 'ask_approved':
      return `You approved ${fieldLabel} for ${event.recipientDomain} — ${purpose}`;
    case 'ask_denied':
    case 'deny':
      return `Denied access from ${event.recipientDomain} — ${purpose}`;
    default:
      return `${event.recipientDomain} — ${purpose} (${fieldLabel})`;
  }
}

const categoryColors: Record<string, string> = {
  access: 'text-primary bg-primary/10',
  config: 'text-yellow-400 bg-yellow-400/10',
};

type FilterType = 'all' | 'access' | 'config';
type EventType = 'all' | 'allow' | 'deny' | 'ask_approved' | 'ask_denied';

const eventTypeLabels: Record<EventType, string> = {
  all: 'All Events',
  allow: 'Auto-allowed',
  deny: 'Denied',
  ask_approved: 'Approved',
  ask_denied: 'User Denied',
};

export function AuditLog({ userName = 'User', userInitials = 'U', onNavClick }: AuditLogProps) {
  useDocumentTitle('Audit Log');
  const { vault, loading, error, locked, refresh, unlock } = useVault();
  const [filter, setFilter] = useState<FilterType>('all');
  const [eventType, setEventType] = useState<EventType>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const allEvents = useMemo(() => 
    (vault?.auditLog || []).slice().reverse(),
    [vault?.auditLog]
  );

  const filtered = useMemo(() => {
    return allEvents.filter((e) => {
      // Category filter
      if (filter !== 'all' && getCategory(e) !== filter) return false;
      
      // Event type filter
      if (eventType !== 'all' && e.decision !== eventType) return false;
      
      // Date range filter
      if (startDate) {
        const eventDate = new Date(e.timestamp);
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        if (eventDate < start) return false;
      }
      if (endDate) {
        const eventDate = new Date(e.timestamp);
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        if (eventDate > end) return false;
      }
      
      // Search filter
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return (
          e.recipientDomain?.toLowerCase().includes(q) ||
          e.purpose?.toLowerCase().includes(q) ||
          e.requestId?.toLowerCase().includes(q) ||
          e.fieldsReleased?.some(f => f.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [allEvents, filter, eventType, startDate, endDate, searchQuery]);

  // Reset to page 1 when filters change
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const safeCurrentPage = Math.min(currentPage, Math.max(1, totalPages));
  
  // Get current page items
  const paginatedEvents = useMemo(() => {
    const startIndex = (safeCurrentPage - 1) * PAGE_SIZE;
    return filtered.slice(startIndex, startIndex + PAGE_SIZE);
  }, [filtered, safeCurrentPage]);

  // Group paginated events by date
  const grouped = useMemo(() => {
    return paginatedEvents.reduce<Record<string, VaultAuditEvent[]>>((acc, entry) => {
      const date = new Date(entry.timestamp).toLocaleDateString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
      });
      if (!acc[date]) acc[date] = [];
      acc[date].push(entry);
      return acc;
    }, {});
  }, [paginatedEvents]);

  const counts = useMemo(() => ({
    all: allEvents.length,
    access: allEvents.filter(e => getCategory(e) === 'access').length,
    config: allEvents.filter(e => getCategory(e) === 'config').length,
  }), [allEvents]);

  // Reset page when filters change
  const handleFilterChange = (newFilter: FilterType) => {
    setFilter(newFilter);
    setCurrentPage(1);
  };

  const handleEventTypeChange = (newType: EventType) => {
    setEventType(newType);
    setCurrentPage(1);
  };

  const handleSearchChange = (query: string) => {
    setSearchQuery(query);
    setCurrentPage(1);
  };

  const handleDateChange = (type: 'start' | 'end', value: string) => {
    if (type === 'start') {
      setStartDate(value);
    } else {
      setEndDate(value);
    }
    setCurrentPage(1);
  };

  const clearDateFilters = () => {
    setStartDate('');
    setEndDate('');
    setCurrentPage(1);
  };

  if (loading || (!vault && !error && !locked)) {
    return (
      <Layout activeNav="audit" userName={userName} userInitials={userInitials} onNavClick={onNavClick}>
        <SkeletonPage cards={6} />
      </Layout>
    );
  }

  if (locked || (error && !vault)) {
    return (
      <Layout activeNav="audit" userName={userName} userInitials={userInitials} onNavClick={onNavClick}>
        <VaultErrorState error={error ?? 'Vault locked'} locked={locked} onUnlock={unlock} onRetry={refresh} />
      </Layout>
    );
  }

  const handleExport = () => {
    if (!vault) return;
    const blob = new Blob([JSON.stringify(vault.auditLog, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `personafy-audit-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  return (
    <Layout activeNav="audit" userName={userName} userInitials={userInitials} onNavClick={onNavClick}>
      <div className="p-8 max-w-5xl animate-fade-in">
        {/* Header */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">Audit Log</h1>
            <p className="text-text-secondary">
              Complete record of every vault action — access requests, config changes, and rule events.
            </p>
          </div>
          <button onClick={handleExport}
            className="flex items-center gap-2 px-4 py-2.5 border border-card-border/50 rounded-lg text-text-secondary hover:text-white hover:border-accent/40 text-sm font-medium transition-colors">
            <Download className="w-4 h-4" />
            Export
          </button>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <MiniStat label="Total Events" value={counts.all} color="text-white" />
          <MiniStat label="Data Access" value={counts.access} color="text-primary" />
          <MiniStat label="Rule Changes" value={counts.config} color="text-yellow-400" />
        </div>

        {/* Search & Filters */}
        <div className="space-y-4 mb-6">
          {/* Search bar */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" />
            <input
              type="text"
              placeholder="Search by domain, purpose, request ID, or field..."
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              aria-label="Search audit log"
              className="w-full pl-10 pr-4 py-2.5 bg-card border border-card-border/50 rounded-lg text-white placeholder-text-tertiary focus:outline-none focus:border-accent/50 transition-colors text-sm"
            />
          </div>

          {/* Filter row */}
          <div className="flex flex-col lg:flex-row gap-4">
            {/* Category filters */}
            <div className="flex gap-2">
              {([['all', 'All'], ['access', 'Data Access'], ['config', 'Rule Changes']] as [FilterType, string][]).map(([f, label]) => (
                <button
                  key={f}
                  onClick={() => handleFilterChange(f)}
                  className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                    filter === f
                      ? 'bg-primary text-white shadow-glow'
                      : 'bg-card border border-card-border/50 text-text-secondary hover:text-white hover:border-accent/40'
                  }`}
                >
                  <Filter className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5" />
                  {label}
                </button>
              ))}
            </div>

            {/* Event type filter */}
            <div className="flex-1">
              <select
                value={eventType}
                onChange={(e) => handleEventTypeChange(e.target.value as EventType)}
                className="w-full lg:w-auto px-4 py-2.5 bg-card border border-card-border/50 rounded-lg text-white text-sm font-medium focus:outline-none focus:border-accent/50 transition-colors cursor-pointer"
              >
                {(Object.keys(eventTypeLabels) as EventType[]).map((type) => (
                  <option key={type} value={type}>
                    {eventTypeLabels[type]}
                  </option>
                ))}
              </select>
            </div>

            {/* Date range picker */}
            <div className="flex flex-wrap items-center gap-2">
              <Calendar className="w-4 h-4 text-text-tertiary flex-shrink-0" />
              <input
                type="date"
                value={startDate}
                onChange={(e) => handleDateChange('start', e.target.value)}
                aria-label="Filter by start date"
                className="px-3 py-2.5 bg-card border border-card-border/50 rounded-lg text-white text-sm focus:outline-none focus:border-accent/50 transition-colors"
                placeholder="Start date"
              />
              <span className="text-text-tertiary text-sm">to</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => handleDateChange('end', e.target.value)}
                aria-label="Filter by end date"
                className="px-3 py-2.5 bg-card border border-card-border/50 rounded-lg text-white text-sm focus:outline-none focus:border-accent/50 transition-colors"
                placeholder="End date"
              />
              {(startDate || endDate) && (
                <button
                  onClick={clearDateFilters}
                  className="px-3 py-2.5 bg-card border border-card-border/50 rounded-lg text-text-secondary hover:text-white hover:border-accent/40 text-sm transition-colors"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Results info */}
        {filtered.length > 0 && (
          <div className="flex items-center justify-between mb-4 text-sm text-text-tertiary">
            <span>
              Showing {((safeCurrentPage - 1) * PAGE_SIZE) + 1}–{Math.min(safeCurrentPage * PAGE_SIZE, filtered.length)} of {filtered.length} events
            </span>
            {totalPages > 1 && (
              <span>Page {safeCurrentPage} of {totalPages}</span>
            )}
          </div>
        )}

        {filtered.length === 0 ? (
          <div className="glass-card p-12 text-center">
            <FileText className="w-12 h-12 text-text-tertiary mx-auto mb-4" />
            <h3 className="text-white font-medium mb-2">No matching events</h3>
            <p className="text-text-tertiary text-sm">
              {allEvents.length === 0
                ? 'Events will appear as agents interact with your vault.'
                : 'Try adjusting your filters or search query.'}
            </p>
          </div>
        ) : (
          <>
            <div className="space-y-8">
              {Object.entries(grouped).map(([date, entries]) => (
                <div key={date}>
                  <h3 className="text-text-tertiary text-sm font-medium uppercase tracking-wider mb-4">{date}</h3>
                  <div className="relative">
                    <div className="absolute left-5 top-0 bottom-0 w-px bg-card-border/30" />
                    <div className="space-y-1">
                      {entries.map((entry) => {
                        const time = new Date(entry.timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                        const cat = getCategory(entry);
                        return (
                          <div key={entry.id} className={`relative flex items-start gap-4 py-3 pl-2 group ${
                            (entry.decision === 'deny' || entry.decision === 'ask_denied')
                              ? 'border-l-2 border-red-400/50'
                              : ''
                          }`}>
                            <div className="w-7 h-7 rounded-full bg-card border border-card-border/50 flex items-center justify-center z-10 flex-shrink-0 group-hover:border-accent/40 transition-colors">
                              {getIcon(entry)}
                            </div>
                            <div className="flex-1 min-w-0 -mt-0.5">
                              <span className="text-white text-sm">{formatPurpose(entry)}</span>
                              <div className="flex items-center gap-3 text-xs text-text-tertiary mt-0.5">
                                <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{time}</span>
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${categoryColors[cat]}`}>{cat === 'config' ? 'Rule Change' : 'Data Access'}</span>
                                {!isConfigEvent(entry) && (
                                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                    entry.decision === 'deny' || entry.decision === 'ask_denied'
                                      ? 'text-red-400 bg-red-400/10'
                                      : entry.decision === 'allow'
                                        ? 'text-primary bg-primary/10'
                                        : 'text-accent bg-accent/10'
                                  }`}>
                                    {entry.decision === 'deny' ? 'Denied' : entry.decision === 'ask_denied' ? 'User Denied' : entry.decision === 'allow' ? 'Auto-Allowed' : 'Approved'}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination controls */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 mt-8">
                <button
                  onClick={() => setCurrentPage(1)}
                  disabled={safeCurrentPage === 1}
                  className="px-3 py-2 bg-card border border-card-border/50 rounded-lg text-text-secondary hover:text-white hover:border-accent/40 text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  First
                </button>
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={safeCurrentPage === 1}
                  className="p-2 bg-card border border-card-border/50 rounded-lg text-text-secondary hover:text-white hover:border-accent/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                
                {/* Page numbers */}
                <div className="flex gap-1">
                  {generatePageNumbers(safeCurrentPage, totalPages).map((page, idx) => (
                    page === '...' ? (
                      <span key={`ellipsis-${idx}`} className="px-3 py-2 text-text-tertiary">...</span>
                    ) : (
                      <button
                        key={page}
                        onClick={() => setCurrentPage(page as number)}
                        className={`px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                          safeCurrentPage === page
                            ? 'bg-primary text-white shadow-glow'
                            : 'bg-card border border-card-border/50 text-text-secondary hover:text-white hover:border-accent/40'
                        }`}
                      >
                        {page}
                      </button>
                    )
                  ))}
                </div>

                <button
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={safeCurrentPage === totalPages}
                  className="p-2 bg-card border border-card-border/50 rounded-lg text-text-secondary hover:text-white hover:border-accent/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setCurrentPage(totalPages)}
                  disabled={safeCurrentPage === totalPages}
                  className="px-3 py-2 bg-card border border-card-border/50 rounded-lg text-text-secondary hover:text-white hover:border-accent/40 text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Last
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}

function MiniStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="glass-card p-4">
      <div className={`text-2xl font-bold ${color} mb-0.5`}>{value}</div>
      <div className="text-text-tertiary text-xs">{label}</div>
    </div>
  );
}

function generatePageNumbers(current: number, total: number): (number | string)[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  
  const pages: (number | string)[] = [];
  
  if (current <= 4) {
    // Near start
    pages.push(1, 2, 3, 4, 5, '...', total);
  } else if (current >= total - 3) {
    // Near end
    pages.push(1, '...', total - 4, total - 3, total - 2, total - 1, total);
  } else {
    // Middle
    pages.push(1, '...', current - 1, current, current + 1, '...', total);
  }
  
  return pages;
}
