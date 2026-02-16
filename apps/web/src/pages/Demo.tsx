import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
import { Layout } from '../components/Layout';
import { DemoPersonaPicker } from './demo/DemoPersonaPicker';
import { DemoDataExplorer } from './demo/DemoDataExplorer';
import { DemoExtractionView } from './demo/DemoExtractionView';
import { DemoAgentSimulation } from './demo/DemoAgentSimulation';
import { DemoCTA } from './demo/DemoCTA';
import { useDocumentTitle } from '../lib/useDocumentTitle';

type DemoStep = 1 | 2 | 3 | 4 | 5;

interface DemoProps {
  /** True when vault setup is complete (wraps in Layout) */
  isPostSetup?: boolean;
  onNavClick?: (itemId: string) => void;
}

const STEP_LABELS = ['Choose persona', 'Browse data', 'See extraction', 'Agent simulation', 'Get started'];

export function Demo({ isPostSetup = false, onNavClick }: DemoProps) {
  useDocumentTitle('Interactive Demo');
  const navigate = useNavigate();

  useEffect(() => {
    localStorage.setItem('personafy_demo_visited', 'true');
  }, []);
  const [step, setStep] = useState<DemoStep>(1);
  const [personaId, setPersonaId] = useState<string>('');

  const handlePersonaSelect = useCallback((id: string) => {
    setPersonaId(id);
    setStep(2);
  }, []);

  const handleReset = useCallback(() => {
    setStep(1);
    setPersonaId('');
  }, []);

  const handleExit = useCallback(() => {
    if (isPostSetup) {
      onNavClick?.('home');
    } else {
      navigate('/setup/welcome');
    }
  }, [isPostSetup, onNavClick, navigate]);

  const stepBar = (
    <div className="flex items-center justify-between px-6 py-3 border-b border-card-border/30 bg-background/80 backdrop-blur-sm">
      <div className="flex items-center gap-2">
        {STEP_LABELS.map((label, i) => {
          const stepNum = i + 1;
          const isCurrent = stepNum === step;
          const isDone = stepNum < step;
          return (
            <div key={label} className="flex items-center gap-2">
              {i > 0 && <div className={`w-6 h-px ${isDone ? 'bg-accent/50' : 'bg-white/10'}`} />}
              <div className={`flex items-center gap-1.5 text-xs font-medium ${
                isCurrent ? 'text-white' : isDone ? 'text-accent' : 'text-text-tertiary'
              }`}>
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${
                  isCurrent ? 'bg-primary text-white' : isDone ? 'bg-accent/20 text-accent' : 'bg-white/10'
                }`}>{stepNum}</span>
                <span className="hidden sm:inline">{label}</span>
              </div>
            </div>
          );
        })}
      </div>
      <button
        onClick={handleExit}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-text-tertiary hover:text-white hover:bg-white/10 text-xs font-medium transition-colors"
      >
        <X className="w-3.5 h-3.5" />
        Exit demo
      </button>
    </div>
  );

  const content = (
    <>
      {stepBar}
      {step === 1 && <DemoPersonaPicker onSelect={handlePersonaSelect} />}
      {step === 2 && <DemoDataExplorer personaId={personaId} onContinue={() => setStep(3)} />}
      {step === 3 && <DemoExtractionView personaId={personaId} onContinue={() => setStep(4)} />}
      {step === 4 && <DemoAgentSimulation personaId={personaId} onContinue={() => setStep(5)} />}
      {step === 5 && <DemoCTA isPostSetup={isPostSetup} onTryAgain={handleReset} />}
    </>
  );

  if (isPostSetup) {
    return (
      <Layout activeNav="demo" onNavClick={onNavClick}>
        {content}
      </Layout>
    );
  }

  return content;
}
