import { useState, useMemo, useEffect } from 'react';
import '../browse/browser-themes.css';
import { Bot } from 'lucide-react';
import { ExtractionHighlight } from '../../components/ExtractionHighlight';
import type { ClaudeExport } from '../../lib/claude-extractor';
import { loadCanonicalSourceDataset } from '../../lib/canonical-package-lineage';
import { extractMessageMatches } from './browse-utils';
import { FactsSidebar } from './FactsSidebar';
import { SearchInput } from './SearchInput';
import {
  buildClaudeGeneralRecords,
  extractBrowseFactsFromRecords,
} from './record-fact-extraction';

// -- Helpers ------------------------------------------------------------------

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// -- Main Component -----------------------------------------------------------

interface ClaudeBrowserProps {
  persona: string;
  className?: string;
}

export function ClaudeBrowser({ persona, className }: ClaudeBrowserProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [factsOpen, setFactsOpen] = useState(true);

  // Lazy-load persona data on demand
  const [conversations, setConversations] = useState<ClaudeExport[]>([]);
  const [loading, setLoading] = useState(true);
  const [prevPersona, setPrevPersona] = useState(persona);
  if (persona !== prevPersona) { setPrevPersona(persona); setLoading(true); }
  useEffect(() => {
    let cancelled = false;
    loadCanonicalSourceDataset<ClaudeExport>('claude', persona)
      .then(data => { if (!cancelled) setConversations(data); })
      .catch(err => { if (!cancelled) { console.error('Failed to load data:', err); setConversations([]); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [persona]);

  // Filter conversations by search
  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return conversations;
    const q = searchQuery.toLowerCase();
    return conversations.filter(c => c.name.toLowerCase().includes(q));
  }, [conversations, searchQuery]);

  // Clamp selection to valid range
  const safeSelectedIndex = filtered.length > 0 ? Math.min(selectedIndex, filtered.length - 1) : 0;
  const selectedConversation = filtered[safeSelectedIndex] ?? null;

  // Run extraction on selected conversation for facts sidebar
  const extractionResults = useMemo(() => {
    if (!selectedConversation) return { facts: [] as Array<{ key: string; value: string; confidence: number; category: string }> };
    const facts = extractBrowseFactsFromRecords(buildClaudeGeneralRecords(selectedConversation));
    return { facts };
  }, [selectedConversation]);

  if (loading) {
    return (
      <div className={className ?? "flex items-center justify-center h-[calc(100vh-280px)] min-h-[500px] mt-4"}>
        <p className="text-[#8a8784] text-sm">Loading conversations...</p>
      </div>
    );
  }

  return (
    <div className={className ? `claude-browser bg-[#faf9f6] rounded-lg overflow-hidden border border-[#e0dcd4] flex gap-0 ${className}` : "claude-browser bg-[#faf9f6] rounded-lg overflow-hidden border border-[#e0dcd4] flex gap-0 h-[calc(100vh-280px)] min-h-[500px] mt-4"}>
      {/* LEFT: Sidebar */}
      <div className="w-[300px] flex-shrink-0 flex flex-col border-r border-[#e0dcd4] bg-[#f3f0eb]">
        {/* Claude heading + New conversation */}
        <div className="p-3 border-b border-[#e0dcd4]">
          <div className="text-[#2d2b28] text-base font-semibold mb-3">Claude</div>
          <button className="bg-[#da7756] text-white rounded-lg text-sm py-2 px-3 w-full hover:opacity-90 transition-opacity">
            New conversation
          </button>
        </div>

        {/* Search */}
        <div className="p-3 border-b border-[#e0dcd4]">
          <SearchInput value={searchQuery} onChange={setSearchQuery} placeholder="Search conversations..." theme="claude" />
        </div>

        {/* Count */}
        <div className="px-3 py-1.5 border-b border-[#e0dcd4] text-[11px] text-[#8a8784]">
          {filtered.length} conversation{filtered.length !== 1 ? 's' : ''}
        </div>

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto">
          {filtered.map((conv, i) => {
            const msgCount = conv.chat_messages.length;
            const isSelected = i === safeSelectedIndex;

            return (
              <button
                key={conv.uuid}
                onClick={() => setSelectedIndex(i)}
                className={`w-full text-left px-3 py-3 border-b border-[#e0dcd4]/30 transition-colors ${
                  isSelected
                    ? 'bg-[#ebe8e2]'
                    : 'hover:bg-[#e0dace]'
                }`}
              >
                <div className="text-sm font-medium truncate mb-0.5 text-[#2d2b28]">
                  {conv.name}
                </div>
                <div className="flex items-center gap-2 text-[10px] text-[#8a8784]">
                  <span>{formatDate(conv.created_at)}</span>
                  <span className="w-1 h-1 rounded-full bg-[#8a8784]/40" />
                  <span>{msgCount} message{msgCount !== 1 ? 's' : ''}</span>
                </div>
              </button>
            );
          })}

          {filtered.length === 0 && (
            <div className="px-3 py-8 text-center text-[#8a8784] text-sm">
              No conversations match your search
            </div>
          )}
        </div>
      </div>

      {/* RIGHT: Chat message view */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {selectedConversation ? (
          <>
            {/* Conversation header */}
            <div className="p-4 border-b border-[#e0dcd4]">
              <h2 className="text-lg font-medium text-[#2d2b28] mb-1">
                {selectedConversation.name}
              </h2>
              <div className="flex items-center gap-3 text-xs text-[#8a8784]">
                <span>{formatDate(selectedConversation.created_at)}</span>
                <span className="w-1 h-1 rounded-full bg-[#8a8784]/40" />
                <span>{selectedConversation.chat_messages.length} messages</span>
              </div>
            </div>

            {/* Chat messages + facts sidebar */}
            <div className="flex-1 flex min-h-0 overflow-hidden">
              {/* Messages area */}
              <div className="flex-1 overflow-y-auto">
                {selectedConversation.chat_messages.map((msg) => {
                  const isHuman = msg.sender === 'human';
                  const rawMatches = isHuman ? extractMessageMatches(msg.text) : [];
                  // Filter highlights to only show matches that correspond to sidebar facts
                  const matches = rawMatches.filter(m => {
                    const matchedText = msg.text.slice(m.start, m.end).toLowerCase();
                    return extractionResults.facts.some(f =>
                      f.value.toLowerCase().includes(matchedText) ||
                      matchedText.includes(f.value.toLowerCase())
                    );
                  });

                  return (
                    <div
                      key={msg.uuid}
                      className="w-full py-6 bg-[#faf9f6]"
                    >
                      <div className="max-w-[768px] mx-auto px-4 flex gap-4">
                        <div className={`w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-medium text-white ${isHuman ? 'bg-[#9b8579]' : 'bg-[#da7756]'}`}>
                          {isHuman ? 'H' : 'C'}
                        </div>
                        <div className="flex-1 text-sm leading-[1.7] text-[#2d2b28]">
                          {isHuman && matches.length > 0 ? (
                            <ExtractionHighlight
                              text={msg.text}
                              matches={matches}
                              showTooltips
                              theme="warm"
                            />
                          ) : (
                            <span className="whitespace-pre-wrap">{msg.text}</span>
                          )}
                          <div className="text-[9px] text-[#8a8784]/60 mt-2 hidden">
                            {formatTime(msg.created_at)}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Extracted facts sidebar */}
              <FactsSidebar
                facts={extractionResults.facts}
                isOpen={factsOpen}
                onToggle={() => setFactsOpen(!factsOpen)}
                theme="warm"
              />
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-[#8a8784]">
            <div className="text-center">
              <Bot className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm">Select a conversation to view messages</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
