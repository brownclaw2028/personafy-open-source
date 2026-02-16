import { useState } from 'react';
import { Layout } from '../components/Layout';
import { SkeletonPage } from '../components/LoadingSkeleton';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import {
  CheckCircle,
  XCircle,
  Zap,
  Clock,
  Shield,
  Filter,
  Search,
  ExternalLink,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { useVault, type VaultAuditEvent, type VaultRule } from '../lib/VaultProvider';
import { createRuleCreatedAuditEvent, formatEventAction } from '../lib/utils';
import { VaultErrorState } from '../components/VaultErrorState';
import { toast } from '../components/Toast';

interface ApprovalsProps {
  userName?: string;
  userInitials?: string;
  onNavClick?: (itemId: string) => void;
}

type FilterType = 'all' | 'approved' | 'denied' | 'auto' | 'pending';

function isUserApproved(e: VaultAuditEvent) {
  return e.decision === 'ask_approved';
}

function isDenied(e: VaultAuditEvent) {
  return e.decision === 'ask_denied' || e.decision === 'deny';
}

function isAuto(e: VaultAuditEvent) {
  return e.decision === 'allow';
}

function isPending(e: VaultAuditEvent) {
  return (e.decision as string) === 'pending';
}

function isApproved(e: VaultAuditEvent) {
  return isUserApproved(e) || isAuto(e);
}

export function Approvals({
  userName = 'User',
  userInitials = 'U',
  onNavClick,
}: ApprovalsProps) {
  useDocumentTitle('Approvals');
  const { vault, loading, error, locked, refresh, unlock, save } = useVault();
  const [filter, setFilter] = useState<FilterType>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [ruleCreated, setRuleCreated] = useState<Record<string, boolean>>({});
  const [savingRule, setSavingRule] = useState<string | null>(null);

  if (loading || (!vault && !error && !locked)) {
    return (
      <Layout activeNav="approvals" userName={userName} userInitials={userInitials} onNavClick={onNavClick}>
        <SkeletonPage cards={6} />
      </Layout>
    );
  }

  if (locked || (error && !vault)) {
    return (
      <Layout activeNav="approvals" userName={userName} userInitials={userInitials} onNavClick={onNavClick}>
        <VaultErrorState error={error ?? 'Vault locked'} locked={locked} onUnlock={unlock} onRetry={refresh} />
      </Layout>
    );
  }

  const createRuleFromApproval = async (event: VaultAuditEvent) => {
    if (!vault || savingRule) return;
    setSavingRule(event.id);
    const parts = event.purpose.split('/');
    const cat = parts[0] ?? '';
    const act = parts[1] ?? '';
    const newRule: VaultRule = {
      id: 'rule_' + crypto.randomUUID().slice(0, 8),
      recipientDomain: event.recipientDomain,
      purposeCategory: cat,
      purposeAction: act,
      maxSensitivity: 'medium',
      allowedFields: event.fieldsReleased,
      // eslint-disable-next-line react-hooks/purity -- event handler, not render
      expiresAt: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString(),
      enabled: true,
    };
    const auditEvent = createRuleCreatedAuditEvent({
      requestId: newRule.id,
      recipientDomain: newRule.recipientDomain,
      purposeCategory: newRule.purposeCategory,
      purposeAction: newRule.purposeAction,
      allowedFields: newRule.allowedFields,
    });

    const ok = await save({
      ...vault,
      rules: [...vault.rules, newRule],
      auditLog: [...vault.auditLog, auditEvent],
    });
    setSavingRule(null);
    if (ok) {
      setRuleCreated(prev => ({ ...prev, [event.id]: true }));
      toast(`Auto-allow rule created for ${event.recipientDomain}`);
    } else {
      toast('Failed to create rule', 'error');
    }
  };

  // Filter out rule_created events from the approval view
  const allEvents = (vault?.auditLog || [])
    .filter(e => !e.purpose?.startsWith('rule_created'))
    .reverse();

  const filtered = allEvents.filter((e) => {
    if (filter === 'approved' && !isApproved(e)) return false;
    if (filter === 'denied' && !isDenied(e)) return false;
    if (filter === 'auto' && !isAuto(e)) return false;
    if (filter === 'pending' && !isPending(e)) return false;
    if (searchQuery && !e.recipientDomain?.toLowerCase().includes(searchQuery.toLowerCase()) && !e.purpose?.toLowerCase().includes(searchQuery.toLowerCase()))
      return false;
    return true;
  });

  const counts = {
    all: allEvents.length,
    approved: allEvents.filter(isUserApproved).length,
    denied: allEvents.filter(isDenied).length,
    auto: allEvents.filter(isAuto).length,
    pending: allEvents.filter(isPending).length,
  };

  return (
    <Layout
      activeNav="approvals"
      userName={userName}
      userInitials={userInitials}
      onNavClick={onNavClick}
    >
      <div className="p-8 max-w-5xl animate-fade-in">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">Approvals</h1>
          <p className="text-text-secondary">
            Review every context request — who asked, what was shared, and when.
          </p>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <MiniStat label="Total Requests" value={counts.all} color="text-white" />
          <MiniStat label="Approved" value={counts.approved} color="text-accent" />
          <MiniStat label="Denied" value={counts.denied} color="text-red-400" />
          <MiniStat label="Auto-allowed" value={counts.auto} color="text-primary" />
        </div>

        {/* Filters & Search */}
        <div className="flex flex-col sm:flex-row gap-4 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" />
            <input
              type="text"
              placeholder="Search by domain or purpose..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search approvals"
              className="w-full pl-10 pr-4 py-2.5 bg-card border border-card-border/50 rounded-lg text-white placeholder-text-tertiary focus:outline-none focus:border-accent/50 transition-colors text-sm"
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            {(['all', 'pending', 'approved', 'denied', 'auto'] as FilterType[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-4 py-2.5 rounded-lg text-sm font-medium capitalize transition-all duration-200 ${
                  filter === f
                    ? 'bg-primary text-white shadow-glow'
                    : 'bg-card border border-card-border/50 text-text-secondary hover:text-white hover:border-accent/40'
                }`}
              >
                <Filter className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5" />
                {f === 'auto' ? 'Auto' : f}
              </button>
            ))}
          </div>
        </div>

        {/* Timeline */}
        <div className="space-y-3 stagger-children">
            {filtered.map((event) => (
              <ApprovalCard
                key={event.id}
                event={event}
                expanded={expandedId === event.id}
                onToggle={() =>
                  setExpandedId(expandedId === event.id ? null : event.id)
                }
                onCreateRule={() => createRuleFromApproval(event)}
                ruleCreated={!!ruleCreated[event.id]}
                saving={savingRule === event.id}
              />
            ))}
            {filtered.length === 0 && (
              <div className="glass-card p-12 text-center">
                <Shield className="w-12 h-12 text-text-tertiary mx-auto mb-4" />
                <h3 className="text-white font-medium mb-2">No matching events</h3>
                <p className="text-text-tertiary text-sm">
                  {allEvents.length === 0
                    ? 'No approval events yet. They will appear when an agent requests your context.'
                    : 'Try adjusting your filters or search query.'}
                </p>
              </div>
            )}
          </div>
      </div>
    </Layout>
  );
}

/* ---- Sub-components ---- */

function MiniStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="glass-card p-4">
      <div className={`text-2xl font-bold ${color} mb-0.5`}>{value}</div>
      <div className="text-text-tertiary text-xs">{label}</div>
    </div>
  );
}

function ApprovalCard({
  event,
  expanded,
  onToggle,
  onCreateRule,
  ruleCreated,
  saving,
}: {
  event: VaultAuditEvent;
  expanded: boolean;
  onToggle: () => void;
  onCreateRule: () => void;
  ruleCreated: boolean;
  saving: boolean;
}) {
  const approved = isApproved(event);
  const auto = isAuto(event);

  const config = approved
    ? auto
      ? {
          icon: <Zap className="w-5 h-5 text-primary" />,
          bg: 'bg-primary/10',
          label: 'Auto-allowed',
          labelColor: 'text-primary',
          labelBg: 'bg-primary/10',
        }
      : {
          icon: <CheckCircle className="w-5 h-5 text-accent" />,
          bg: 'bg-accent/10',
          label: 'Approved',
          labelColor: 'text-accent',
          labelBg: 'bg-accent/10',
        }
    : {
        icon: <XCircle className="w-5 h-5 text-red-400" />,
        bg: 'bg-red-400/10',
        label: 'Denied',
        labelColor: 'text-red-400',
        labelBg: 'bg-red-400/10',
      };

  const ts = new Date(event.timestamp);
  const timeStr = ts.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const purposeParts = event.purpose.split('/');
  const category = purposeParts[0] ?? '';
  const action = purposeParts[1] ?? '';

  return (
    <div className="glass-card overflow-hidden transition-all duration-200 hover:border-accent/20">
      <button onClick={onToggle} className="w-full flex items-center gap-4 p-5 text-left">
        <div className={`w-11 h-11 ${config.bg} rounded-xl flex items-center justify-center flex-shrink-0`}>
          {config.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-white font-medium">{event.recipientDomain}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full ${config.labelBg} ${config.labelColor} font-medium`}>
              {config.label}
            </span>
          </div>
          <div className="text-text-tertiary text-sm flex items-center gap-2">
            <span>{formatEventAction(category)}</span>
            <span className="text-text-tertiary/40">→</span>
            <span>{formatEventAction(action)}</span>
            <span className="text-text-tertiary/40">·</span>
            <span>{event.fieldsReleased.length} fields</span>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="text-text-tertiary text-xs flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {timeStr}
          </div>
          {expanded ? <ChevronUp className="w-4 h-4 text-text-tertiary" /> : <ChevronDown className="w-4 h-4 text-text-tertiary" />}
        </div>
      </button>

      {expanded && (
        <div className="px-5 pb-5 pt-0 border-t border-card-border/35">
          <div className="pt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <div className="text-text-tertiary text-xs uppercase tracking-wider mb-2">Fields Shared</div>
              {event.fieldsReleased.length > 0 ? (
                <div className="space-y-1.5">
                  {event.fieldsReleased.map((field) => (
                    <div key={field} className="flex items-center gap-2 text-sm">
                      <div className="w-1.5 h-1.5 rounded-full bg-accent" />
                      <code className="text-text-secondary font-mono text-xs">{field}</code>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-text-tertiary text-sm italic">No fields were released.</p>
              )}
            </div>
            <div>
              <div className="text-text-tertiary text-xs uppercase tracking-wider mb-2">Request Details</div>
              <div className="space-y-2 text-sm">
                <DetailRow label="Request ID" value={event.requestId} mono />
                <DetailRow label="Audit ID" value={event.id} mono />
                <DetailRow label="Timestamp" value={ts.toISOString()} mono />
                <DetailRow label="Decision" value={event.decision} />
              </div>
            </div>
          </div>
          {approved && !auto && (
            <div className="mt-4 pt-4 border-t border-card-border/35">
              {ruleCreated ? (
                <div className="text-sm text-accent flex items-center gap-1.5">
                  <CheckCircle className="w-4 h-4" />
                  Rule created for {event.recipientDomain} — 180 days
                </div>
              ) : (
                <button
                  onClick={onCreateRule}
                  disabled={saving}
                  className={`text-sm flex items-center gap-1.5 transition-colors ${
                    saving ? 'text-text-tertiary cursor-not-allowed' : 'text-accent hover:text-accent/80'
                  }`}
                >
                  <Shield className="w-4 h-4" />
                  {saving ? 'Creating rule…' : `Create auto-allow rule for ${event.recipientDomain}`}
                  {!saving && <ExternalLink className="w-3 h-3" />}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-text-tertiary w-24 flex-shrink-0">{label}</span>
      <span className={`text-text-secondary ${mono ? 'font-mono text-xs' : ''} break-all`}>{value}</span>
    </div>
  );
}
