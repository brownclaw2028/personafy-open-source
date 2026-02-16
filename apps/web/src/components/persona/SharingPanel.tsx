import {
  Share2,
  CheckCircle,
  XCircle,
  Zap,
  Clock,
} from 'lucide-react';
import type { VaultAuditEvent } from '../../lib/VaultProvider';
import { formatPurposeDisplay } from '../../lib/utils';

export function SharingPanel({
  history,
  personaFactKeys,
}: {
  history: VaultAuditEvent[];
  personaFactKeys: Set<string>;
}) {
  if (history.length === 0) {
    return (
      <div className="glass-card p-12 text-center animate-fade-in">
        <Share2 className="w-12 h-12 text-text-tertiary mx-auto mb-4" />
        <h3 className="text-white font-medium mb-2">No sharing history</h3>
        <p className="text-text-tertiary text-sm">
          When agents request facts from this persona, the history will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 animate-fade-in">
      {history.map((event) => {
        const isApproved = event.decision === 'ask_approved' || event.decision === 'allow';
        const isAuto = event.decision === 'allow';
        const matchedFields = event.fieldsReleased.filter((f) => personaFactKeys.has(f));
        const ts = new Date(event.timestamp);
        const timeStr = ts.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

        return (
          <div key={event.id} className="glass-card p-5 hover:border-accent/20 transition-all">
            <div className="flex items-start gap-4">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                isApproved ? (isAuto ? 'bg-primary/10' : 'bg-accent/10') : 'bg-red-400/10'
              }`}>
                {isApproved ? (
                  isAuto ? <Zap className="w-5 h-5 text-primary" /> : <CheckCircle className="w-5 h-5 text-accent" />
                ) : (
                  <XCircle className="w-5 h-5 text-red-400" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-white font-medium">{event.recipientDomain}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    isApproved
                      ? isAuto ? 'bg-primary/10 text-primary' : 'bg-accent/10 text-accent'
                      : 'bg-red-400/10 text-red-400'
                  }`}>
                    {isAuto ? 'Auto-allowed' : isApproved ? 'Approved' : 'Denied'}
                  </span>
                </div>
                <div className="text-text-tertiary text-sm mb-2">
                  {formatPurposeDisplay(event.purpose)}
                </div>
                {/* Show which facts from this persona were shared */}
                <div className="flex flex-wrap gap-1.5">
                  {matchedFields.map((field) => (
                    <code key={field} className="text-xs px-2 py-1 bg-white/[0.10] border border-card-border/35 rounded text-text-secondary font-mono">
                      {field}
                    </code>
                  ))}
                  {event.fieldsReleased.length > matchedFields.length && (
                    <span className="text-text-tertiary text-xs self-center">
                      +{event.fieldsReleased.length - matchedFields.length} from other personas
                    </span>
                  )}
                </div>
              </div>
              <div className="text-text-tertiary text-xs flex items-center gap-1 flex-shrink-0">
                <Clock className="w-3 h-3" />
                {timeStr}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
