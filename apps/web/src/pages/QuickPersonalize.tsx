import { useState, useCallback } from 'react';
import { Sparkles, Upload, ArrowRight, ArrowLeft } from 'lucide-react';
import { SetupProgress } from '../components/SetupProgress';
import { QuickStart } from './QuickStart';
import { QUICK_FIVE_QUESTION_IDS } from './quickstart-constants';
import { ImportZone } from '../components/ImportZone';
import { ProgressBar } from '../components/ProgressBar';
import { toast } from '../components/Toast';
import type { QuickStartAnswers } from '../lib/quickstart-converter';
import type { ChatGPTExport, ImportProgress } from '../lib/types';
import sampleData from '../data/demo-export.json';

interface QuickPersonalizeProps {
  onQuickQuestionsComplete: (answers: QuickStartAnswers) => void;
  onImportComplete: (conversations: ChatGPTExport[]) => void;
  onSkip: () => void;
  onBack?: () => void;
}

type View = 'chooser' | 'questions' | 'import';

export function QuickPersonalize({
  onQuickQuestionsComplete,
  onImportComplete,
  onSkip,
  onBack,
}: QuickPersonalizeProps) {
  const [view, setView] = useState<View>('chooser');
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const processFile = useCallback(async (file: File) => {
    setIsProcessing(true);
    try {
      setProgress({ stage: 'parsing', progress: 10, message: 'Reading file...' });
      const text = await file.text();
      const conversations = JSON.parse(text) as ChatGPTExport[];

      await new Promise(resolve => setTimeout(resolve, 500));
      setProgress({ stage: 'extracting', progress: 40, message: 'Extracting conversations...' });

      await new Promise(resolve => setTimeout(resolve, 800));
      setProgress({ stage: 'analyzing', progress: 70, message: 'Analyzing patterns...' });

      await new Promise(resolve => setTimeout(resolve, 1000));
      setProgress({ stage: 'complete', progress: 100, message: 'Analysis complete!' });

      await new Promise(resolve => setTimeout(resolve, 500));
      onImportComplete(conversations);
    } catch (error) {
      console.error('Failed to process file:', error);
      setProgress(null);
      toast('Failed to process file. Please check the format and try again.', 'error');
    } finally {
      setIsProcessing(false);
    }
  }, [onImportComplete]);

  const handleFileDrop = useCallback((acceptedFiles: FileList | File[]) => {
    const files = Array.from(acceptedFiles);
    if (files.length > 0) {
      processFile(files[0]);
    }
  }, [processFile]);

  const handleSampleData = useCallback(async () => {
    setIsProcessing(true);
    try {
      setProgress({ stage: 'parsing', progress: 20, message: 'Loading sample data...' });
      await new Promise(resolve => setTimeout(resolve, 600));

      setProgress({ stage: 'extracting', progress: 50, message: 'Extracting conversations...' });
      await new Promise(resolve => setTimeout(resolve, 800));

      setProgress({ stage: 'analyzing', progress: 80, message: 'Analyzing patterns...' });
      await new Promise(resolve => setTimeout(resolve, 1000));

      setProgress({ stage: 'complete', progress: 100, message: 'Analysis complete!' });
      await new Promise(resolve => setTimeout(resolve, 500));

      onImportComplete(sampleData as unknown as ChatGPTExport[]);
    } catch (error) {
      console.error('Failed to process sample data:', error);
      setProgress(null);
      toast('Failed to process sample data. Please try again.', 'error');
    } finally {
      setIsProcessing(false);
    }
  }, [onImportComplete]);

  // Questions view — embed QuickStart inline with filtered questions
  if (view === 'questions') {
    return (
      <div>
        <div className="pt-16 px-8 flex justify-center">
          <SetupProgress currentStep={3} />
        </div>
        <QuickStart
          onComplete={onQuickQuestionsComplete}
          onBack={() => setView('chooser')}
          questionIds={QUICK_FIVE_QUESTION_IDS}
        />
      </div>
    );
  }

  // Import view — embed ImportZone inline with processing
  if (view === 'import') {
    if (isProcessing && progress) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center px-8">
          <SetupProgress currentStep={3} />
          <div className="w-full max-w-2xl">
            <div className="text-center mb-12 animate-fade-in">
              <h1 className="text-3xl font-bold text-white mb-4">
                {progress.stage === 'complete' ? 'Processing Complete!' : 'Processing Import'}
              </h1>
              <p className="text-white/60 text-lg">{progress.message}</p>
            </div>
            <div className="mb-8">
              <ProgressBar progress={progress.progress} />
            </div>
            <div className="space-y-3">
              <div className={`flex items-center space-x-3 ${progress.stage !== 'parsing' ? 'text-white/50' : 'text-white'}`}>
                <div className={`w-2 h-2 rounded-full ${progress.stage === 'parsing' ? 'bg-primary animate-pulse' : progress.progress > 20 ? 'bg-accent' : 'bg-white/30'}`} />
                <span>Parsing conversations</span>
              </div>
              <div className={`flex items-center space-x-3 ${progress.stage !== 'extracting' ? 'text-white/50' : 'text-white'}`}>
                <div className={`w-2 h-2 rounded-full ${progress.stage === 'extracting' ? 'bg-primary animate-pulse' : progress.progress > 50 ? 'bg-accent' : 'bg-white/30'}`} />
                <span>Extracting personal context</span>
              </div>
              <div className={`flex items-center space-x-3 ${progress.stage !== 'analyzing' ? 'text-white/50' : 'text-white'}`}>
                <div className={`w-2 h-2 rounded-full ${progress.stage === 'analyzing' ? 'bg-primary animate-pulse' : progress.progress > 80 ? 'bg-accent' : 'bg-white/30'}`} />
                <span>Building your personas</span>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-8 py-16">
        <SetupProgress currentStep={3} />

        <div className="text-center mb-12 animate-fade-in">
          <h1 className="text-3xl font-bold text-white mb-4">Import Your Data</h1>
          <p className="text-lg text-white/60 max-w-2xl mx-auto">
            Upload exports from Gmail, Amazon, ChatGPT, Claude, or Notion to build your personal context vault.
          </p>
        </div>

        <div className="w-full max-w-3xl mb-8 animate-slide-up">
          <ImportZone
            onFileDrop={handleFileDrop}
            accept=".json"
            ariaLabel="Upload your ChatGPT conversations.json file"
            idleTitle="Drop your ChatGPT export here"
            dropTitle="Drop your file here"
            idleDescription="Or click to browse and select your conversations.json file"
            dropDescription="Release to upload your conversations.json file"
            supportedFormatsText="conversations.json"
          />

          {/* Divider */}
          <div className="flex items-center gap-4 my-6">
            <div className="flex-1 h-px bg-white/10" />
            <span className="text-text-tertiary text-sm">or</span>
            <div className="flex-1 h-px bg-white/10" />
          </div>

          {/* Sample data CTA */}
          <button
            onClick={handleSampleData}
            className="w-full py-3.5 rounded-lg font-medium text-white border border-accent/40 bg-accent/5 hover:bg-accent/10 hover:border-accent/60 transition-all flex items-center justify-center gap-2"
          >
            <Sparkles className="w-4 h-4 text-accent" />
            Try with Sample Data
            <span className="text-text-secondary text-xs ml-1">— no file needed</span>
          </button>
        </div>

        <div className="flex items-center gap-4 mb-8">
          <button
            onClick={() => setView('chooser')}
            className="text-text-tertiary hover:text-white transition-colors text-sm"
          >
            Back
          </button>
        </div>

        <div className="text-center text-white/40 text-sm max-w-2xl space-y-2">
          <p className="text-white/60 font-medium text-xs uppercase tracking-wider mb-3">How to export your data</p>
          <p><strong className="text-white/60">ChatGPT:</strong> Settings → Data Controls → Export Data</p>
          <p><strong className="text-white/60">Gmail:</strong> Google Takeout → select Gmail → Export</p>
          <p><strong className="text-white/60">Amazon:</strong> Account → Request My Data → Order History</p>
          <p><strong className="text-white/60">Claude:</strong> Settings → Account → Export Data</p>
          <p><strong className="text-white/60">Notion:</strong> Settings → Export all workspace content</p>
        </div>
      </div>
    );
  }

  // Chooser view — 3 option cards
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-8 py-16">
      <SetupProgress currentStep={3} />

      <div className="text-center mb-12 animate-fade-in">
        <h1 className="text-3xl font-bold text-white mb-4">Teach AI About You</h1>
        <p className="text-lg text-white/70 max-w-2xl mx-auto">
          The more Personafy knows, the less you have to repeat yourself. Pick one — or skip for now.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-4xl mb-8 stagger-children">
        {/* Quick Questions */}
        <button
          onClick={() => setView('questions')}
          className="glass-card p-6 text-left hover:border-accent/40 transition-all duration-300 group"
        >
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-500 to-purple-400 flex items-center justify-center mb-4">
            <Sparkles className="w-6 h-6 text-white" />
          </div>
          <h3 className="text-white font-semibold text-lg mb-2 group-hover:text-accent transition-colors">
            Answer 5 Quick Questions
          </h3>
          <p className="text-text-secondary text-sm leading-relaxed mb-1">
            Five quick picks about your style, food, travel, and more.
          </p>
          <span className="text-xs text-text-tertiary font-medium">~1 min · all optional</span>
        </button>

        {/* Import Data */}
        <button
          onClick={() => setView('import')}
          className="glass-card p-6 text-left hover:border-accent/40 transition-all duration-300 group"
        >
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center mb-4">
            <Upload className="w-6 h-6 text-white" />
          </div>
          <h3 className="text-white font-semibold text-lg mb-2 group-hover:text-accent transition-colors">
            Import Your Data
          </h3>
          <p className="text-text-secondary text-sm leading-relaxed mb-3">
            Upload from Gmail, Amazon, ChatGPT, Claude, or Notion.
          </p>
          <span className="text-xs text-text-tertiary font-medium">~2 min</span>
        </button>

        {/* Skip — visually de-emphasized */}
        <button
          onClick={onSkip}
          className="glass-card p-6 text-left border-card-border/30 opacity-80 hover:opacity-100 hover:border-card-border/50 transition-all duration-300 group"
        >
          <div className="w-12 h-12 rounded-2xl bg-white/10 flex items-center justify-center mb-4">
            <ArrowRight className="w-6 h-6 text-text-secondary" />
          </div>
          <h3 className="text-text-secondary font-semibold text-lg mb-2 group-hover:text-white transition-colors">
            I'll Do This Later
          </h3>
          <p className="text-text-tertiary text-sm leading-relaxed mb-3">
            Head to your dashboard and add stuff as you go.
          </p>
          <span className="text-xs text-text-tertiary font-medium">Jump right in</span>
        </button>
      </div>

      <div className="flex flex-col items-center gap-3">
        {onBack && (
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-text-tertiary hover:text-white transition-colors text-sm"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back
          </button>
        )}
        <p className="text-white/40 text-sm">
          All roads lead to the same place. You can always add more later.
        </p>
      </div>
    </div>
  );
}
