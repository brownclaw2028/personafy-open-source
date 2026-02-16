import { useNavigate } from 'react-router-dom';
import { Shield, ArrowRight, RotateCcw, Home } from 'lucide-react';

interface DemoCTAProps {
  isPostSetup: boolean;
  onTryAgain: () => void;
}

export function DemoCTA({ isPostSetup, onTryAgain }: DemoCTAProps) {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-8 py-16 animate-fade-in">
      <div className="text-center max-w-xl">
        {/* Icon */}
        <div className="w-20 h-20 bg-gradient-primary rounded-2xl flex items-center justify-center mx-auto mb-8 animate-pulse-glow">
          <Shield className="w-10 h-10 text-white" />
        </div>

        {/* Heading */}
        <h2 className="text-3xl font-bold text-white mb-4">
          Ready to protect your own data?
        </h2>
        <p className="text-lg text-white/60 mb-10">
          Set up your personal vault in minutes. Import your data, configure your privacy posture,
          and let AI agents work for you — on your terms.
        </p>

        {/* CTA Buttons */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          {isPostSetup ? (
            <button
              onClick={() => navigate('/')}
              className="btn-primary px-8 py-3 text-lg font-semibold flex items-center gap-2"
            >
              <Home className="w-5 h-5" />
              Return to Dashboard
            </button>
          ) : (
            <button
              onClick={() => navigate('/setup/welcome')}
              className="btn-primary px-8 py-3 text-lg font-semibold flex items-center gap-2"
            >
              Get Started <ArrowRight className="w-5 h-5" />
            </button>
          )}
          <button
            onClick={onTryAgain}
            className="btn-secondary px-8 py-3 text-lg font-semibold flex items-center gap-2"
          >
            <RotateCcw className="w-5 h-5" />
            Try another demo
          </button>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-16 text-center text-white/40 text-sm">
        <p>All data remains on your device. Nothing is sent to external servers.</p>
      </div>
    </div>
  );
}
