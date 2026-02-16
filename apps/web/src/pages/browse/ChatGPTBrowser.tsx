import { useState, useMemo, useEffect } from 'react';
import '../browse/browser-themes.css';
import { Pencil } from 'lucide-react';
import { ExtractionHighlight } from '../../components/ExtractionHighlight';
import type { ChatGPTExport, ChatGPTNode } from '../../lib/types';
import { loadCanonicalSourceDataset } from '../../lib/canonical-package-lineage';
import { extractMessageMatches } from './browse-utils';
import { FactsSidebar } from './FactsSidebar';
import { SearchInput } from './SearchInput';
import {
  buildChatGptConversationRecords,
  extractBrowseFactsFromRecords,
} from './record-fact-extraction';

// -- ChatGPT mapping tree walker ----------------------------------------------

interface FlatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  create_time: number;
}

function walkMapping(mapping: Record<string, ChatGPTNode>): FlatMessage[] {
  // Find root node (no parent or parent is null)
  let rootId: string | null = null;
  for (const [id, node] of Object.entries(mapping)) {
    if (!node.parent) {
      rootId = id;
      break;
    }
  }

  if (!rootId) return [];

  // Walk children chain from root
  const messages: FlatMessage[] = [];
  const visited = new Set<string>();
  const queue = [rootId];

  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);

    const node = mapping[nodeId];
    if (!node) continue;

    if (node.message) {
      const role = node.message.author.role;
      const parts = node.message.content?.parts ?? [];
      const content = parts.filter((p): p is string => typeof p === 'string').join(' ');

      if (content && (role === 'user' || role === 'assistant')) {
        messages.push({
          id: node.id,
          role,
          content,
          create_time: node.message.create_time ?? 0,
        });
      }
    }

    // Add children to queue
    for (const childId of node.children) {
      queue.push(childId);
    }
  }

  return messages.sort((a, b) => a.create_time - b.create_time);
}

// -- Helpers ------------------------------------------------------------------

