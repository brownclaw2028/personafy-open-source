import { useState, useMemo, useEffect } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  Shield,
  Search,
  CheckCircle,
  Lock,
  Eye,
  Send,
  FileText,
  Zap,
  ArrowRight,
  Lightbulb,
} from 'lucide-react';
import { useSimulation } from '../../hooks/useSimulation';
import { useTypewriter } from '../../hooks/useTypewriter';
import { generateSimulation } from '../../lib/demo-simulation-engine';
import { getScenariosForPersona, type DemoScenario } from '../../data/demo-scenarios';

const EVENT_ICONS: Record<string, typeof Shield> = {
  agent_message: Send,
  vault_receive: Shield,
  fact_match: Search,
  sensitivity_check: Eye,
  posture_check: Lock,
  deidentify_field: Lock,
  deidentify_complete: CheckCircle,
  approval_check: CheckCircle,
  data_release: Send,
  agent_processing: Zap,
  agent_response: Zap,
  audit_log: FileText,
};

const EVENT_LABELS: Record<string, string> = {
  agent_message: 'Agent Request',
  vault_receive: 'Vault Received',
  fact_match: 'Fact Matched',
  sensitivity_check: 'Sensitivity Check',
  posture_check: 'Posture Check',
  deidentify_field: 'De-identifying',
  deidentify_complete: 'De-identification Done',
  approval_check: 'Approval Decision',
  data_release: 'Data Released',
  agent_processing: 'Agent Processing',
  agent_response: 'Agent Response',
  audit_log: 'Audit Logged',
};

const SENSITIVITY_COLORS: Record<string, string> = {
  low: 'text-green-400 bg-green-400/10',
  medium: 'text-yellow-400 bg-yellow-400/10',
  high: 'text-red-400 bg-red-400/10',
};

const EDUCATION_TAKEAWAYS = [
  'Only requested fields are matched — never your entire vault.',
  'Every fact has a sensitivity level that controls sharing behavior.',
  'Your privacy posture determines what gets auto-allowed vs. needs approval.',
  'Sensitive data is de-identified (masked/generalized) before sharing.',
  'Every interaction is permanently logged in your audit trail.',
];

interface DemoAgentSimulationProps {
  personaId: string;
  onContinue: () => void;
}

