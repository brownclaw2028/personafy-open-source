import { Lock, Shield, Home, CheckCircle } from 'lucide-react';
import type { PrivacyPosture } from '../lib/types';

interface PostureCardProps {
  posture: PrivacyPosture;
  isSelected: boolean;
  onSelect: (posture: PrivacyPosture) => void;
}

const iconMap = {
  Lock: Lock,
  Shield: Shield,
  Home: Home
};

export function PostureCard({ posture, isSelected, onSelect }: PostureCardProps) {
  const IconComponent = iconMap[posture.icon as keyof typeof iconMap] || Shield;

  return (
    <div
      role="radio"
      aria-checked={isSelected}
      tabIndex={0}
      onClick={() => onSelect(posture)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(posture); } }}
      className={`
        glass-card gradient-border p-8 cursor-pointer transition-all duration-300 
        animate-fade-in relative group outline-none focus-visible:ring-2 focus-visible:ring-accent
        ${isSelected 
          ? 'border-accent shadow-glow-accent scale-105' 
          : 'hover:border-accent/60 hover:shadow-card-hover hover:scale-102'
        }
      `}
    >
      {/* Recommended Badge */}
      {posture.recommended && (
        <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
          <div className="bg-gradient-primary px-4 py-1 rounded-full text-sm font-medium text-white">
            Recommended
          </div>
        </div>
      )}

      {/* Selection Indicator */}
      {isSelected && (
        <div className="absolute top-4 right-4">
          <CheckCircle className="w-6 h-6 text-accent" />
        </div>
      )}

      {/* Icon */}
      <div className={`
        w-16 h-16 rounded-xl mb-6 flex items-center justify-center transition-all duration-300
        ${isSelected 
          ? 'bg-gradient-primary shadow-glow' 
          : 'bg-white/10 group-hover:bg-gradient-primary group-hover:shadow-glow'
        }
      `}>
        <IconComponent className="w-8 h-8 text-white" />
      </div>

      {/* Content */}
      <div className="space-y-4">
        <div>
          <h3 className="text-xl font-semibold text-white mb-2">
            {posture.name}
          </h3>
          <p className="text-white/60 text-sm">
            {posture.description}
          </p>
        </div>

        {/* Features */}
        <ul className="space-y-2">
          {posture.features.map((feature, index) => (
            <li key={index} className="flex items-start space-x-2 text-sm">
              <div className="w-1.5 h-1.5 bg-accent rounded-full mt-2 flex-shrink-0" />
              <span className="text-white/80">{feature}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Hover Glow Effect */}
      <div className="absolute inset-0 rounded-xl bg-gradient-primary opacity-0 group-hover:opacity-5 transition-opacity duration-300 pointer-events-none" />
    </div>
  );
}