function formatTimestamp(epoch: number): string {
  if (!epoch) return '';
  const d = new Date(epoch * 1000);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatMessageTime(epoch: number, msgIndex = 0): string {
  if (!epoch) return '';
  // Add per-message offset so sequential messages show different times
  const d = new Date((epoch + msgIndex * 47) * 1000);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// -- Main Component -----------------------------------------------------------

interface ChatGPTBrowserProps {
  persona: string;
  className?: string;
}

export function ChatGPTBrowser({ persona, className }: ChatGPTBrowserProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [factsOpen, setFactsOpen] = useState(true);

  // Lazy-load persona data on demand
  const [conversations, setConversations] = useState<ChatGPTExport[]>([]);
  const [loading, setLoading] = useState(true);
  const [prevPersona, setPrevPersona] = useState(persona);
  if (persona !== prevPersona) { setPrevPersona(persona); setLoading(true); }
  useEffect(() => {
    let cancelled = false;
    loadCanonicalSourceDataset<ChatGPTExport>('chatgpt', persona)
      .then(data => { if (!cancelled) setConversations(data); })
      .catch(err => { if (!cancelled) { console.error('Failed to load data:', err); setConversations([]); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [persona]);

  // Filter conversations by search
  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return conversations;
    const q = searchQuery.toLowerCase();
    return conversations.filter(c => c.title.toLowerCase().includes(q));
  }, [conversations, searchQuery]);

  // Clamp selection to valid range
  const safeSelectedIndex = filtered.length > 0 ? Math.min(selectedIndex, filtered.length - 1) : 0;
  const selectedConversation = filtered[safeSelectedIndex] ?? null;

  // Extract messages from selected conversation
  const messages = useMemo(() => {
    if (!selectedConversation) return [];
    return walkMapping(selectedConversation.mapping);
  }, [selectedConversation]);

  // Run extraction on user messages for facts sidebar
  const extractionResults = useMemo(() => {
    if (!selectedConversation) return { facts: [] as Array<{ key: string; value: string; confidence: number; category: string }> };
    const facts = extractBrowseFactsFromRecords(buildChatGptConversationRecords(selectedConversation));
    return { facts };
  }, [selectedConversation]);

  if (loading) {
    return (
      <div className={className ?? "flex items-center justify-center h-[calc(100vh-280px)] min-h-[500px] mt-4"}>
        <p className="text-text-tertiary text-sm">Loading conversations...</p>
      </div>
    );
  }

  return (
    <div className={className ? `chatgpt-browser rounded-lg overflow-hidden border border-[#e5e5e5] flex gap-0 ${className}` : "chatgpt-browser rounded-lg overflow-hidden border border-[#e5e5e5] flex gap-0 h-[calc(100vh-280px)] min-h-[500px] mt-4"}>
      {/* LEFT: Sidebar */}
      <div className="w-[260px] flex-shrink-0 flex flex-col bg-[#f9f9f9]">
        {/* New chat button */}
        <div className="p-2">
          <button className="w-full flex items-center gap-3 px-3 py-3 rounded-lg text-sm text-[#0d0d0d] hover:bg-[#ececec] transition-colors">
            <Pencil className="w-4 h-4" />
            New chat
          </button>
        </div>

        {/* Search */}
        <div className="px-2 pb-2">
          <SearchInput value={searchQuery} onChange={setSearchQuery} placeholder="Search conversations..." theme="chatgpt" />
        </div>

        {/* Count */}
        <div className="px-3 py-1.5 text-[11px] text-[#6e6e80]">
          {filtered.length} conversation{filtered.length !== 1 ? 's' : ''}
        </div>

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto">
          {filtered.map((conv, i) => {
            const isSelected = i === safeSelectedIndex;

            return (
              <button
                key={`${conv.title}-${i}`}
                onClick={() => setSelectedIndex(i)}
                className={`w-full text-left px-3 py-3 transition-colors rounded-lg mx-0 ${
                  isSelected
                    ? 'bg-[#ececec]'
                    : 'hover:bg-[#f0f0f0]'
                }`}
              >
                <div className={`text-sm truncate ${isSelected ? 'text-[#0d0d0d]' : 'text-[#6e6e80]'}`}>
                  {conv.title}
                </div>
              </button>
            );
          })}

          {filtered.length === 0 && (
            <div className="px-3 py-8 text-center text-[#6e6e80] text-sm">
              No conversations match your search
            </div>
          )}
        </div>
      </div>

      {/* RIGHT: Chat message view */}
      <div className="flex-1 flex flex-col overflow-hidden bg-white">
        {selectedConversation ? (
          <>
            {/* Conversation header */}
            <div className="px-4 py-3 border-b border-[#e5e5e5] bg-white flex items-center justify-between">
              <div>
                <h2 className="text-base font-medium text-[#0d0d0d]">
                  {selectedConversation.title}
                </h2>
                <div className="flex items-center gap-3 text-xs text-[#6e6e80] mt-0.5">
                  <span>Model: ChatGPT-4</span>
                  <span className="w-1 h-1 rounded-full bg-[#6e6e80]/40" />
                  <span>{formatTimestamp(selectedConversation.create_time)}</span>
                  <span className="w-1 h-1 rounded-full bg-[#6e6e80]/40" />
                  <span>{messages.length} messages</span>
                </div>
              </div>
            </div>

            {/* Chat messages + facts sidebar */}
            <div className="flex-1 flex min-h-0 overflow-hidden">
              {/* Messages area */}
              <div className="flex-1 overflow-y-auto">
                <div className="max-w-[768px] mx-auto px-4 py-4">
                  {messages.map((msg, mi) => {
                    const isUser = msg.role === 'user';
                    const rawMatches = isUser ? extractMessageMatches(msg.content) : [];
                    // Filter highlights to only show matches that correspond to sidebar facts
                    const matches = rawMatches.filter(m => {
                      const matchedText = msg.content.slice(m.start, m.end).toLowerCase();
                      return extractionResults.facts.some(f =>
                        f.value.toLowerCase().includes(matchedText) ||
                        matchedText.includes(f.value.toLowerCase())
                      );
                    });

                    if (isUser) {
                      // User message: right-aligned rounded bubble
                      return (
                        <div key={msg.id} className="flex justify-end mb-4">
                          <div className="bg-[#f4f4f4] rounded-3xl px-5 py-3 max-w-[70%]">
                            <div className="text-sm leading-relaxed text-[#0d0d0d]">
                              {matches.length > 0 ? (
                                <ExtractionHighlight
                                  text={msg.content}
                                  matches={matches}
                                  showTooltips
                                  theme="light"
                                />
                              ) : (
                                <span className="whitespace-pre-wrap">{msg.content}</span>
                              )}
                            </div>
                            <div className="text-[10px] text-[#6e6e80]/60 mt-1.5 text-right">
                              {formatMessageTime(msg.create_time, mi)}
                            </div>
                          </div>
                        </div>
                      );
                    }

                    // Assistant message: left-aligned, no background
                    return (
                      <div key={msg.id} className="mb-6">
                        <div className="flex items-center gap-2 mb-2">
                          <div className="bg-[#0d0d0d] w-6 h-6 rounded-full flex items-center justify-center">
                            <span className="text-white text-xs font-medium">G</span>
                          </div>
                          <span className="text-sm font-medium text-[#0d0d0d]">ChatGPT</span>
                        </div>
                        <div className="text-sm leading-relaxed text-[#0d0d0d] pl-0">
                          <span className="whitespace-pre-wrap">{msg.content}</span>
                        </div>
                        <div className="text-[10px] text-[#6e6e80]/60 mt-2">
                          {formatMessageTime(msg.create_time, mi)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Extracted facts sidebar */}
              <FactsSidebar
                facts={extractionResults.facts}
                isOpen={factsOpen}
                onToggle={() => setFactsOpen(!factsOpen)}
                theme="light"
              />
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <Pencil className="w-12 h-12 mx-auto mb-3 text-[#6e6e80] opacity-30" />
              <p className="text-sm text-[#6e6e80]">Select a conversation to view messages</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
