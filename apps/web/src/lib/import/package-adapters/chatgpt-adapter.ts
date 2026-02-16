import type { ChatGPTExport, ChatGPTNode } from '../../types';
import type { PackageAdapter } from './types';
import { findFile } from './helpers';

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
}

function parseUnixTimestamp(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  const numeric = Number(trimmed);
  if (Number.isFinite(numeric)) return numeric;

  const parsed = Date.parse(trimmed);
  if (Number.isFinite(parsed)) return parsed / 1000;
  return null;
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

function normalizeRole(value: unknown): string {
  if (typeof value !== 'string') return 'unknown';
  const normalized = value.trim().toLowerCase();
  if (!normalized) return 'unknown';
  if (normalized === 'human') return 'user';
  if (normalized === 'bot') return 'assistant';
  return normalized;
}

function normalizeContent(
  rawContent: unknown,
  fallbackText: unknown,
): Record<string, unknown> {
  if (typeof rawContent === 'string') {
    return {
      content_type: 'text',
      parts: [rawContent],
    };
  }

  if (Array.isArray(rawContent)) {
    return {
      content_type: 'text',
      parts: rawContent,
    };
  }

  if (!rawContent || typeof rawContent !== 'object') {
    if (typeof fallbackText === 'string' && fallbackText.trim().length > 0) {
      return {
        content_type: 'text',
        parts: [fallbackText],
      };
    }
    return {
      content_type: 'text',
      parts: [],
    };
  }

  const content = { ...(rawContent as Record<string, unknown>) };

  if (!Array.isArray(content.parts)) {
    if (typeof content.text === 'string') {
      content.parts = [content.text];
    } else if (typeof content.content === 'string') {
      content.parts = [content.content];
    } else if (Array.isArray(content.content)) {
      content.parts = content.content;
    } else if (typeof fallbackText === 'string' && fallbackText.trim().length > 0) {
      content.parts = [fallbackText];
    } else {
      content.parts = [];
    }
  }

  if (typeof content.content_type !== 'string' || content.content_type.trim().length === 0) {
    const type = typeof content.type === 'string' ? content.type.trim() : '';
    content.content_type = type || 'text';
  }

  return content;
}

function normalizeMessage(rawMessage: unknown): Record<string, unknown> | null {
  const message = asRecord(rawMessage);
  if (!message) return null;

  const author = asRecord(message.author);
  const role = normalizeRole(author?.role ?? message.role ?? message.sender);
  const createTime = parseUnixTimestamp(message.create_time ?? message.created_at) ?? 0;

  return {
    ...message,
    author: {
      ...(author ?? {}),
      role,
    },
    content: normalizeContent(message.content, message.text),
    create_time: createTime,
  };
}

function toNodeId(rawMessage: Record<string, unknown>, index: number): string {
  const candidate = pickFirstString(rawMessage, ['id', 'uuid', 'message_id']);
  if (!candidate) return `msg-${index + 1}`;
  return candidate;
}

function buildMappingFromLinearMessages(rawMessages: unknown[]): Record<string, ChatGPTNode> {
  const mapping: Record<string, ChatGPTNode> = {
    root: {
      id: 'root',
      parent: null,
      children: [],
    },
  };

  let previousNodeId = 'root';

  rawMessages.forEach((rawMessage, index) => {
    const messageRecord = asRecord(rawMessage);
    const normalizedMessage = normalizeMessage(rawMessage);
    if (!messageRecord || !normalizedMessage) return;

    let nodeId = toNodeId(messageRecord, index);
    if (mapping[nodeId]) {
      nodeId = `${nodeId}-${index + 1}`;
    }

    mapping[nodeId] = {
      id: nodeId,
      message: normalizedMessage as ChatGPTNode['message'],
      parent: previousNodeId,
      children: [],
    };
    mapping[previousNodeId].children.push(nodeId);
    previousNodeId = nodeId;
  });

  return mapping;
}

function parseChatGPTDataset(raw: string): unknown[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `ChatGPT conversations file is not valid JSON: ${
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

  throw new Error('ChatGPT conversations content must be a JSON array');
}

function normalizeConversation(rawConversation: unknown, index: number): ChatGPTExport {
  const conversation = asRecord(rawConversation) ?? {};

  const hasMapping =
    typeof conversation.mapping === 'object' && conversation.mapping !== null;

  const title =
    pickFirstString(conversation, ['title', 'name', 'conversation_title'])
    ?? `Untitled Conversation ${index + 1}`;

  const createTime =
    parseUnixTimestamp(conversation.create_time ?? conversation.created_at)
    ?? Date.now() / 1000;
  const updateTime =
    parseUnixTimestamp(conversation.update_time ?? conversation.updated_at)
    ?? createTime;

  if (hasMapping) {
    return {
      ...conversation,
      title,
      create_time: createTime,
      update_time: updateTime,
    } as ChatGPTExport;
  }

  const rawMessages = Array.isArray(conversation.messages)
    ? conversation.messages
    : Array.isArray(conversation.chat_messages)
      ? conversation.chat_messages
      : [];

  return {
    ...conversation,
    title,
    create_time: createTime,
    update_time: updateTime,
    mapping: buildMappingFromLinearMessages(rawMessages),
  } as ChatGPTExport;
}

export const chatgptAdapter: PackageAdapter = {
  sourceType: 'chatgpt',
  requiredPaths: ['conversations.json'],
  canHandle(ctx) {
    if (ctx.selectedSource && ctx.selectedSource !== 'chatgpt') return false;
    return ctx.files.some((f) => {
      const path = f.path.toLowerCase();
      return path.endsWith('conversations.json') || path.endsWith('chatgpt.json');
    });
  },
  normalize(ctx) {
    const raw = findFile(
      ctx,
      (p) => p.endsWith('conversations.json') || p.endsWith('chatgpt.json'),
    );
    if (!raw) {
      throw new Error('ChatGPT package missing conversations.json');
    }

    const dataset = parseChatGPTDataset(raw);
    return dataset.map((conversation, index) =>
      normalizeConversation(conversation, index),
    );
  },
};
