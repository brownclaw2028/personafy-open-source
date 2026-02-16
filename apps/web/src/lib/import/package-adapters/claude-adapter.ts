import type { ClaudeExport, ClaudeMessage } from '../../claude-extractor';
import type { PackageAdapter } from './types';
import { findFile } from './helpers';

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
}

function pickFirstString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return null;
}

function normalizeSender(value: unknown): string {
  if (typeof value !== 'string') return 'unknown';
  const normalized = value.trim().toLowerCase();
  if (!normalized) return 'unknown';
  if (normalized === 'human' || normalized === 'user' || normalized === 'assistant') {
    return normalized;
  }
  if (normalized === 'claude' || normalized === 'bot' || normalized === 'model') {
    return 'assistant';
  }
  if (normalized === 'customer' || normalized === 'person') {
    return 'human';
  }
  return normalized;
}

function collectText(value: unknown, fragments: string[], depth = 0): void {
  if (value === null || value === undefined || depth > 4) return;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed) fragments.push(trimmed);
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectText(item, fragments, depth + 1));
    return;
  }

  if (typeof value !== 'object') return;

  const record = value as Record<string, unknown>;
  const directTextKeys = ['text', 'content', 'value'];
  for (const key of directTextKeys) {
    if (typeof record[key] === 'string') {
      collectText(record[key], fragments, depth + 1);
    }
  }
}

function extractMessageText(message: Record<string, unknown>): string {
  if (typeof message.text === 'string' && message.text.trim().length > 0) {
    return message.text.trim();
  }

  const fragments: string[] = [];
  collectText(message.content, fragments);
  return fragments.join(' ').trim();
}

function normalizeMessage(rawMessage: unknown, index: number): ClaudeMessage | null {
  const message = asRecord(rawMessage);
  if (!message) return null;

  const uuid = pickFirstString(message, ['uuid', 'id', 'message_id']) ?? `msg-${index + 1}`;
  const sender = normalizeSender(message.sender ?? message.role ?? message.author);
  const text = extractMessageText(message);
  const createdAt =
    pickFirstString(message, ['created_at', 'timestamp', 'date'])
    ?? new Date(0).toISOString();

  return {
    ...message,
    uuid,
    sender,
    text,
    created_at: createdAt,
  } as ClaudeMessage;
}

function isCanonicalClaudeConversation(conversation: Record<string, unknown>): boolean {
  if (!Array.isArray(conversation.chat_messages)) return false;

  return conversation.chat_messages.every((rawMessage) => {
    const message = asRecord(rawMessage);
    return Boolean(
      message
      && typeof message.sender === 'string'
      && typeof message.text === 'string',
    );
  });
}

function normalizeConversation(rawConversation: unknown, index: number): ClaudeExport {
  const conversation = asRecord(rawConversation) ?? {};

  if (isCanonicalClaudeConversation(conversation)) {
    return conversation as unknown as ClaudeExport;
  }

  const rawMessages = Array.isArray(conversation.chat_messages)
    ? conversation.chat_messages
    : Array.isArray(conversation.messages)
      ? conversation.messages
      : Array.isArray(conversation.turns)
        ? conversation.turns
        : [];

  const chatMessages = rawMessages
    .map((message, messageIndex) => normalizeMessage(message, messageIndex))
    .filter((message): message is ClaudeMessage => message !== null);

  const uuid = pickFirstString(conversation, ['uuid', 'id', 'conversation_id']) ?? `conversation-${index + 1}`;
  const name = pickFirstString(conversation, ['name', 'title']) ?? `Untitled Conversation ${index + 1}`;
  const createdAt =
    pickFirstString(conversation, ['created_at', 'createdAt'])
    ?? chatMessages[0]?.created_at
    ?? new Date(0).toISOString();
  const updatedAt =
    pickFirstString(conversation, ['updated_at', 'updatedAt'])
    ?? createdAt;

  return {
    ...conversation,
    uuid,
    name,
    created_at: createdAt,
    updated_at: updatedAt,
    chat_messages: chatMessages,
  } as ClaudeExport;
}

function parseClaudeDataset(raw: string): unknown[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Claude conversations file is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (Array.isArray(parsed)) return parsed;

  const record = asRecord(parsed);
  if (record) {
    const candidateArrays = [record.conversations, record.items, record.data];
    for (const candidate of candidateArrays) {
      if (Array.isArray(candidate)) {
        return candidate;
      }
    }
  }

  throw new Error('Claude conversations content must be a JSON array');
}

export const claudeAdapter: PackageAdapter = {
  sourceType: 'claude',
  requiredPaths: ['claude/conversations.json'],
  canHandle(ctx) {
    if (ctx.selectedSource && ctx.selectedSource !== 'claude') return false;
    return ctx.files.some((f) => {
      const path = f.path.toLowerCase();
      return path.endsWith('claude/conversations.json') || path.endsWith('claude.json');
    });
  },
  normalize(ctx) {
    const raw = findFile(
      ctx,
      (p) => p.endsWith('claude/conversations.json') || p.endsWith('claude.json'),
    );
    if (!raw) {
      throw new Error('Claude package missing conversations dataset');
    }

    const dataset = parseClaudeDataset(raw);
    return dataset.map((conversation, index) =>
      normalizeConversation(conversation, index),
    );
  },
};
