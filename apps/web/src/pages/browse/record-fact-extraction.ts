import type { ExtractionMatch } from '../../components/ExtractionHighlight';
import {
  extractGeneralFactsWithEvidence,
  type GeneralExtractedFact,
  type GeneralExtractionRecord,
} from '../../lib/general-extractor';
import type { ClaudeExport } from '../../lib/claude-extractor';
import type { GmailEmail } from '../../lib/gmail-extractor';
import type { NotionPage } from '../../lib/notion-extractor';
import type { ChatGPTExport } from '../../lib/types';

export interface BrowseFact {
  key: string;
  value: string;
  confidence: number;
  category: string;
}

function categoryFromFactKey(key: string): string {
  const normalized = key.trim().toLowerCase();
  if (!normalized) return 'Other';

  if (normalized.startsWith('apparel.') || normalized.startsWith('shopping.')) return 'Shopping';
  if (
    normalized.startsWith('travel.')
    || normalized.startsWith('flight.')
    || normalized.startsWith('hotel.')
    || normalized.startsWith('location.')
  ) {
    return 'Travel';
  }
  if (
    normalized.startsWith('food.')
    || normalized.startsWith('dietary.')
    || normalized.startsWith('restaurant.')
    || normalized.startsWith('cuisine.')
  ) {
    return 'Food & Dining';
  }
  if (
    normalized.startsWith('fitness.')
    || normalized.startsWith('exercise.')
    || normalized.startsWith('workout.')
    || normalized.startsWith('sports.')
  ) {
    return 'Fitness';
  }
  if (normalized.startsWith('work.') || normalized.startsWith('career.') || normalized.startsWith('apps.')) {
    return 'Work';
  }
  if (normalized.startsWith('gifts.') || normalized.startsWith('gift.')) return 'Gift Giving';
  if (normalized.startsWith('entertainment.') || normalized.startsWith('media.')) return 'Entertainment';
  if (normalized.startsWith('home.') || normalized.startsWith('living.') || normalized.startsWith('pets.')) {
    return 'Home & Living';
  }
  if (normalized.startsWith('health.') || normalized.startsWith('wellness.') || normalized.startsWith('sleep.')) {
    return 'Health & Wellness';
  }
  if (normalized.startsWith('finance.') || normalized.startsWith('money.') || normalized.startsWith('budget.')) {
    return 'Finance';
  }

  return 'Other';
}

function toBrowseFact(fact: GeneralExtractedFact): BrowseFact {
  return {
    key: fact.key,
    value: fact.value,
    confidence: fact.confidence,
    category: categoryFromFactKey(fact.key),
  };
}

export function extractBrowseFactsFromRecords(records: GeneralExtractionRecord[]): BrowseFact[] {
  return extractGeneralFactsWithEvidence(records).map(toBrowseFact);
}

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

export function buildChatGptConversationRecords(conversation: ChatGPTExport): GeneralExtractionRecord[] {
  if (!conversation.mapping || typeof conversation.mapping !== 'object') return [];
  const mappingValues = Object.values(conversation.mapping);

  return mappingValues
    .map((node, messageIndex) => {
      if (!node || typeof node !== 'object') return null;
      const nodeRecord = node as Record<string, unknown>;
      const message = nodeRecord.message;
      if (!message || typeof message !== 'object') return null;

      const author = (message as Record<string, unknown>).author;
      const role = normalizeRole((author as Record<string, unknown> | null)?.role);
      if (role !== 'user') return null;

      const content = extractMessageText(message);
      if (!content) return null;

      const nodeId = typeof nodeRecord.id === 'string'
        ? (nodeRecord.id as string)
        : `node-${messageIndex + 1}`;

      return {
        sourceType: 'chatgpt' as const,
        sourceId: `chatgpt:${nodeId}`,
        sourceName: `ChatGPT: ${conversation.title || 'Untitled Conversation'}`,
        content,
      };
    })
    .filter((record): record is NonNullable<typeof record> => record !== null);
}

export function buildClaudeGeneralRecords(conversation: ClaudeExport): GeneralExtractionRecord[] {
  return conversation.chat_messages
    .filter((message) => {
      const sender = typeof message.sender === 'string' ? message.sender.trim().toLowerCase() : '';
      return sender === 'human' || sender === 'user';
    })
    .map((message) => ({
      sourceType: 'claude' as const,
      sourceId: message.uuid,
      sourceName: `Claude: ${conversation.name}`,
      content: message.text,
    }))
    .filter((record) => record.content.trim().length > 0);
}

export function buildNotionGeneralRecords(page: NotionPage): GeneralExtractionRecord[] {
  const propsText = page.properties
    ? Object.entries(page.properties)
      .map(([key, value]) => `${key}: ${value}`)
      .join('. ')
    : '';

  return [{
    sourceType: 'notion',
    sourceId: page.id,
    sourceName: `Notion: ${page.title}`,
    content: `${page.title}. ${page.content}. ${propsText}`,
  }];
}

export function buildGmailGeneralRecords(emails: GmailEmail[]): GeneralExtractionRecord[] {
  return emails.map((email) => ({
    sourceType: 'gmail',
    sourceId: email.id,
    sourceName: `Gmail: ${email.subject}`,
    content: `${email.subject}. ${email.body}`,
  }));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildExtractionMatchesFromFactValues(
  text: string,
  facts: BrowseFact[],
  maxMatchesPerFact = 4,
): ExtractionMatch[] {
  if (!text.trim() || facts.length === 0) return [];

  const matches: ExtractionMatch[] = [];
  const signatures = new Set<string>();

  for (const fact of facts) {
    const value = fact.value.trim();
    if (value.length < 3) continue;

    const regex = new RegExp(escapeRegExp(value), 'gi');
    let count = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      const signature = `${fact.key}:${start}:${end}`;
      if (signatures.has(signature)) continue;
      signatures.add(signature);

      matches.push({
        start,
        end,
        factKey: fact.key,
        category: fact.category,
        confidence: fact.confidence,
      });

      count += 1;
      if (count >= maxMatchesPerFact) break;
    }
  }

  return matches.sort((a, b) => a.start - b.start || b.end - a.end);
}
