import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Shield,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Clock,
  ArrowLeft,
  User,
  Target,
  FileText,
  Lock,
  Eye,
  EyeOff,
} from 'lucide-react';
import { useVault, type VaultAuditEvent, type VaultRule } from '../lib/VaultProvider';
import type { PendingApproval } from '../lib/vault';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { toast } from '../components/Toast';
import { createRuleCreatedAuditEvent } from '../lib/utils';

/**
 * Pending approval request structure.
 * In a full implementation, this would come from a pending requests queue.
 * For MVP, we derive mock data from URL params or show a test request.
 */
interface PendingRequest {
  id: string;
  recipientDomain: string;
  recipientName?: string;
  purpose: string;
  purposeCategory: string;
  purposeAction: string;
  requestedFields: RequestedField[];
  createdAt: string;
  expiresAt: string;
}

interface RequestedField {
  key: string;
  displayName: string;
  value: string;
  sensitivity: 'low' | 'medium' | 'high';
  personaName?: string;
}

const sensitivityConfig = {
  low: {
    label: 'Low',
    color: 'text-accent',
    bg: 'bg-accent/15',
    border: 'border-accent/30',
    icon: Eye,
  },
  medium: {
    label: 'Medium',
    color: 'text-yellow-400',
    bg: 'bg-yellow-400/15',
    border: 'border-yellow-400/30',
    icon: Eye,
  },
  high: {
    label: 'High',
    color: 'text-red-400',
    bg: 'bg-red-400/15',
    border: 'border-red-400/30',
    icon: EyeOff,
  },
};

/**
 * Generate a mock pending request for testing/demo purposes.
 * In production, this would fetch from a pending requests API.
 */
function getMockPendingRequest(requestId: string): PendingRequest | null {
  // Return a realistic-looking test request
  if (!requestId || requestId === 'invalid') return null;

  return {
    id: requestId,
    recipientDomain: 'shopping-assistant.ai',
    recipientName: 'Shopping Assistant',
    purpose: 'shopping/product_recommendation',
    purposeCategory: 'shopping',
    purposeAction: 'product_recommendation',
    requestedFields: [
      {
        key: 'shopping.clothing_sizes',
        displayName: 'Clothing Sizes',
        value: 'Medium (M), 32W pants',
        sensitivity: 'low',
        personaName: 'Shopping',
      },
      {
        key: 'shopping.preferred_brands',
        displayName: 'Preferred Brands',
        value: 'Nike, Patagonia, Uniqlo',
        sensitivity: 'low',
        personaName: 'Shopping',
      },
      {
        key: 'shopping.style_preference',
        displayName: 'Style Preference',
        value: 'Casual, minimalist',
        sensitivity: 'low',
        personaName: 'Shopping',
      },
      {
        key: 'shopping.budget_range',
        displayName: 'Budget Range',
        value: '$50-150 per item',
        sensitivity: 'medium',
        personaName: 'Shopping',
      },
      {
        key: 'location.shipping_address',
        displayName: 'Shipping Address',
        value: '123 Main St, City, ST 12345',
        sensitivity: 'high',
        personaName: 'Shopping',
      },
    ],
    createdAt: new Date(Date.now() - 60000).toISOString(), // 1 min ago
    expiresAt: new Date(Date.now() + 14 * 60000).toISOString(), // expires in 14 min
  };
}