export function DemoAgentSimulation({ personaId, onContinue }: DemoAgentSimulationProps) {
  const scenarios = getScenariosForPersona(personaId);
  const [selectedScenario, setSelectedScenario] = useState<DemoScenario | null>(null);

  const events = useMemo(() => {
    if (!selectedScenario) return [];
    return generateSimulation(selectedScenario, 'alarm_system');
  }, [selectedScenario]);

  const simulation = useSimulation(events);

  // Auto-play simulation once events are ready after scenario selection.
  // Using useEffect instead of setTimeout ensures React has committed the
  // render with the new events/totalDuration before play() is called.
  const { play } = simulation;
  useEffect(() => {
    if (selectedScenario && events.length > 0) {
      play();
    }
  }, [selectedScenario, events.length, play]);

  // Find the latest agent message for typewriter effect
  const latestAgentMessage = simulation.visibleEvents
    .filter((e) => e.type === 'agent_message')
    .pop();
  const latestAgentResponse = simulation.visibleEvents
    .filter((e) => e.type === 'agent_response')
    .pop();

  const agentQueryText = (latestAgentMessage?.data?.message as string) ?? '';
  const agentResponseText = (latestAgentResponse?.data?.message as string) ?? '';
  const typedQuery = useTypewriter(agentQueryText, 25, !!latestAgentMessage);
  const typedResponse = useTypewriter(agentResponseText, 15, !!latestAgentResponse);

  if (!selectedScenario) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-8 py-12 animate-fade-in">
        <h2 className="text-2xl font-bold text-white mb-2">Pick a scenario</h2>
        <p className="text-text-secondary mb-8 text-center max-w-lg">
          Watch a live simulation of an AI agent requesting context from the vault.
        </p>
        <div className="flex flex-wrap justify-center gap-3 max-w-2xl">
          {scenarios.map((s) => (
            <button
              key={s.id}
              onClick={() => {
                setSelectedScenario(s);
              }}
              className="px-5 py-2.5 rounded-full glass-card text-sm text-white hover:border-accent/50 transition-all"
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  const progress = simulation.totalDuration > 0
    ? (simulation.currentTime / simulation.totalDuration) * 100
    : 0;

  return (
    <div className="min-h-screen flex flex-col px-8 py-8 max-w-7xl mx-auto animate-fade-in">
      {/* Header with controls */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-white mb-1">Live Simulation</h2>
          <p className="text-text-secondary text-sm">"{selectedScenario.label}"</p>
        </div>

        {/* Playback controls */}
        <div className="flex items-center gap-3">
          {simulation.isPlaying ? (
            <button onClick={simulation.pause} className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors" aria-label="Pause">
              <Pause className="w-5 h-5" />
            </button>
          ) : (
            <button onClick={simulation.play} className="p-2 rounded-lg bg-primary/20 hover:bg-primary/30 text-primary transition-colors" aria-label="Play">
              <Play className="w-5 h-5" />
            </button>
          )}
          <button onClick={simulation.restart} className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors" aria-label="Restart">
            <RotateCcw className="w-5 h-5" />
          </button>

          {/* Speed selector */}
          <div className="flex rounded-lg overflow-hidden border border-card-border/50">
            {[1, 2, 3].map((s) => (
              <button
                key={s}
                onClick={() => simulation.setSpeed(s)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  simulation.speed === s
                    ? 'bg-primary text-white'
                    : 'bg-white/10 text-text-secondary hover:bg-white/10'
                }`}
              >
                {s}x
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="w-full h-1 bg-white/10 rounded-full mb-6 overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-primary to-accent rounded-full transition-all duration-100"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 flex-1 min-h-0">
        {/* Left: Agent Chat */}
        <div className="glass-card p-6 flex flex-col">
          <h3 className="text-sm font-semibold text-text-tertiary uppercase tracking-wider mb-4">
            Agent Chat
          </h3>
          <div className="flex-1 space-y-4 overflow-y-auto">
            {/* Agent query */}
            {latestAgentMessage && (
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                  <Send className="w-4 h-4 text-primary" />
                </div>
                <div className="glass-card p-3 flex-1">
                  <div className="text-[11px] text-text-tertiary mb-1">{selectedScenario.agentDomain}</div>
                  <p className="text-white text-sm">
                    {typedQuery}
                    {typedQuery.length < agentQueryText.length && (
                      <span className="inline-block w-0.5 h-4 bg-primary ml-0.5 animate-blink-cursor" />
                    )}
                  </p>
                  {/* Field pills */}
                  {typedQuery.length >= agentQueryText.length && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {selectedScenario.fieldsRequested.map((f) => (
                        <span key={f} className="text-[10px] px-2 py-0.5 bg-primary/10 text-primary rounded-full font-mono">
                          {f}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Processing indicator */}
            {simulation.visibleEvents.some((e) => e.type === 'agent_processing') &&
              !latestAgentResponse && (
                <div className="flex gap-3">
                  <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                    <Zap className="w-4 h-4 text-primary" />
                  </div>
                  <div className="glass-card p-3">
                    <div className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                      <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" style={{ animationDelay: '0.2s' }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" style={{ animationDelay: '0.4s' }} />
                    </div>
                  </div>
                </div>
              )}

            {/* Agent response */}
            {latestAgentResponse && (
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center flex-shrink-0">
                  <Zap className="w-4 h-4 text-accent" />
                </div>
                <div className="glass-card p-3 flex-1 border-accent/20">
                  <div className="text-[11px] text-accent mb-1">Personalized Response</div>
                  <p className="text-white text-sm whitespace-pre-line">
                    {typedResponse}
                    {typedResponse.length < agentResponseText.length && (
                      <span className="inline-block w-0.5 h-4 bg-accent ml-0.5 animate-blink-cursor" />
                    )}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right: Vault Processing Feed */}
        <div className="glass-card p-6 flex flex-col">
          <h3 className="text-sm font-semibold text-text-tertiary uppercase tracking-wider mb-4">
            Vault Processing
          </h3>
          <div className="flex-1 space-y-2 overflow-y-auto">
            {simulation.visibleEvents.map((event) => {
              const Icon = EVENT_ICONS[event.type] ?? Shield;
              const label = EVENT_LABELS[event.type] ?? event.type;

              return (
                <div
                  key={event.id}
                  className="flex items-start gap-3 p-3 rounded-lg bg-white/[0.08] border border-card-border/35 animate-slide-in-right"
                >
                  <div className="w-7 h-7 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Icon className="w-3.5 h-3.5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-white text-xs font-medium">{label}</div>
                    <EventDetail event={event} />
                    {event.educationNote && (
                      <p className="text-text-tertiary text-[11px] mt-1 italic">{event.educationNote}</p>
                    )}
                  </div>
                  <span className="text-[10px] text-text-tertiary flex-shrink-0">
                    {(event.timestamp / 1000).toFixed(1)}s
                  </span>
                </div>
              );
            })}

            {simulation.visibleEvents.length === 0 && (
              <p className="text-text-tertiary text-sm text-center py-8">
                Press play to start the simulation
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Post-simulation summary */}
      {simulation.isComplete && (
        <div className="mt-8 space-y-6 animate-slide-up">
          {/* Education takeaways */}
          <div className="glass-card p-6">
            <div className="flex items-center gap-2 mb-4">
              <Lightbulb className="w-5 h-5 text-accent" />
              <h3 className="text-white font-semibold">Key Takeaways</h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {EDUCATION_TAKEAWAYS.map((takeaway, i) => (
                <div key={i} className="flex items-start gap-2 p-3 rounded-lg bg-white/[0.08] border border-card-border/15">
                  <CheckCircle className="w-4 h-4 text-accent flex-shrink-0 mt-0.5" />
                  <p className="text-text-secondary text-sm">{takeaway}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-center gap-4">
            <button
              onClick={() => {
                setSelectedScenario(null);
              }}
              className="btn-secondary"
            >
              Try another scenario
            </button>
            <button onClick={onContinue} className="btn-primary flex items-center gap-2">
              Continue <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Sub-component: renders event-specific details
function EventDetail({ event }: { event: { type: string; data: Record<string, unknown> } }) {
  switch (event.type) {
    case 'agent_message':
      return (
        <div className="flex flex-wrap gap-1 mt-1">
          {(event.data.fields as string[])?.map((f) => (
            <span key={f} className="text-[10px] px-1.5 py-0.5 bg-primary/10 text-primary rounded font-mono">{f}</span>
          ))}
        </div>
      );

    case 'fact_match':
      return (
        <div className="mt-1">
          <span className="text-text-tertiary text-[11px] font-mono">{event.data.key as string}</span>
          <span className="text-white text-[11px] ml-2">{event.data.value as string}</span>
          <span className={`text-[10px] ml-2 px-1.5 py-0.5 rounded ${SENSITIVITY_COLORS[event.data.sensitivity as string] ?? ''}`}>
            {event.data.sensitivity as string}
          </span>
        </div>
      );

    case 'sensitivity_check': {
      const counts = event.data.counts as Record<string, number>;
      return (
        <div className="flex gap-2 mt-1">
          {Object.entries(counts).filter(([, v]) => v > 0).map(([level, count]) => (
            <span key={level} className={`text-[10px] px-1.5 py-0.5 rounded ${SENSITIVITY_COLORS[level] ?? ''}`}>
              {count} {level}
            </span>
          ))}
        </div>
      );
    }

    case 'posture_check':
      return (
        <p className="text-text-tertiary text-[11px] mt-1">
          {event.data.reason as string}
        </p>
      );

    case 'deidentify_field':
      return (
        <div className="mt-1 flex items-center gap-2 text-[11px]">
          <span className="text-red-300 line-through">{event.data.original as string}</span>
          <ArrowRight className="w-3 h-3 text-text-tertiary" />
          <span className="text-accent">{event.data.masked as string}</span>
          <span className="text-text-tertiary">({event.data.method as string})</span>
        </div>
      );

    case 'data_release': {
      const facts = event.data.facts as Array<{ key: string; value: string; sensitivity: string }>;
      return (
        <div className="mt-1 space-y-0.5">
          {facts?.slice(0, 4).map((f) => (
            <div key={f.key} className="text-[11px]">
              <span className="text-text-tertiary font-mono">{f.key}:</span>
              <span className="text-white ml-1">{f.value}</span>
            </div>
          ))}
          {facts && facts.length > 4 && (
            <span className="text-text-tertiary text-[10px]">+{facts.length - 4} more</span>
          )}
        </div>
      );
    }

    case 'audit_log':
      return (
        <div className="mt-1 text-[11px] text-text-tertiary">
          <span>{event.data.domain as string}</span>
          <span className="mx-1">·</span>
          <span>{(event.data.fieldsReleased as string[])?.length} fields</span>
          <span className="mx-1">·</span>
          <span className="text-accent">{(event.data.decision as string)?.replace(/_/g, ' ')}</span>
        </div>
      );

    default:
      return null;
  }
}
