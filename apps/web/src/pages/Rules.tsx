import { useEffect, useState } from 'react';
import { Layout } from '../components/Layout';
import { SkeletonPage } from '../components/LoadingSkeleton';
import { useNow } from '../lib/useNow';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import {
  Shield,
  Plus,
  Trash2,
  Clock,
  Globe,
  Tag,
  AlertTriangle,
  Sparkles,
  X,
  Pencil,
  Search,
  Filter,
} from 'lucide-react';
import { useVault, type VaultRule, type VaultData } from '../lib/VaultProvider';
import { VaultErrorState } from '../components/VaultErrorState';
import { toast } from '../components/Toast';
import { createRuleCreatedAuditEvent, formatEventAction, formatFactKey } from '../lib/utils';
import { ConfirmDialog } from '../components/ConfirmDialog';

interface RulesProps {
  userName?: string;
  userInitials?: string;
  onNavClick?: (itemId: string) => void;
}

export function Rules({
  userName = 'User',
  userInitials = 'U',
  onNavClick,
}: RulesProps) {
  useDocumentTitle('Rules');
  const { vault, loading, error, locked, refresh, unlock, save } = useVault();
  const [showCreate, setShowCreate] = useState(false);
  const [editingRule, setEditingRule] = useState<VaultRule | null>(null);
  const [deletingRule, setDeletingRule] = useState<VaultRule | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'disabled'>('all');

  const allRules = vault?.rules || [];
  const activeCount = allRules.filter((r) => r.enabled).length;

  const rules = allRules.filter((r) => {
    if (statusFilter === 'active' && !r.enabled) return false;
    if (statusFilter === 'disabled' && r.enabled) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        r.recipientDomain.toLowerCase().includes(q) ||
        r.purposeCategory.toLowerCase().includes(q) ||
        r.purposeAction.toLowerCase().includes(q) ||
        r.allowedFields.some((f) => f.toLowerCase().includes(q))
      );
    }
    return true;
  });

  useEffect(() => {
    const handleKeyboardNew = (event: Event) => {
      event.preventDefault();
      setShowCreate(true);
    };
    const handleKeyboardEdit = (event: Event) => {
      event.preventDefault();
      if (rules.length > 0) {
        setEditingRule(rules[0]);
      }
    };
    window.addEventListener('keyboard:new', handleKeyboardNew as EventListener);
    window.addEventListener('keyboard:edit', handleKeyboardEdit as EventListener);
    return () => {
      window.removeEventListener('keyboard:new', handleKeyboardNew as EventListener);
      window.removeEventListener('keyboard:edit', handleKeyboardEdit as EventListener);
    };
  }, [rules]);

  // Show skeleton while loading, or if vault hasn't arrived yet (avoids flash of empty content)
  if (loading || (!vault && !error && !locked)) {
    return (
      <Layout activeNav="rules" userName={userName} userInitials={userInitials} onNavClick={onNavClick}>
        <SkeletonPage cards={4} />
      </Layout>
    );
  }

  // Show lock screen or error state when vault is inaccessible
  if (locked || (error && !vault)) {
    return (
      <Layout activeNav="rules" userName={userName} userInitials={userInitials} onNavClick={onNavClick}>
        <VaultErrorState error={error ?? 'Vault locked'} locked={locked} onUnlock={unlock} onRetry={refresh} />
      </Layout>
    );
  }

  const toggleRule = async (id: string) => {
    if (!vault) return;
    const rule = vault.rules.find((r) => r.id === id);
    const updated: VaultData = {
      ...vault,
      rules: vault.rules.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)),
    };
    const ok = await save(updated);
    if (ok) toast(`Rule ${!rule?.enabled ? 'enabled' : 'disabled'}`);
    else toast('Failed to update rule', 'error');
  };

  const deleteRule = async (rule: VaultRule) => {
    if (!vault) return;
    const updated: VaultData = {
      ...vault,
      rules: vault.rules.filter((r) => r.id !== rule.id),
    };
    const ok = await save(updated);
    if (ok) toast('Rule deleted');
    else toast('Failed to delete rule', 'error');
    setDeletingRule(null);
  };

  const createRule = async (rule: VaultRule): Promise<boolean> => {
    if (!vault) return false;

    const auditEvent = createRuleCreatedAuditEvent({
      requestId: rule.id,
      recipientDomain: rule.recipientDomain,
      purposeCategory: rule.purposeCategory,
      purposeAction: rule.purposeAction,
      allowedFields: rule.allowedFields,
    });

    const updated: VaultData = {
      ...vault,
      rules: [...vault.rules, rule],
      auditLog: [...vault.auditLog, auditEvent],
    };
    const ok = await save(updated);
    if (ok) {
      toast(`Rule created for ${rule.recipientDomain}`);
      setShowCreate(false);
    } else {
      toast('Failed to create rule', 'error');
    }
    return !!ok;
  };

  const updateRule = async (rule: VaultRule): Promise<boolean> => {
    if (!vault) return false;
    const updated: VaultData = {
      ...vault,
      rules: vault.rules.map((r) => (r.id === rule.id ? rule : r)),
    };
    const ok = await save(updated);
    if (ok) {
      toast('Rule updated');
      setEditingRule(null);
    } else {
      toast('Failed to update rule', 'error');
    }
    return !!ok;
  };

  return (
    <Layout activeNav="rules" userName={userName} userInitials={userInitials} onNavClick={onNavClick}>
      <div className="p-8 max-w-5xl animate-fade-in">
        {/* Header */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">Rules</h1>
            <p className="text-text-secondary">
              Auto-allow rules let trusted services access your context without asking every time.
            </p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-primary hover:bg-primary/90 text-white rounded-lg text-sm font-medium transition-colors shadow-glow"
          >
            <Plus className="w-4 h-4" />
            New Rule
          </button>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <div className="glass-card p-4">
            <div className="text-2xl font-bold text-white mb-0.5">{allRules.length}</div>
            <div className="text-text-tertiary text-xs">Total Rules</div>
          </div>
          <div className="glass-card p-4">
            <div className="text-2xl font-bold text-accent mb-0.5">{activeCount}</div>
            <div className="text-text-tertiary text-xs">Active</div>
          </div>
          <div className="glass-card p-4">
            <div className="text-2xl font-bold text-yellow-400 mb-0.5">{allRules.length - activeCount}</div>
            <div className="text-text-tertiary text-xs">Disabled</div>
          </div>
        </div>

        {/* Info Banner */}
        <div className="glass-card p-4 mb-6 border-accent/20 flex items-start gap-3">
          <Sparkles className="w-5 h-5 text-accent flex-shrink-0 mt-0.5" />
          <p className="text-text-secondary text-sm">
            Rules are created automatically when you approve a context request and choose "Remember this."
            You can also create rules manually below. Rules respect your privacy posture — they can never
            override a "Strict" lockdown.
          </p>
        </div>

        {/* Search & Filters */}
        {allRules.length > 0 && (
          <div className="flex flex-col sm:flex-row gap-4 mb-6">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" />
              <input
                type="text"
                placeholder="Search by domain, category, or field..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label="Search rules"
                className="w-full pl-10 pr-4 py-2.5 bg-card border border-card-border/50 rounded-lg text-white placeholder-text-tertiary focus:outline-none focus:border-accent/50 transition-colors text-sm"
              />
            </div>
            <div className="flex gap-2">
              {(['all', 'active', 'disabled'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setStatusFilter(f)}
                  className={`px-4 py-2.5 rounded-lg text-sm font-medium capitalize transition-all duration-200 ${
                    statusFilter === f
                      ? 'bg-primary text-white shadow-glow'
                      : 'bg-card border border-card-border/50 text-text-secondary hover:text-white hover:border-accent/40'
                  }`}
                >
                  <Filter className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5" />
                  {f}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Rules List */}
        <div className="space-y-3 stagger-children">
            {rules.map((rule) => (
              <RuleCard key={rule.id} rule={rule} onToggle={() => toggleRule(rule.id)} onEdit={() => setEditingRule(rule)} onDelete={() => setDeletingRule(rule)} />
            ))}
            {rules.length === 0 && (
              <div className="glass-card p-12 text-center">
                <Shield className="w-12 h-12 text-text-tertiary mx-auto mb-4" />
                <h3 className="text-white font-medium mb-2">
                  {allRules.length === 0 ? 'No rules yet' : 'No matching rules'}
                </h3>
                <p className="text-text-tertiary text-sm mb-4">
                  {allRules.length === 0
                    ? 'Approve a context request and choose "Remember this" to create your first rule.'
                    : 'Try adjusting your search or filter.'}
                </p>
                {allRules.length === 0 && (
                  <button onClick={() => setShowCreate(true)} className="text-sm text-accent hover:text-accent/80 transition-colors">
                    Or create one manually →
                  </button>
                )}
              </div>
            )}
          </div>

        {showCreate && <CreateRuleModal onClose={() => setShowCreate(false)} onSave={createRule} />}
        {editingRule && <EditRuleModal rule={editingRule} onClose={() => setEditingRule(null)} onSave={updateRule} />}
        <ConfirmDialog
          open={!!deletingRule}
          title="Delete Rule"
          message={deletingRule ? `Delete the rule for ${deletingRule.recipientDomain} (${deletingRule.purposeCategory}/${deletingRule.purposeAction})? This cannot be undone.` : ''}
          confirmLabel="Delete"
          variant="danger"
          onConfirm={() => deletingRule && deleteRule(deletingRule)}
          onCancel={() => setDeletingRule(null)}
        />
      </div>
    </Layout>
  );
}

/* ---- Sub-components ---- */

function RuleCard({ rule, onToggle, onEdit, onDelete }: { rule: VaultRule; onToggle: () => void; onEdit: () => void; onDelete: () => void }) {
  const now = useNow(60_000);
  const expires = new Date(rule.expiresAt);
  const isExpired = expires.getTime() < now;
  const daysLeft = Math.ceil((expires.getTime() - now) / (1000 * 60 * 60 * 24));

  const sensitivityConfig = {
    low: { color: 'text-accent', bg: 'bg-accent/10', label: 'Low' },
    medium: { color: 'text-yellow-400', bg: 'bg-yellow-400/10', label: 'Medium' },
    high: { color: 'text-red-400', bg: 'bg-red-400/10', label: 'High' },
  }[rule.maxSensitivity];

  return (
    <div className={`glass-card p-5 transition-all duration-200 ${!rule.enabled ? 'opacity-50' : 'hover:border-accent/20'}`}>
      <div className="flex items-start gap-4">
        <button
          type="button"
          role="switch"
          aria-checked={rule.enabled}
          aria-label={`${rule.enabled ? 'Disable' : 'Enable'} rule for ${rule.recipientDomain}`}
          onClick={onToggle}
          className={`flex-shrink-0 mt-0.5 w-11 h-6 rounded-full transition-colors border ${
            rule.enabled
              ? 'bg-accent/80 border-accent/70'
              : 'bg-card border-card-border/50'
          }`}
        >
          <span
            className={`block mt-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
              rule.enabled ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-2">
            <Globe className="w-4 h-4 text-text-tertiary" />
            <span className="text-white font-semibold">{rule.recipientDomain}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full ${sensitivityConfig.bg} ${sensitivityConfig.color} font-medium`}>
              Max: {sensitivityConfig.label}
            </span>
            {isExpired && <span className="text-xs px-2 py-0.5 rounded-full bg-red-400/10 text-red-400 font-medium">Expired</span>}
          </div>
          <div className="flex items-center gap-4 text-sm text-text-tertiary mb-3">
            <div className="flex items-center gap-1.5">
              <Tag className="w-3.5 h-3.5" />
              <span className="capitalize">{rule.purposeCategory} → {rule.purposeAction.replace(/_/g, ' ')}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" />
              {isExpired ? <span className="text-red-400">Expired</span> : <span>{daysLeft} days remaining</span>}
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {rule.allowedFields.map((field) => (
              <span key={field} title={field} className="text-xs px-2 py-1 bg-white/[0.10] border border-card-border/35 rounded text-text-secondary">
                {formatFactKey(field)}
              </span>
            ))}
          </div>
        </div>
        <button onClick={onEdit} className="flex-shrink-0 text-text-tertiary hover:text-accent transition-colors p-1" title="Edit rule">
          <Pencil className="w-4 h-4" />
        </button>
        <button onClick={onDelete} className="flex-shrink-0 text-text-tertiary hover:text-red-400 transition-colors p-1" title="Delete rule">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

const COMMON_FIELD_PATTERNS = [
  'apparel.*', 'apparel.shoe.*', 'apparel.pants.*', 'apparel.shirt.*',
  'food.*', 'food.diet', 'food.allergies', 'food.cuisine.*',
  'travel.*', 'travel.airline.*', 'travel.hotel.*', 'travel.seat.*',
  'shopping.*', 'shopping.budget.*', 'shopping.style', 'shopping.brands.*',
  'fitness.*', 'health.*', 'entertainment.*', 'home.*', 'work.*',
];

function CreateRuleModal({ onClose, onSave }: { onClose: () => void; onSave: (rule: VaultRule) => Promise<boolean> }) {
  const [domain, setDomain] = useState('');
  const [category, setCategory] = useState('shopping');
  const [action, setAction] = useState('find_item');
  const [sensitivity, setSensitivity] = useState<'low' | 'medium' | 'high'>('medium');
  const [fields, setFields] = useState('');
  const [duration, setDuration] = useState('180');
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = (): boolean => {
    const next: Record<string, string> = {};
    if (!domain.trim()) next.domain = 'This field is required';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSave = async () => {
    if (!validate() || saving) return;
    setSaving(true);
    const expiresAt = new Date(Date.now() + parseInt(duration, 10) * 24 * 60 * 60 * 1000).toISOString();
    const ok = await onSave({
      id: 'rule_' + crypto.randomUUID().slice(0, 8),
      recipientDomain: domain.trim(),
      purposeCategory: category,
      purposeAction: action,
      maxSensitivity: sensitivity,
      allowedFields: fields.split(',').map((f) => f.trim()).filter(Boolean),
      expiresAt,
      enabled: true,
    });
    if (!ok) setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="create-rule-title" className="glass-card p-6 w-full max-w-lg relative" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} aria-label="Close" className="absolute top-4 right-4 text-text-tertiary hover:text-white transition-colors">
          <X className="w-5 h-5" />
        </button>

        <h2 id="create-rule-title" className="text-xl font-bold text-white mb-1">Create Rule</h2>
        <p className="text-text-tertiary text-sm mb-6">Allow a domain to access specific context automatically.</p>

        <div className="space-y-4">
          <div>
            <label htmlFor="rule-domain" className="text-text-secondary text-sm mb-1.5 block">Domain</label>
            <input id="rule-domain" type="text" value={domain} onChange={(e) => { setDomain(e.target.value); setErrors((prev) => { const next = { ...prev }; delete next.domain; return next; }) }} placeholder="e.g., nordstrom.com"
              className={`w-full px-4 py-2.5 bg-card border rounded-lg text-white placeholder-text-tertiary focus:outline-none focus:border-accent/50 text-sm ${errors.domain ? 'border-red-400/70' : 'border-card-border/50'}`} />
            {errors.domain && <p className="text-red-400 text-xs mt-1">{errors.domain}</p>}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="rule-category" className="text-text-secondary text-sm mb-1.5 block">Category</label>
              <select id="rule-category" value={category} onChange={(e) => setCategory(e.target.value)}
                className="w-full px-4 py-2.5 bg-card border border-card-border/50 rounded-lg text-white focus:outline-none focus:border-accent/50 text-sm">
                <option value="shopping">Shopping</option>
                <option value="travel">Travel</option>
                <option value="food">Food & Dining</option>
                <option value="fitness">Fitness</option>
                <option value="gifts">Gift Giving</option>
              </select>
            </div>
            <div>
              <label htmlFor="rule-action" className="text-text-secondary text-sm mb-1.5 block">Action</label>
              <select id="rule-action" value={action} onChange={(e) => setAction(e.target.value)}
                className="w-full px-4 py-2.5 bg-card border border-card-border/50 rounded-lg text-white focus:outline-none focus:border-accent/50 text-sm">
                <option value="find_item">Find Item</option>
                <option value="checkout">Checkout</option>
                <option value="recommend">Recommend</option>
                <option value="book">Book</option>
                <option value="sync_data">Sync Data</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="rule-sensitivity" className="text-text-secondary text-sm mb-1.5 block">Max Sensitivity</label>
              <select id="rule-sensitivity" value={sensitivity} onChange={(e) => setSensitivity(e.target.value as 'low' | 'medium' | 'high')}
                className="w-full px-4 py-2.5 bg-card border border-card-border/50 rounded-lg text-white focus:outline-none focus:border-accent/50 text-sm">
                <option value="low">🟢 Low only</option>
                <option value="medium">🟡 Up to Medium</option>
                <option value="high">🔴 Up to High</option>
              </select>
            </div>
            <div>
              <label htmlFor="rule-duration" className="text-text-secondary text-sm mb-1.5 block">Expires in (days)</label>
              <select id="rule-duration" value={duration} onChange={(e) => setDuration(e.target.value)}
                className="w-full px-4 py-2.5 bg-card border border-card-border/50 rounded-lg text-white focus:outline-none focus:border-accent/50 text-sm">
                <option value="30">30 days</option>
                <option value="90">90 days</option>
                <option value="180">180 days</option>
                <option value="365">1 year</option>
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="rule-fields" className="text-text-secondary text-sm mb-1.5 block">
              Allowed Fields <span className="text-text-tertiary">(click to add, or type custom patterns)</span>
            </label>
            <input id="rule-fields" type="text" value={fields} onChange={(e) => setFields(e.target.value)} placeholder="e.g., apparel.pants.*, budget.*"
              className="w-full px-4 py-2.5 bg-card border border-card-border/50 rounded-lg text-white placeholder-text-tertiary focus:outline-none focus:border-accent/50 text-sm font-mono" />
            <div className="flex flex-wrap gap-1.5 mt-2">
              {COMMON_FIELD_PATTERNS.filter(p => !fields.split(',').map(f => f.trim()).includes(p)).slice(0, 12).map(p => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setFields(prev => prev ? `${prev}, ${p}` : p)}
                  className="text-xs px-3 py-2 min-h-[44px] rounded-md bg-white/[0.06] border border-card-border/30 text-text-tertiary hover:text-white hover:border-accent/40 transition-colors font-mono touch-manipulation"
                >
                  + {p}
                </button>
              ))}
            </div>
            <p className="text-text-tertiary text-xs mt-1.5">
              {fields.trim() ? `${fields.split(',').filter(f => f.trim()).length} field pattern(s) selected` : 'Empty = allow all fields matching the category. Add patterns to restrict.'}
            </p>
          </div>
          <div className="flex items-start gap-2 p-3 bg-yellow-400/5 border border-yellow-400/20 rounded-lg">
            <AlertTriangle className="w-4 h-4 text-yellow-400 mt-0.5 flex-shrink-0" />
            <p className="text-yellow-400/80 text-sm">
              This rule will auto-release matching data without asking you. Review the fields carefully.
            </p>
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <button onClick={onClose}
            className="flex-1 px-4 py-2.5 border border-card-border/50 rounded-lg text-text-secondary hover:text-white hover:border-accent/40 text-sm font-medium transition-colors">
            Cancel
          </button>
          <button onClick={handleSave} disabled={!domain.trim() || saving}
            className="flex-1 px-4 py-2.5 bg-primary hover:bg-primary/90 text-white rounded-lg text-sm font-medium transition-colors shadow-glow disabled:opacity-40 disabled:cursor-not-allowed">
            {saving ? 'Creating…' : 'Create Rule'}
          </button>
        </div>
      </div>
    </div>
  );
}

function EditRuleModal({ rule, onClose, onSave }: { rule: VaultRule; onClose: () => void; onSave: (rule: VaultRule) => Promise<boolean> }) {
  const [sensitivity, setSensitivity] = useState(rule.maxSensitivity);
  const [fields, setFields] = useState(rule.allowedFields.join(', '));
  const [duration, setDuration] = useState(() => {
    const days = Math.ceil((new Date(rule.expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    if (days <= 30) return '30';
    if (days <= 90) return '90';
    if (days <= 180) return '180';
    return '365';
  });
  const [durationTouched, setDurationTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    const expiresAt = durationTouched
      ? new Date(Date.now() + parseInt(duration, 10) * 24 * 60 * 60 * 1000).toISOString()
      : rule.expiresAt;
    const ok = await onSave({
      ...rule,
      maxSensitivity: sensitivity,
      allowedFields: fields.split(',').map((f) => f.trim()).filter(Boolean),
      expiresAt,
    });
    if (!ok) setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="edit-rule-title" className="glass-card p-6 w-full max-w-lg relative" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} aria-label="Close" className="absolute top-4 right-4 text-text-tertiary hover:text-white transition-colors">
          <X className="w-5 h-5" />
        </button>

        <h2 id="edit-rule-title" className="text-xl font-bold text-white mb-1">Edit Rule</h2>
        <p className="text-text-tertiary text-sm mb-4">
          {rule.recipientDomain} — {formatEventAction(rule.purposeCategory)} &gt; {formatEventAction(rule.purposeAction)}
        </p>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-text-secondary text-sm mb-1.5 block">Max Sensitivity</label>
              <select value={sensitivity} onChange={(e) => setSensitivity(e.target.value as 'low' | 'medium' | 'high')}
                className="w-full px-4 py-2.5 bg-card border border-card-border/50 rounded-lg text-white focus:outline-none focus:border-accent/50 text-sm">
                <option value="low">🟢 Low only</option>
                <option value="medium">🟡 Up to Medium</option>
                <option value="high">🔴 Up to High</option>
              </select>
            </div>
            <div>
              <label className="text-text-secondary text-sm mb-1.5 block">Extend Duration</label>
              <select value={duration} onChange={(e) => {
                setDuration(e.target.value);
                setDurationTouched(true);
              }}
                className="w-full px-4 py-2.5 bg-card border border-card-border/50 rounded-lg text-white focus:outline-none focus:border-accent/50 text-sm">
                <option value="30">30 days</option>
                <option value="90">90 days</option>
                <option value="180">180 days</option>
                <option value="365">1 year</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-text-secondary text-sm mb-1.5 block">
              Allowed Fields <span className="text-text-tertiary">(click to add, or type custom patterns)</span>
            </label>
            <input type="text" value={fields} onChange={(e) => setFields(e.target.value)} placeholder="e.g., apparel.pants.*, budget.*"
              className="w-full px-4 py-2.5 bg-card border border-card-border/50 rounded-lg text-white placeholder-text-tertiary focus:outline-none focus:border-accent/50 text-sm font-mono" />
            <div className="flex flex-wrap gap-1.5 mt-2">
              {COMMON_FIELD_PATTERNS.filter(p => !fields.split(',').map(f => f.trim()).includes(p)).slice(0, 12).map(p => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setFields(prev => prev ? `${prev}, ${p}` : p)}
                  className="text-xs px-3 py-2 min-h-[44px] rounded-md bg-white/[0.06] border border-card-border/30 text-text-tertiary hover:text-white hover:border-accent/40 transition-colors font-mono touch-manipulation"
                >
                  + {p}
                </button>
              ))}
            </div>
            <p className="text-text-tertiary text-xs mt-1.5">
              {fields.trim() ? `${fields.split(',').filter(f => f.trim()).length} field pattern(s) selected` : 'Empty = allow all fields matching the category. Add patterns to restrict.'}
            </p>
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <button onClick={onClose}
            className="flex-1 px-4 py-2.5 border border-card-border/50 rounded-lg text-text-secondary hover:text-white hover:border-accent/40 text-sm font-medium transition-colors">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 px-4 py-2.5 bg-primary hover:bg-primary/90 text-white rounded-lg text-sm font-medium transition-colors shadow-glow disabled:opacity-40 disabled:cursor-not-allowed">
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
