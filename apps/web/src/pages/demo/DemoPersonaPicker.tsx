import { Shield } from 'lucide-react';
import personasData from '../../data/demo-personas.json';

interface DemoPersona {
  id: string;
  name: string;
  avatar_color: string;
  tagline: string;
  summary_stats: { emails: number; orders: number; conversations: number };
}

function getInitials(name: string): string {
  const parts = name.split(' ').filter(Boolean);
  if (parts.length < 2) return name.slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

interface DemoPersonaPickerProps {
  onSelect: (personaId: string) => void;
}

export function DemoPersonaPicker({ onSelect }: DemoPersonaPickerProps) {
  const personas = personasData as DemoPersona[];

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-8 py-16 animate-fade-in">
      {/* Header */}
      <div className="text-center mb-16">
        <div className="mb-8">
          <div className="inline-flex items-center space-x-3 mb-4">
            <div className="w-12 h-12 bg-gradient-primary rounded-xl flex items-center justify-center">
              <Shield className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-4xl font-bold bg-gradient-primary bg-clip-text text-transparent">
              See Personafy in action
            </h1>
          </div>
          <p className="text-xl text-white/70 max-w-2xl mx-auto">
            Pick a demo persona to explore how Personafy protects and selectively shares personal context with AI agents.
          </p>
        </div>
      </div>

      {/* Persona Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-6 w-full max-w-6xl mb-16 stagger-children">
        {personas.map((persona) => (
          <button
            key={persona.id}
            onClick={() => onSelect(persona.id)}
            className="glass-card p-6 text-center group cursor-pointer transition-all duration-300 hover:scale-105 flex flex-col items-center"
          >
            {/* Avatar */}
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center text-lg font-bold text-white mx-auto mb-4 transition-transform duration-300 group-hover:scale-110"
              style={{ backgroundColor: persona.avatar_color }}
            >
              {getInitials(persona.name)}
            </div>

            {/* Name & Tagline */}
            <h3 className="text-white font-semibold text-lg mb-1">{persona.name}</h3>
            <p className="text-text-secondary text-sm mb-4 flex-1">{persona.tagline}</p>

            {/* Stats */}
            <div className="flex justify-center gap-4 text-[11px] text-text-secondary">
              <span>{persona.summary_stats.emails} emails</span>
              <span>{persona.summary_stats.orders} orders</span>
            </div>
          </button>
        ))}
      </div>

      {/* Footer */}
      <div className="text-center text-white/40 text-sm">
        <p>All demo data is synthetic — no real personal information is used.</p>
      </div>
    </div>
  );
}
