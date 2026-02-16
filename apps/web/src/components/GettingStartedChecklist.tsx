import { useState } from 'react';
import {
  CheckCircle,
  Circle,
  X,
  Sparkles,
  Upload,
  Play,
  Lock,
} from 'lucide-react';
import { useVault } from '../lib/VaultProvider';

interface GettingStartedChecklistProps {
  onNavClick?: (itemId: string) => void;
  onDismiss: () => void;
}

interface ChecklistItem {
  id: string;
  label: string;
  description?: string;
  icon: React.ReactNode;
  completed: boolean;
  action?: string; // navClick target
}

const DISMISS_KEY = 'personafy_getting_started_dismissed';

export function GettingStartedChecklist({ onNavClick, onDismiss }: GettingStartedChecklistProps) {
  const { vault } = useVault();
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(DISMISS_KEY) === 'true',
  );

  // Compute initial collapsed state: collapse when user has completed steps beyond vault creation.
  // "vault created" is always done (1), so if any other step is done, start collapsed.
  // Also collapse if there are any persona facts (user has real data, beyond onboarding).
  const [expanded, setExpanded] = useState(() => {
    const anyFacts = vault?.personas?.some(p => p.facts.length > 0) ?? false;
    const hasImport = vault?.personas?.some(p => p.facts.some(f => f.source && f.source !== 'quickstart')) ?? false;
    const demoV = localStorage.getItem('personafy_demo_visited') === 'true';
    // 1 = vault created (always true). If total > 1, user has progressed — start collapsed.
    const done = 1 + (anyFacts ? 1 : 0) + (hasImport ? 1 : 0) + (demoV ? 1 : 0);
    return done <= 1;
  });

  if (dismissed) return null;

  // Completion detection — any persona with facts counts as having answered questions,
  // not just quickstart-sourced facts. Users who import data have already exceeded this step.
  const hasAnyFacts = vault?.personas?.some(p => p.facts.length > 0) ?? false;

  const hasQuickstartFacts = hasAnyFacts || (vault?.personas?.some(p =>
    p.facts.some(f => f.source === 'quickstart'),
  ) ?? false);

  const hasImportedPersonas = vault?.personas?.some(p =>
    p.facts.some(f => f.source && f.source !== 'quickstart'),
  ) ?? false;

  const demoVisited = localStorage.getItem('personafy_demo_visited') === 'true';

  const items: ChecklistItem[] = [
    {
      id: 'vault',
      label: 'Create your vault',
      description: 'Done! Your private space is ready.',
      icon: <Lock className="w-4 h-4" />,
      completed: true, // always done if they finished setup
    },
    {
      id: 'demo',
      label: 'Try the interactive demo',
      description: 'See how AI apps request your info.',
      icon: <Play className="w-4 h-4" />,
      completed: demoVisited,
      action: 'demo',
    },
    {
      id: 'questions',
      label: 'Answer quick questions',
      description: 'Tell us your style, food preferences, and more.',
      icon: <Sparkles className="w-4 h-4" />,
      completed: hasQuickstartFacts,
      action: 'setup/quickstart',
    },
    {
      id: 'import',
      label: 'Import your data',
      description: 'Upload from Gmail, Amazon, ChatGPT, Claude, or Notion.',
      icon: <Upload className="w-4 h-4" />,
      completed: hasImportedPersonas,
      action: 'setup/import',
    },
  ];

  const completedCount = items.filter(i => i.completed).length;

  const handleDismiss = () => {
    localStorage.setItem(DISMISS_KEY, 'true');
    setDismissed(true);
    onDismiss();
  };

  // Find the next incomplete item for "Continue setup" action
  const nextItem = items.find(i => !i.completed && i.action);

  return (
    <div className="glass-card p-6 mb-10 animate-slide-up">
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={() => setExpanded(e => !e)}
          className="flex items-center gap-3 text-left"
        >
          <div>
            <h2 className="text-lg font-semibold text-white">Getting Started</h2>
            <p className="text-text-tertiary text-sm">
              {completedCount} of {items.length} complete
            </p>
          </div>
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setExpanded(e => !e)}
            className="text-text-tertiary hover:text-white transition-colors text-xs px-2 py-1 rounded-lg hover:bg-white/10"
          >
            {expanded ? 'Collapse' : 'Expand'}
          </button>
          <button
            onClick={handleDismiss}
            className="text-text-tertiary hover:text-white transition-colors p-1 rounded-lg hover:bg-white/10"
            aria-label="Dismiss getting started checklist"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden mb-3">
        <div
          className="h-full bg-gradient-to-r from-primary to-accent rounded-full transition-all duration-500"
          style={{ width: `${(completedCount / items.length) * 100}%` }}
        />
      </div>

      {/* Collapsed state: show continue button */}
      {!expanded && nextItem && (
        <button
          onClick={() => onNavClick?.(nextItem.action!)}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 mt-2 rounded-lg bg-primary/10 border border-primary/30 hover:border-primary/50 hover:bg-primary/15 text-primary text-sm font-medium transition-all"
        >
          Continue setup
        </button>
      )}

      {/* Expanded state: full checklist */}
      {expanded && (
        <>
          {/* Encouragement text */}
          {completedCount === items.length ? (
            <p className="text-accent text-sm mb-4 font-medium">
              All done! You're getting the full experience.
            </p>
          ) : completedCount >= 3 ? (
            <p className="text-text-tertiary text-sm mb-4">
              Almost there — just {items.length - completedCount} left.
            </p>
          ) : null}

          {/* Checklist items */}
          <div className="space-y-2">
            {items.map(item => (
              <button
                key={item.id}
                onClick={() => item.action && !item.completed && onNavClick?.(item.action)}
                disabled={item.completed || !item.action}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-all duration-200 ${
                  item.completed
                    ? 'bg-white/[0.08] text-text-tertiary'
                    : item.action
                      ? 'bg-white/[0.08] border border-card-border/35 hover:border-accent/30 hover:bg-white/[0.12] text-white cursor-pointer'
                      : 'bg-white/[0.08] text-text-tertiary cursor-default'
                }`}
              >
                {item.completed ? (
                  <CheckCircle className="w-5 h-5 text-accent flex-shrink-0" />
                ) : (
                  <Circle className="w-5 h-5 text-text-tertiary flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <span className={`text-sm font-medium ${item.completed ? 'line-through' : ''}`}>
                    {item.label}
                  </span>
                  {item.description && !item.completed && (
                    <span className="block text-xs text-text-tertiary mt-0.5">{item.description}</span>
                  )}
                </div>
                <span className="text-text-tertiary flex-shrink-0">
                  {item.icon}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export { DISMISS_KEY };
