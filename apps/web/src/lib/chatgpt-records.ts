import type { Fact, ChatGPTExport } from './types';
import {
  extractGeneralFactsWithEvidence,
  type GeneralExtractionRecord,
} from './general-extractor';

function normalizeRole(role: unknown): string {
  if (typeof role !== 'string') return '';
  const normalized = role.trim().toLowerCase();
  if (normalized === 'human') return 'user';
  if (normalized === 'bot') return 'assistant';
  return normalized;
}

function collectTextFragments(value: unknown, fragments: string[], depth = 0): void {
  if (value == null || depth > 5) return;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed) fragments.push(trimmed);
    return;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    fragments.push(String(value));
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectTextFragments(item, fragments, depth + 1);
    return;
  }

  if (typeof value !== 'object') return;

  const record = value as Record<string, unknown>;
  collectTextFragments(record.text, fragments, depth + 1);
  collectTextFragments(record.content, fragments, depth + 1);
  collectTextFragments(record.parts, fragments, depth + 1);
}

function extractMessageText(message: unknown): string {
  if (!message || typeof message !== 'object') return '';
  const record = message as Record<string, unknown>;
  const fragments: string[] = [];
  collectTextFragments(record.content, fragments);
  collectTextFragments(record.text, fragments);
  return fragments.join(' ').trim();
}

export function buildChatGptGeneralRecords(conversations: ChatGPTExport[]): GeneralExtractionRecord[] {
  const records: GeneralExtractionRecord[] = [];

  conversations.forEach((conversation, conversationIndex) => {
    if (!conversation.mapping || typeof conversation.mapping !== 'object') return;

    const mappingValues = Object.values(conversation.mapping);
    mappingValues.forEach((node, messageIndex) => {
      if (!node || typeof node !== 'object') return;
      const nodeRecord = node as Record<string, unknown>;
      const message = nodeRecord.message;
      if (!message || typeof message !== 'object') return;

      const author = (message as Record<string, unknown>).author;
      const role = normalizeRole((author as Record<string, unknown> | null)?.role);
      if (role !== 'user') return;

      const content = extractMessageText(message);
      if (!content) return;

      const nodeId = typeof nodeRecord.id === 'string'
        ? (nodeRecord.id as string)
        : `node-${conversationIndex + 1}-${messageIndex + 1}`;

      records.push({
        sourceType: 'chatgpt',
        sourceId: `chatgpt:${nodeId}`,
        sourceName: `ChatGPT: ${conversation.title || 'Untitled Conversation'}`,
        content,
      });
    });
  });

  return records;
}

export function extractChatGptGeneralFacts(conversations: ChatGPTExport[]): Fact[] {
  return extractGeneralFactsWithEvidence(buildChatGptGeneralRecords(conversations)) as Fact[];
}
