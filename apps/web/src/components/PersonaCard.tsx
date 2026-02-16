import {
  ShoppingBag,
  Plane,
  UtensilsCrossed,
  Briefcase,
  Activity,
  Gift,
  Sparkles,
  type LucideIcon
} from 'lucide-react';
import type { Persona } from '../lib/types';
import { normalizeCompletionScore } from '../lib/utils';

interface PersonaCardProps {
  persona: Persona;
  showViewButton?: boolean;
  onClick?: () => void;
}

const iconMap: Record<string, LucideIcon> = {
  ShoppingBag,
  Plane,
  UtensilsCrossed,
  Briefcase,
  Activity,
  Gift,
};

/** Encouraging messages for low-completion personas */
const ENCOURAGEMENT_MESSAGES = [
  "Let's add more details!",
  "A few more facts will help!",
  "Keep building your profile!",
  "Add facts to unlock insights!",
];

function getEncouragementMessage(personaId: string): string {
  // Use persona ID to pick a consistent message
  const index = personaId.charCodeAt(personaId.length - 1) % ENCOURAGEMENT_MESSAGES.length;
  return ENCOURAGEMENT_MESSAGES[index];
}

export function PersonaCard({ persona, showViewButton = false, onClick }: PersonaCardProps) {
  const IconComponent = iconMap[persona.icon] || ShoppingBag;
  const normalizedScore = normalizeCompletionScore(persona.completionScore);
  const completionPct = Math.round(normalizedScore * 100);
  const needsMoreFacts = completionPct < 50 || persona.facts.length < 5;

  const getCompletionColor = (score: number) => {
    if (score >= 0.8) return 'from-green-500 to-green-400';
    if (score >= 0.6) return 'from-yellow-500 to-yellow-400';
    return 'from-blue-500 to-blue-400';
  };

  const getStrengthText = (score: number) => {
    const percentage = Math.round(score * 100);
    if (percentage >= 80) return 'Strong';
    if (percentage >= 60) return 'Growing';
    return 'Getting Started';
  };

  return (
    <div 
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      className={`glass-card gradient-border p-6 transition-all duration-300 group hover:scale-105 relative flex flex-col ${
        onClick ? 'cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-accent' : ''
      }`}
      onClick={onClick}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
    >
      {/* Icon */}
      <div className="flex justify-center mb-4">
        <div className="w-16 h-16 rounded-full bg-gradient-primary flex items-center justify-center group-hover:shadow-glow-accent transition-all duration-300">
          <IconComponent className="w-8 h-8 text-white" />
        </div>
      </div>

      {/* Name and Category */}
      <div className="text-center mb-3 flex-1">
        <h3 className="text-xl font-bold mb-1">{persona.name}</h3>
        <p className="text-text-secondary text-sm">{persona.description}</p>
      </div>

      {/* Fact Count Badge */}
      <div className="flex justify-center mb-4">
        <span className="px-3 py-1 bg-accent/20 text-accent rounded-full text-xs font-medium">
          {persona.facts.length} fact{persona.facts.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Profile Strength */}
      <div className="mb-4">
        <div className="flex justify-between items-center mb-2">
          <span className="text-xs text-text-tertiary">Profile Strength</span>
          <span className="text-xs font-medium text-text-secondary">
            {getStrengthText(normalizedScore)}
          </span>
        </div>

        {/* Progress Bar Container */}
        <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
          {/* Animated Progress Bar */}
          <div
            className={`h-full bg-gradient-to-r ${getCompletionColor(normalizedScore)} transition-all duration-1000 ease-out`}
            style={{
              width: `${normalizedScore * 100}%`,
              animation: 'shine 2s ease-in-out infinite'
            }}
          />
        </div>
      </div>

      {/* Add More Facts Prompt - shown when completion < 50% or facts < 5 */}
      {needsMoreFacts && (
        <div className="mb-4 p-3 rounded-lg bg-primary/10 border border-primary/20">
          <div className="flex items-center gap-2 text-primary">
            <Sparkles className="w-4 h-4 flex-shrink-0" />
            <span className="text-xs font-medium">
              {getEncouragementMessage(persona.id)}
            </span>
          </div>
          <p className="text-[11px] text-text-tertiary mt-1 ml-6">
            {persona.facts.length < 5 
              ? `Add ${5 - persona.facts.length} more fact${5 - persona.facts.length !== 1 ? 's' : ''} to improve recommendations`
              : 'More details = better personalization'}
          </p>
        </div>
      )}

      {/* View Button */}
      {showViewButton && (
        <button className="w-full btn-secondary py-2 text-sm font-medium group-hover:border-accent group-hover:bg-accent/10">
          View Details
        </button>
      )}

      {/* Hover Glow Effect */}
      <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-primary/20 to-accent/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />
    </div>
  );
}