export function ApprovalDetail() {
  const { requestId } = useParams<{ requestId: string }>();
  const navigate = useNavigate();
  const { vault, save } = useVault();

  useDocumentTitle('Approve Request');

  const [processing, setProcessing] = useState(false);
  const [hiddenFields, setHiddenFields] = useState<Set<string>>(new Set());
  const [rememberChoice, setRememberChoice] = useState(false);

  // Get pending request from real vault data if available, otherwise fallback to mock for dev
  const pendingRequest = useMemo(() => {
    if (vault?.approvalQueue && requestId) {
      const entry = vault.approvalQueue.find((e: PendingApproval) => e.id === requestId);
      if (entry) {
        // Map extension type to web app view type
        return {
          id: entry.id,
          recipientDomain: entry.request.agentId, // Extension uses agentId as recipient for now
          recipientName: entry.request.agentId,
          purpose: entry.request.purpose,
          purposeCategory: entry.request.persona,
          purposeAction: entry.request.purpose,
          requestedFields: entry.request.fields.map((f: string) => ({
            key: f,
            displayName: f.split('.').pop() || f,
            value: 'Value hidden until approval', // Web app doesn't see values until approved in some models
            sensitivity: 'medium', // Default to medium
            personaName: entry.request.persona,
          })),
          createdAt: new Date(entry.createdAtMs).toISOString(),
          expiresAt: new Date(entry.expiresAtMs).toISOString(),
        } as PendingRequest;
      }
    }
    return getMockPendingRequest(requestId || '');
  }, [vault, requestId]);

  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!pendingRequest) return;
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [pendingRequest]);

  // Check if this request was already decided
  const existingDecision =
    requestId && vault?.auditLog
      ? vault.auditLog.find((e) => e.requestId === requestId) ?? null
      : null;

  const toggleFieldHidden = (fieldKey: string) => {
    setHiddenFields((prev) => {
      const next = new Set(prev);
      if (next.has(fieldKey)) {
        next.delete(fieldKey);
      } else {
        next.add(fieldKey);
      }
      return next;
    });
  };

  const handleApprove = async () => {
    if (!vault || !pendingRequest || processing) return;

    setProcessing(true);

    // Fields to release (exclude hidden fields)
    const fieldsToRelease = pendingRequest.requestedFields
      .filter((f) => !hiddenFields.has(f.key))
      .map((f) => f.key);

    const auditEvent: VaultAuditEvent = {
      id: 'audit_' + crypto.randomUUID().slice(0, 8),
      timestamp: new Date().toISOString(),
      requestId: pendingRequest.id,
      decision: 'ask_approved',
      recipientDomain: pendingRequest.recipientDomain,
      purpose: pendingRequest.purpose,
      fieldsReleased: fieldsToRelease,
    };

    // Optionally create an auto-allow rule for future requests
    const updatedRules = [...(vault.rules || [])];
    const updatedAuditLog = [...vault.auditLog, auditEvent];

    if (rememberChoice) {
      const newRule: VaultRule = {
        id: 'rule_' + crypto.randomUUID().slice(0, 8),
        recipientDomain: pendingRequest.recipientDomain,
        purposeCategory: pendingRequest.purposeCategory,
        purposeAction: pendingRequest.purposeAction,
        maxSensitivity: 'medium',
        allowedFields: fieldsToRelease,
        expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(), // 90 days
        enabled: true,
      };
      updatedRules.push(newRule);
      updatedAuditLog.push(createRuleCreatedAuditEvent({
        requestId: pendingRequest.id,
        recipientDomain: newRule.recipientDomain,
        purposeCategory: newRule.purposeCategory,
        purposeAction: newRule.purposeAction,
        allowedFields: newRule.allowedFields,
      }));
    }

    // Update approval queue entry status
    const updatedQueue = (vault.approvalQueue || []).map((e: PendingApproval) =>
      e.id === pendingRequest.id
        ? { ...e, status: 'approved' as const, resolvedAtMs: Date.now() }
        : e
    );

    const ok = await save({
      ...vault,
      rules: updatedRules,
      auditLog: updatedAuditLog,
      approvalQueue: updatedQueue,
    });

    if (ok) {
      toast(rememberChoice
        ? 'Request approved. Rule created for future requests.'
        : 'Request approved. Data shared with agent.');
      setTimeout(() => navigate('/approvals'), 1000);
    } else {
      setProcessing(false);
      toast('Failed to approve request. Please try again.', 'error');
    }
  };

  const handleDeny = async () => {
    if (!vault || !pendingRequest || processing) return;

    setProcessing(true);

    const auditEvent: VaultAuditEvent = {
      id: 'audit_' + crypto.randomUUID().slice(0, 8),
      timestamp: new Date().toISOString(),
      requestId: pendingRequest.id,
      decision: 'ask_denied',
      recipientDomain: pendingRequest.recipientDomain,
      purpose: pendingRequest.purpose,
      fieldsReleased: [],
    };

    const ok = await save({
      ...vault,
      auditLog: [...vault.auditLog, auditEvent],
    });

    setProcessing(false);

    if (ok) {
      toast('Request successfully denied. No data was shared.');
      setTimeout(() => navigate('/approvals'), 1000);
    } else {
      toast('Failed to deny request. Please try again.', 'error');
    }
  };

  // Group fields by sensitivity
  const fieldsBySensitivity = useMemo(() => {
    if (!pendingRequest) return { low: [], medium: [], high: [] };
    const groups: Record<'low' | 'medium' | 'high', RequestedField[]> = {
      low: [],
      medium: [],
      high: [],
    };
    for (const field of pendingRequest.requestedFields) {
      groups[field.sensitivity].push(field);
    }
    return groups;
  }, [pendingRequest]);

  // Calculate time remaining
  const timeRemaining = useMemo(() => {
    if (!pendingRequest) return null;
    const expires = new Date(pendingRequest.expiresAt).getTime();
    const diff = expires - nowMs;
    if (diff <= 0) return 'Expired';
    const mins = Math.floor(diff / 60000);
    const secs = Math.floor((diff % 60000) / 1000);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }, [pendingRequest, nowMs]);

  // Already decided view
  if (existingDecision) {
    const isApproved =
      existingDecision.decision === 'ask_approved' ||
      existingDecision.decision === 'allow';
    return (
      <div className="min-h-screen bg-background flex flex-col">
        {/* Header */}
        <header className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-card-border/35 px-4 py-3">
          <div className="flex items-center gap-3 max-w-lg mx-auto">
            <button
              onClick={() => navigate('/approvals')}
              className="p-2 -ml-2 text-text-tertiary hover:text-white transition-colors touch-manipulation min-h-[44px] min-w-[44px] flex items-center justify-center"
              aria-label="Back to approvals"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h1 className="text-lg font-semibold text-white">
              Request {isApproved ? 'Approved' : 'Denied'}
            </h1>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 p-4">
          <div className="max-w-lg mx-auto">
            <div className="glass-card p-8 text-center">
              {isApproved ? (
                <CheckCircle className="w-16 h-16 text-accent mx-auto mb-4" />
              ) : (
                <XCircle className="w-16 h-16 text-red-400 mx-auto mb-4" />
              )}
              <h2 className="text-xl font-semibold text-white mb-2">
                {isApproved ? 'Request Approved' : 'Request Denied'}
              </h2>
              <p className="text-text-secondary mb-6">
                Decided on{' '}
                {new Date(existingDecision.timestamp).toLocaleString()}
              </p>
              <button
                onClick={() => navigate('/approvals')}
                className="w-full py-3.5 bg-primary text-white rounded-xl font-medium touch-manipulation min-h-[48px] active:scale-[0.98] transition-transform"
              >
                View All Approvals
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // Invalid/expired request view
  if (!pendingRequest) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        {/* Header */}
        <header className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-card-border/35 px-4 py-3">
          <div className="flex items-center gap-3 max-w-lg mx-auto">
            <button
              onClick={() => navigate('/')}
              className="p-2 -ml-2 text-text-tertiary hover:text-white transition-colors touch-manipulation min-h-[44px] min-w-[44px] flex items-center justify-center"
              aria-label="Go home"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h1 className="text-lg font-semibold text-white">
              Request Not Found
            </h1>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 p-4">
          <div className="max-w-lg mx-auto">
            <div className="glass-card p-8 text-center">
              <AlertTriangle className="w-16 h-16 text-yellow-400 mx-auto mb-4" />
              <h2 className="text-xl font-semibold text-white mb-2">
                Request not found or expired
              </h2>
              <p className="text-text-secondary mb-6">
                This approval link may have expired or the request ID is
                invalid.
              </p>
              <button
                onClick={() => navigate('/')}
                className="w-full py-3.5 bg-primary text-white rounded-xl font-medium touch-manipulation min-h-[48px] active:scale-[0.98] transition-transform"
              >
                Go to Dashboard
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  const activeFieldCount =
    pendingRequest.requestedFields.length - hiddenFields.size;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header - sticky on mobile */}
      <header className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-card-border/35 px-4 py-3">
        <div className="flex items-center gap-3 max-w-lg mx-auto">
          <button
            onClick={() => navigate('/approvals')}
            className="p-2 -ml-2 text-text-tertiary hover:text-white transition-colors touch-manipulation min-h-[44px] min-w-[44px] flex items-center justify-center"
            aria-label="Back to approvals"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-semibold text-white truncate">
              {pendingRequest.recipientName || pendingRequest.recipientDomain}
            </h1>
            <p className="text-text-tertiary text-xs truncate">wants access to your data</p>
          </div>
          {timeRemaining && (
            <div className="flex items-center gap-1.5 text-yellow-400 text-sm">
              <Clock className="w-4 h-4" />
              <span className="font-mono">{timeRemaining}</span>
            </div>
          )}
        </div>
      </header>

      {/* Scrollable content area */}
      <main className="flex-1 overflow-auto pb-32">
        <div className="max-w-lg mx-auto px-4 py-6 space-y-6">
          {/* Recipient Card */}
          <section className="glass-card p-4" aria-labelledby="recipient-heading">
            <h2 id="recipient-heading" className="sr-only">
              Requesting Agent
            </h2>
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 bg-primary/15 rounded-2xl flex items-center justify-center flex-shrink-0">
                <User className="w-7 h-7 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-white font-semibold text-lg truncate">
                  {pendingRequest.recipientName || pendingRequest.recipientDomain}
                </div>
                <div className="text-text-tertiary text-sm truncate">
                  {pendingRequest.recipientDomain}
                </div>
              </div>
            </div>
          </section>

          {/* Purpose Card */}
          <section className="glass-card p-4" aria-labelledby="purpose-heading">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-accent/15 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5">
                <Target className="w-5 h-5 text-accent" />
              </div>
              <div>
                <h2
                  id="purpose-heading"
                  className="text-text-tertiary text-xs uppercase tracking-wider mb-1"
                >
                  Purpose
                </h2>
                <div className="text-white font-medium">
                  {pendingRequest.purposeCategory
                    .charAt(0)
                    .toUpperCase() + pendingRequest.purposeCategory.slice(1)}{' '}
                  →{' '}
                  {pendingRequest.purposeAction
                    .replace(/_/g, ' ')
                    .replace(/\b\w/g, (c) => c.toUpperCase())}
                </div>
              </div>
            </div>
          </section>

          {/* Fields to Share */}
          <section aria-labelledby="fields-heading">
            <div className="flex items-center gap-2 mb-3">
              <FileText className="w-4 h-4 text-text-tertiary" />
              <h2
                id="fields-heading"
                className="text-text-tertiary text-xs uppercase tracking-wider"
              >
                Fields to Share ({activeFieldCount})
              </h2>
            </div>
            <p className="text-text-secondary text-sm mb-4">
              Tap a field to exclude it from this request.
            </p>

            <div className="space-y-4">
              {/* High sensitivity fields first with warning */}
              {fieldsBySensitivity.high.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-red-400 text-sm font-medium">
                    <Lock className="w-4 h-4" />
                    <span>High Sensitivity</span>
                  </div>
                  <div className="space-y-2">
                    {fieldsBySensitivity.high.map((field) => (
                      <FieldToggle
                        key={field.key}
                        field={field}
                        hidden={hiddenFields.has(field.key)}
                        onToggle={() => toggleFieldHidden(field.key)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Medium sensitivity */}
              {fieldsBySensitivity.medium.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-yellow-400 text-sm font-medium">
                    <Shield className="w-4 h-4" />
                    <span>Medium Sensitivity</span>
                  </div>
                  <div className="space-y-2">
                    {fieldsBySensitivity.medium.map((field) => (
                      <FieldToggle
                        key={field.key}
                        field={field}
                        hidden={hiddenFields.has(field.key)}
                        onToggle={() => toggleFieldHidden(field.key)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Low sensitivity */}
              {fieldsBySensitivity.low.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-accent text-sm font-medium">
                    <Eye className="w-4 h-4" />
                    <span>Low Sensitivity</span>
                  </div>
                  <div className="space-y-2">
                    {fieldsBySensitivity.low.map((field) => (
                      <FieldToggle
                        key={field.key}
                        field={field}
                        hidden={hiddenFields.has(field.key)}
                        onToggle={() => toggleFieldHidden(field.key)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
      </main>

      {/* Fixed bottom action buttons */}
      <footer className="fixed bottom-0 left-0 right-0 bg-background/95 backdrop-blur-sm border-t border-card-border/35 px-4 py-3 safe-area-inset-bottom">
        <div className="max-w-lg mx-auto">
          {/* Remember checkbox */}
          <label className="flex items-center gap-2 mb-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={rememberChoice}
              onChange={(e) => setRememberChoice(e.target.checked)}
              className="w-4 h-4 rounded border-card-border/50 bg-card text-accent focus:ring-accent/30"
            />
            <span className="text-sm text-text-secondary group-hover:text-white transition-colors">
              Remember this choice for future requests from {pendingRequest?.recipientDomain}
            </span>
          </label>
        </div>
        <div className="max-w-lg mx-auto flex gap-3">
          <button
            onClick={handleDeny}
            disabled={processing}
            className="flex-1 py-4 bg-card border border-red-400/30 text-red-400 rounded-xl font-semibold text-base touch-manipulation min-h-[56px] active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            aria-label="Deny this request"
          >
            <XCircle className="w-5 h-5" />
            Deny
          </button>
          <button
            onClick={handleApprove}
            disabled={processing || activeFieldCount === 0}
            className="flex-[2] py-4 bg-accent text-white rounded-xl font-semibold text-base touch-manipulation min-h-[56px] active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-glow"
            aria-label={`Approve and share ${activeFieldCount} fields`}
          >
            <CheckCircle className="w-5 h-5" />
            {processing
              ? 'Processing...'
              : `Approve (${activeFieldCount} fields)`}
          </button>
        </div>
      </footer>
    </div>
  );
}

/* ---- Sub-components ---- */

function FieldToggle({
  field,
  hidden,
  onToggle,
}: {
  field: RequestedField;
  hidden: boolean;
  onToggle: () => void;
}) {
  const config = sensitivityConfig[field.sensitivity];
  const Icon = config.icon;

  return (
    <button
      onClick={onToggle}
      className={`w-full p-4 rounded-xl border transition-all touch-manipulation min-h-[72px] text-left ${
        hidden
          ? 'bg-white/[0.08] border-card-border/35 opacity-60'
          : `bg-white/[0.10] ${config.border}`
      }`}
      aria-pressed={!hidden}
      aria-label={`${field.displayName}: ${hidden ? 'excluded' : 'included'}`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors ${
            hidden ? 'bg-white/[0.05]' : config.bg
          }`}
        >
          {hidden ? (
            <EyeOff className="w-5 h-5 text-text-tertiary" />
          ) : (
            <Icon className={`w-5 h-5 ${config.color}`} />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span
              className={`font-medium ${hidden ? 'text-text-tertiary line-through' : 'text-white'}`}
            >
              {field.displayName}
            </span>
            {!hidden && (
              <span
                className={`text-xs px-2 py-0.5 rounded-full ${config.bg} ${config.color}`}
              >
                {config.label}
              </span>
            )}
          </div>
          <div
            className={`text-sm truncate ${hidden ? 'text-text-tertiary' : 'text-text-secondary'}`}
          >
            {field.value}
          </div>
          {field.personaName && (
            <div className="text-xs text-text-tertiary mt-1">
              From: {field.personaName} persona
            </div>
          )}
        </div>
        <div className="flex-shrink-0 self-center">
          <div
            className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${
              hidden
                ? 'border-text-tertiary/30'
                : 'border-accent bg-accent'
            }`}
          >
            {!hidden && <CheckCircle className="w-4 h-4 text-white" />}
          </div>
        </div>
      </div>
    </button>
  );
}

export default ApprovalDetail;
