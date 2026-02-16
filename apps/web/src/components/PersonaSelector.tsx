import { useEffect } from 'react';
import { CANONICAL_PERSONA_OPTIONS, resolvePersonaSelection } from '../lib/canonical-package-lineage';

interface Persona {
  id: string;
  name: string;
  avatarColor: string;
  tagline: string;
}

function getInitials(name: string): string {
  const parts = name.split(' ').filter(Boolean);
  if (parts.length === 0) return '??';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

interface PersonaSelectorProps {
  selected: string;
  onSelect: (id: string) => void;
}

export function PersonaSelector({ selected, onSelect }: PersonaSelectorProps) {
  const personas = CANONICAL_PERSONA_OPTIONS as Persona[];

  // Persist selection in localStorage
  useEffect(() => {
    localStorage.setItem('selected_persona', selected);
  }, [selected]);

  // Restore from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('selected_persona');
    if (!saved) return;

    if (saved === 'all') {
      onSelect('all');
      return;
    }

    const resolved = resolvePersonaSelection(saved);
    if (resolved.length === 1) {
      onSelect(resolved[0]);
    }
    // Only run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex items-center gap-3 mb-6">
      <span className="text-text-tertiary text-xs font-medium uppercase tracking-wider mr-1">
        Persona
      </span>

      {/* "All" button */}
      <button
        onClick={() => onSelect('all')}
        className={`flex items-center justify-center w-10 h-10 rounded-full text-xs font-bold transition-all duration-200 ${
          selected === 'all'
            ? 'bg-gradient-primary text-white ring-2 ring-primary ring-offset-2 ring-offset-background shadow-glow'
            : 'bg-white/10 text-text-secondary hover:bg-white/20 hover:text-white'
        }`}
        title="All personas"
        aria-label="Show all personas"
        aria-pressed={selected === 'all'}
      >
        All
      </button>

      {/* Persona circles */}
      {personas.map((persona) => {
        const isActive = selected === persona.id;
        return (
          <button
            key={persona.id}
            onClick={() => onSelect(persona.id)}
            className={`flex items-center justify-center w-10 h-10 rounded-full text-xs font-bold transition-all duration-200 ${
              isActive
                ? 'ring-2 ring-offset-2 ring-offset-background shadow-lg scale-110'
                : 'hover:scale-105 opacity-70 hover:opacity-100'
            }`}
            style={{
              backgroundColor: persona.avatarColor,
              color: '#fff',
              ...(isActive
                ? { ringColor: persona.avatarColor, boxShadow: `0 0 12px ${persona.avatarColor}60` }
                : {}),
            }}
            title={`${persona.name} — ${persona.tagline}`}
            aria-label={`Select ${persona.name}`}
            aria-pressed={isActive}
          >
            {getInitials(persona.name)}
          </button>
        );
      })}
    </div>
  );
}
