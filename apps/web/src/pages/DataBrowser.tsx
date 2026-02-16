import { useState } from 'react';
import { Layout } from '../components/Layout';
import { PersonaSelector } from '../components/PersonaSelector';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { Mail, ShoppingBag, MessageSquare, Bot, FileText } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { getSourceLineage } from '../lib/canonical-package-lineage';
import type { SourceType } from '../lib/source-types';
import { GmailBrowser } from './browse/GmailBrowser';
import { AmazonBrowser } from './browse/AmazonBrowser';
import { ChatGPTBrowser } from './browse/ChatGPTBrowser';
import { ClaudeBrowser } from './browse/ClaudeBrowser';
import { NotionBrowser } from './browse/NotionBrowser';

interface DataBrowserProps {
  userName?: string;
  userInitials?: string;
  onNavClick?: (itemId: string) => void;
}

interface TabDef {
  id: string;
  label: string;
  icon: LucideIcon;
  available: boolean;
}

const TABS: TabDef[] = [
  { id: 'gmail', label: 'Gmail', icon: Mail, available: true },
  { id: 'amazon', label: 'Amazon', icon: ShoppingBag, available: true },
  { id: 'chatgpt', label: 'ChatGPT', icon: MessageSquare, available: true },
  { id: 'claude', label: 'Claude', icon: Bot, available: true },
  { id: 'notion', label: 'Notion', icon: FileText, available: true },
];

export function DataBrowser({
  userName,
  userInitials,
  onNavClick,
}: DataBrowserProps) {
  useDocumentTitle('Data Browser');

  const [persona, setPersona] = useState('all');
  const [activeTab, setActiveTab] = useState('gmail');
  const activeSource = activeTab as SourceType;
  const lineage = getSourceLineage(activeSource, persona);

  return (
    <Layout activeNav="data-browser" userName={userName} userInitials={userInitials} onNavClick={onNavClick}>
      <div className="p-6 md:p-8 max-w-7xl">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white mb-1">Data Browser</h1>
          <p className="text-text-secondary text-sm">
            Explore canonical synthetic source data and see how Personafy extracts preference facts.
          </p>
        </div>

        {/* Persona selector */}
        <PersonaSelector selected={persona} onSelect={setPersona} />

        {/* Tab bar */}
        <div className="flex items-center gap-1 border-b border-card-border/50 mb-0">
          {TABS.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;

            return (
              <button
                key={tab.id}
                onClick={() => tab.available && setActiveTab(tab.id)}
                disabled={!tab.available}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-all ${
                  isActive
                    ? 'border-primary text-white'
                    : tab.available
                    ? 'border-transparent text-text-tertiary hover:text-text-secondary hover:border-white/20'
                    : 'border-transparent text-text-tertiary/40 cursor-not-allowed'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{tab.label}</span>
                {!tab.available && (
                  <span className="text-[9px] uppercase tracking-wider text-text-tertiary/40 ml-1">
                    Soon
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Tab content */}
        {activeTab === 'gmail' && <GmailBrowser persona={persona} />}
        {activeTab === 'amazon' && <AmazonBrowser persona={persona} />}
        {activeTab === 'chatgpt' && <ChatGPTBrowser persona={persona} />}
        {activeTab === 'claude' && <ClaudeBrowser persona={persona} />}
        {activeTab === 'notion' && <NotionBrowser persona={persona} />}

        {/* Canonical lineage footer */}
        <div className="mt-4 px-4 py-3 rounded-lg border border-card-border/40 bg-card/30 text-[11px] text-text-tertiary flex flex-wrap items-center gap-2">
          <span className="font-medium text-text-secondary">Fixture lineage</span>
          <span className="px-2 py-0.5 rounded-full border border-card-border/50 bg-white/5">
            Source {lineage.sourceType}
          </span>
          <span className="px-2 py-0.5 rounded-full border border-card-border/50 bg-white/5">
            Persona {persona === 'all' ? `all (${lineage.personaIds.length})` : lineage.personaIds[0]}
          </span>
          <span className="px-2 py-0.5 rounded-full border border-card-border/50 bg-white/5">
            Package v{lineage.packageVersion}
          </span>
          <span className="px-2 py-0.5 rounded-full border border-card-border/50 bg-white/5">
            Build {lineage.buildDate}
          </span>
        </div>
      </div>
    </Layout>
  );
}
