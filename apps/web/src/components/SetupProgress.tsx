import { Check } from 'lucide-react';

interface SetupProgressProps {
  currentStep: 1 | 2 | 3;
}

const steps = [
  { label: 'Welcome' },
  { label: 'Password' },
  { label: 'Personalize' },
];

export function SetupProgress({ currentStep }: SetupProgressProps) {
  return (
    <div className="flex items-center justify-center gap-0 mb-10 animate-fade-in" role="navigation" aria-label="Setup progress">
      {steps.map((step, i) => {
        const stepNum = (i + 1) as 1 | 2 | 3;
        const isCompleted = stepNum < currentStep;
        const isCurrent = stepNum === currentStep;
        const isFuture = stepNum > currentStep;

        return (
          <div key={step.label} className="flex items-center">
            {/* Step circle */}
            <div className="flex flex-col items-center">
              <div
                className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold transition-all duration-300 ${
                  isCompleted
                    ? 'bg-accent text-white'
                    : isCurrent
                      ? 'bg-primary text-white shadow-glow'
                      : 'bg-white/10 text-text-tertiary'
                }`}
                aria-current={isCurrent ? 'step' : undefined}
              >
                {isCompleted ? <Check className="w-4 h-4" /> : stepNum}
              </div>
              <span
                className={`text-xs mt-2 font-medium transition-colors ${
                  isCompleted
                    ? 'text-accent'
                    : isCurrent
                      ? 'text-white'
                      : 'text-text-tertiary'
                }`}
              >
                {step.label}
              </span>
            </div>

            {/* Connector line */}
            {i < steps.length - 1 && (
              <div
                className={`w-16 sm:w-24 h-0.5 mx-3 mb-6 transition-colors duration-300 ${
                  isCompleted ? 'bg-accent' : isFuture ? 'bg-white/10' : 'bg-primary/40'
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
