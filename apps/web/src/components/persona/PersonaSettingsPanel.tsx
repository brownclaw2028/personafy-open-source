import { useState, useRef, useEffect } from 'react';
import { Shield } from 'lucide-react';
import type { PersonaSettings, AutoReleasePolicy, RetentionPeriod } from '../../lib/VaultProvider';

const DEFAULT_SETTINGS: PersonaSettings = {
  visible: true,
  autoRelease: 'follow_posture',
  retention: 'never',
};

const autoReleasePolicies: { value: AutoReleasePolicy; label: string; description: string }[] = [
  { value: 'follow_posture', label: 'Follow vault posture', description: 'Use the global privacy posture settings' },
  { value: 'always_ask', label: 'Always ask', description: 'Require approval for every request to this persona' },
  { value: 'auto_low', label: 'Auto-release low sensitivity', description: 'Only ask for medium and high sensitivity facts' },
];

const retentionOptions: { value: RetentionPeriod; label: string }[] = [
  { value: 'never', label: 'Never expire' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '180', label: '180 days' },
  { value: '365', label: '1 year' },
];

export function PersonaSettingsPanel({
  personaName,
  settings,
  onSave,
}: {
  personaName: string;
  settings?: PersonaSettings;
  onSave: (settings: PersonaSettings) => Promise<void>;
}) {
  const resolved = settings ?? DEFAULT_SETTINGS;
  // Local state for immediate optimistic UI; debounce the save.
  const [local, setLocal] = useState<PersonaSettings>(resolved);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestLocalRef = useRef<PersonaSettings>(resolved);

  const current = local;

  useEffect(() => {
    latestLocalRef.current = local;
  }, [local]);

  // Flush pending debounced save on unmount so the last change isn't dropped.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        void onSave(latestLocalRef.current);
      }
    };
  }, [onSave]);

  const update = (patch: Partial<PersonaSettings>) => {
    const next = { ...current, ...patch };
    setLocal(next);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      void onSave(next);
    }, 600);
  };

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Visibility toggle */}
      <div className="glass-card p-5">
        <h3 className="text-white font-medium mb-1">Persona Visibility</h3>
        <p className="text-text-tertiary text-sm mb-4">
          Control whether this persona is visible to agents when they request context.
        </p>
        <div className="flex items-center justify-between">
          <span className="text-text-secondary text-sm">Allow agents to see {personaName}</span>
          <button
            type="button"
            role="switch"
            aria-checked={current.visible}
            onClick={() => update({ visible: !current.visible })}
            className={`relative w-11 h-6 rounded-full transition-colors ${
              current.visible ? 'bg-accent' : 'bg-card border border-card-border/50'
            }`}
          >
            <div
              className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                current.visible ? 'translate-x-[22px]' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>
        {!current.visible && (
          <div className="mt-3 p-3 bg-yellow-400/5 border border-yellow-400/20 rounded-lg flex items-start gap-2">
            <Shield className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" />
            <p className="text-yellow-400/80 text-xs">
              This persona is hidden from agents. No facts will be shared until you re-enable visibility.
            </p>
          </div>
        )}
      </div>

      {/* Auto-release policy */}
      <div className="glass-card p-5">
        <h3 className="text-white font-medium mb-1">Auto-release Policy</h3>
        <p className="text-text-tertiary text-sm mb-4">
          Control how facts from this persona are released to agents.
        </p>
        <div className="space-y-3">
          {autoReleasePolicies.map((policy) => (
            <label key={policy.value} className="flex items-center gap-3 cursor-pointer group">
              <input
                type="radio"
                name="auto-release"
                checked={current.autoRelease === policy.value}
                onChange={() => update({ autoRelease: policy.value })}
                className="w-4 h-4 text-accent bg-transparent border-2 border-card-border/50 focus:ring-accent focus:ring-2"
              />
              <div>
                <div className="text-white text-sm group-hover:text-accent transition-colors">{policy.label}</div>
                <div className="text-text-tertiary text-xs">{policy.description}</div>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Data retention */}
      <div className="glass-card p-5">
        <h3 className="text-white font-medium mb-1">Data Retention</h3>
        <p className="text-text-tertiary text-sm mb-4">
          How long to keep facts in this persona before requiring re-confirmation.
        </p>
        <select
          value={current.retention}
          onChange={(e) => update({ retention: e.target.value as RetentionPeriod })}
          className="px-3 py-2 bg-card border border-card-border/50 rounded-lg text-white text-sm focus:outline-none focus:border-accent/50 w-full"
        >
          {retentionOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
