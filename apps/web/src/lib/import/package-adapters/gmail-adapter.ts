import type { PackageAdapter } from './types';
import { parseGmailMbox, type ParsedGmailMboxEmail } from '../mbox-parser';
import { findFile, normalizePath, parseJsonArray } from './helpers';

function isGmailTakeoutMbox(path: string): boolean {
  return path.endsWith('.mbox') && path.includes('/mail/');
}

function mergeDuplicateMessages(records: ParsedGmailMboxEmail[]): ParsedGmailMboxEmail[] {
  const merged = new Map<string, ParsedGmailMboxEmail>();

  for (const record of records) {
    const existing = merged.get(record.id);
    if (!existing) {
      merged.set(record.id, { ...record });
      continue;
    }

    existing.labels = [...new Set([...existing.labels, ...record.labels])];
    if (!existing.body && record.body) existing.body = record.body;
    if (!existing.subject && record.subject) existing.subject = record.subject;
    if (!existing.from && record.from) existing.from = record.from;
    if (!existing.to && record.to) existing.to = record.to;
    if (!existing.date && record.date) existing.date = record.date;
    if (!existing.threadId && record.threadId) existing.threadId = record.threadId;
    if (!existing.messageId && record.messageId) existing.messageId = record.messageId;
  }

  return [...merged.values()];
}

export const gmailAdapter: PackageAdapter = {
  sourceType: 'gmail',
  requiredPaths: [
    'takeout/mail/*.mbox',
    'takeout/mail/messages.json',
    'gmail.json',
  ],
  canHandle(ctx) {
    if (ctx.selectedSource && ctx.selectedSource !== 'gmail') return false;
    return ctx.files.some((f) => {
      const path = normalizePath(f.path);
      return (
        isGmailTakeoutMbox(path)
        || path.endsWith('takeout/mail/messages.json')
        || path.endsWith('gmail.json')
      );
    });
  },
  normalize(ctx) {
    const mboxRecords = ctx.files
      .filter((f) => isGmailTakeoutMbox(normalizePath(f.path)))
      .flatMap((f) => parseGmailMbox(f.content));

    if (mboxRecords.length > 0) {
      return mergeDuplicateMessages(mboxRecords);
    }

    const raw = findFile(
      ctx,
      (p) => p.endsWith('takeout/mail/messages.json') || p.endsWith('gmail.json'),
    );
    if (!raw) {
      throw new Error('Gmail package missing messages dataset');
    }
    return parseJsonArray(raw, 'Gmail messages');
  },
};
