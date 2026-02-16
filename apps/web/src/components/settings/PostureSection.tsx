import { Shield, Check } from 'lucide-react';
import { Section } from './SettingsWidgets';

const postures = [
  {
    id: 'simple_lock',
    name: 'Relaxed',
    description: 'Share basics automatically, ask me for sensitive stuff.',
    icon: '🟢',
    level: 1,
  },
  {
    id: 'alarm_system',
    name: 'Balanced',
    description: 'Always ask before sharing anything important.',
    icon: '🟡',
    level: 2,
    recommended: true,
  },
  {
    id: 'safe_room',
    name: 'Strict',
    description: 'Ask me every single time, no exceptions.',
    icon: '🔴',
    level: 3,
  },
];

interface PostureSectionProps {
  currentPosture: string;
  onChangePosture: (postureId: string) => void;
}

export function PostureSection({ currentPosture, onChangePosture }: PostureSectionProps) {
  return (
    <Section title="Privacy Posture" icon={<Shield className="w-5 h-5 text-accent" />}>
      <p className="text-text-secondary text-sm mb-5">
        Controls how much AI agents can access without asking you first.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {postures.map((p) => {
          const active = currentPosture === p.id;
          return (
            <button
              key={p.id}
              onClick={() => onChangePosture(p.id)}
              className={`relative p-5 rounded-xl border text-left transition-all duration-200 ${
                active
                  ? 'border-accent bg-accent/5 shadow-glow'
                  : 'border-card-border/50 bg-card hover:border-accent/30'
              }`}
            >
              {p.recommended && (
                <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 text-[10px] px-2 py-0.5 bg-accent text-white rounded-full font-medium">
                  Recommended
                </span>
              )}
              <div className="text-2xl mb-3">{p.icon}</div>
              <div className="text-white font-semibold mb-1">{p.name}</div>
              <div className="text-text-tertiary text-xs leading-relaxed">{p.description}</div>
              {active && (
                <div className="absolute top-3 right-3">
                  <Check className="w-5 h-5 text-accent" />
                </div>
              )}
            </button>
          );
        })}
      </div>
    </Section>
  );
}
