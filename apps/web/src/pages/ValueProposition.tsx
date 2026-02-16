import { useNavigate } from 'react-router-dom';
import { Shield, Brain, Lock, Play } from 'lucide-react';
import { SetupProgress } from '../components/SetupProgress';

interface ValuePropositionProps {
  onContinue: () => void;
}

const VALUE_CARDS = [
  {
    icon: Brain,
    title: 'Your AI Memory',
    description: 'Tell ChatGPT you prefer window seats once — every AI agent remembers it forever.',
    gradient: 'from-blue-500 to-cyan-400',
  },
  {
    icon: Shield,
    title: "You Decide What's Shared",
    description: 'A travel app asks for your budget? You approve exactly which facts it sees.',
    gradient: 'from-violet-500 to-purple-400',
  },
  {
    icon: Lock,
    title: 'Private by Default',
    description: 'Everything is encrypted on your device. No cloud, no tracking, no surprises.',
    gradient: 'from-green-500 to-emerald-400',
  },
];

export function ValueProposition({ onContinue }: ValuePropositionProps) {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-8 py-16">
      <SetupProgress currentStep={1} />

      {/* Hero */}
      <div className="text-center mb-16 animate-fade-in">
        <div className="mb-8">
          <div className="inline-flex items-center space-x-3 mb-4">
            <div className="w-12 h-12 bg-gradient-primary rounded-xl flex items-center justify-center">
              <Shield className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-4xl font-bold bg-gradient-primary bg-clip-text text-transparent">
              Personafy
            </h1>
          </div>
          <h2 className="text-3xl font-semibold text-white mb-4">
            Never Repeat Yourself to AI Again
          </h2>
          <p className="text-lg text-white/60 max-w-2xl mx-auto">
            Tell AI your preferences once. Personafy remembers them and only shares what you say is okay.
          </p>
          <div className="flex items-center justify-center gap-4 mt-4 text-sm text-white/60">
            <span>Your data stays on your device</span>
            <span className="text-white/30">&middot;</span>
            <span>Not even we can see it</span>
            <span className="text-white/30">&middot;</span>
            <span>No account needed</span>
          </div>
        </div>
      </div>

      {/* Value Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-4xl mb-16 stagger-children">
        {VALUE_CARDS.map((card) => {
          const Icon = card.icon;
          return (
            <div
              key={card.title}
              className="glass-card p-6 text-center"
            >
              <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${card.gradient} flex items-center justify-center mx-auto mb-4`}>
                <Icon className="w-7 h-7 text-white" />
              </div>
              <h3 className="text-white font-semibold text-lg mb-2">{card.title}</h3>
              <p className="text-text-secondary text-sm leading-relaxed">{card.description}</p>
            </div>
          );
        })}
      </div>

      {/* CTA */}
      <div className="animate-slide-up flex flex-col items-center gap-4">
        <button
          onClick={() => navigate('/demo')}
          className="btn-secondary px-8 py-3 text-sm flex items-center gap-2 animate-pulse-glow"
        >
          <Play className="w-4 h-4" />
          See how it works
        </button>
        <button
          onClick={onContinue}
          className="btn-primary px-12 py-4 text-lg font-semibold hover:shadow-glow-accent transform hover:-translate-y-1 transition-all duration-300"
        >
          Get Started — takes 60 seconds
        </button>
        <p className="text-white/60 text-xs">Free and private. No sign-up required.</p>
      </div>
    </div>
  );
}
