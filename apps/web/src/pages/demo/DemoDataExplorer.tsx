import { useState } from 'react';
import { Mail, ShoppingBag, MessageSquare, Bot, FileText, ArrowRight, Lightbulb } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { GmailBrowser } from '../browse/GmailBrowser';
import { AmazonBrowser } from '../browse/AmazonBrowser';
import { ChatGPTBrowser } from '../browse/ChatGPTBrowser';
import { ClaudeBrowser } from '../browse/ClaudeBrowser';
import { NotionBrowser } from '../browse/NotionBrowser';
import '../browse/browser-themes.css';

interface TabDef {
  id: string;
  label: string;
  icon: LucideIcon;
}

const SOURCE_TABS: TabDef[] = [
  { id: 'gmail', label: 'Gmail', icon: Mail },
  { id: 'amazon', label: 'Amazon', icon: ShoppingBag },
  { id: 'chatgpt', label: 'ChatGPT', icon: MessageSquare },
  { id: 'claude', label: 'Claude', icon: Bot },
  { id: 'notion', label: 'Notion', icon: FileText },
];

const BROWSER_HEIGHT = 'h-[calc(100vh-420px)] min-h-[400px]';

interface DemoDataExplorerProps {
  personaId: string;
  onContinue: () => void;
}

export function DemoDataExplorer({ personaId, onContinue }: DemoDataExplorerProps) {
  const [activeSource, setActiveSource] = useState('gmail');

  return (
    <div className="min-h-screen flex flex-col px-8 py-12 max-w-6xl mx-auto animate-fade-in">
      {/* Header */}
      <div className="mb-4">
        <h2 className="text-2xl font-bold text-white mb-2">Browse their data</h2>
        <p className="text-text-secondary">
          Personafy connects to your existing data sources and extracts meaningful preferences.
        </p>
      </div>

      {/* Education Callout — above tabs for immediate context */}
      <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-accent/5 border border-accent/20 mb-4">
        <Lightbulb className="w-4 h-4 text-accent flex-shrink-0" />
        <p className="text-text-secondary text-sm">
          <span className="text-accent font-medium">Highlighted text</span> shows extracted preferences.
          Each color = a different category. Your data never leaves your device.
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-1 border-b border-card-border/50 mb-0">
        {SOURCE_TABS.map(tab => {
          const Icon = tab.icon;
          const isActive = activeSource === tab.id;

          return (
            <button
              key={tab.id}
              onClick={() => setActiveSource(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-all ${
                isActive
                  ? 'border-primary text-white'
                  : 'border-transparent text-text-tertiary hover:text-text-secondary hover:border-white/20'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Browser content */}
      <div className="flex-1 min-h-0">
        {activeSource === 'gmail' && <GmailBrowser persona={personaId} className={BROWSER_HEIGHT} />}
        {activeSource === 'amazon' && <AmazonBrowser persona={personaId} className={BROWSER_HEIGHT} />}
        {activeSource === 'chatgpt' && <ChatGPTBrowser persona={personaId} className={BROWSER_HEIGHT} />}
        {activeSource === 'claude' && <ClaudeBrowser persona={personaId} className={BROWSER_HEIGHT} />}
        {activeSource === 'notion' && <NotionBrowser persona={personaId} className={BROWSER_HEIGHT} />}
      </div>

      {/* Continue Button */}
      <div className="flex justify-end mt-8">
        <button onClick={onContinue} className="btn-primary flex items-center gap-2">
          Review full profile <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
