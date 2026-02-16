import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  createTgzPackage,
  createZipPackage,
} from './test-utils/package-test-utils';
import { parseImportPayload } from '../package-parser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE_ROOT = path.join(__dirname, 'fixtures');

function fixtureText(relativePath: string): string {
  return readFileSync(path.join(FIXTURE_ROOT, relativePath), 'utf-8');
}

describe('real-export fixture packs', () => {
  it('parses wrapped ChatGPT conversations fixture', () => {
    const bytes = createZipPackage({
      'conversations.json': fixtureText('chatgpt/wrapped-conversations.json'),
      'chat.html': '<html></html>',
    });

    const parsed = parseImportPayload('chatgpt-export.zip', bytes);
    expect(parsed.sourceType).toBe('chatgpt');
    expect(parsed.records).toHaveLength(1);

    const [conversation] = parsed.records as Array<{
      title: string;
      mapping: Record<
        string,
        { message?: { author?: { role?: string }; content?: { parts?: unknown[] } } }
      >;
    }>;
    expect(conversation.title).toBe('Wrapped ChatGPT Conversation');
    expect(conversation.mapping.u1.message?.author?.role).toBe('user');
    expect(conversation.mapping.u1.message?.content?.parts).toEqual([
      'I wear a 32 waist and always book a window seat.',
    ]);
  });

  it('parses Claude legacy conversation fixture', () => {
    const bytes = createTgzPackage([
      {
        path: 'claude/conversations.json',
        content: fixtureText('claude/legacy-conversations.json'),
      },
      {
        path: 'claude/metadata.json',
        content: '{"exportedAt":"2026-02-10T00:00:00.000Z"}\n',
      },
    ]);

    const parsed = parseImportPayload('claude-export.tgz', bytes);
    expect(parsed.sourceType).toBe('claude');
    expect(parsed.records).toHaveLength(1);

    const [conversation] = parsed.records as Array<{
      name: string;
      chat_messages: Array<{ sender: string; text: string }>;
    }>;
    expect(conversation.name).toBe('Legacy Claude Conversation');
    expect(conversation.chat_messages[0].sender).toBe('user');
    expect(conversation.chat_messages[0].text).toContain('avoid polyester');
  });

  it('parses mixed Notion markdown and csv fixtures', () => {
    const bytes = createZipPackage({
      'Workspace/Weekly notes ap-nt-050.md': fixtureText(
        'notion/Workspace/Weekly notes ap-nt-050.md',
      ),
      'Workspace/Tasks ap-nt-999.csv': fixtureText(
        'notion/Workspace/Tasks ap-nt-999.csv',
      ),
      'Workspace/index.html': '<html><body>Notion Export</body></html>',
    });

    const parsed = parseImportPayload('notion-export.zip', bytes);
    expect(parsed.sourceType).toBe('notion');
    expect(parsed.records.length).toBeGreaterThan(0);

    const shared = (parsed.records as Array<{ id: string; content: string }>).find(
      (record) => record.id === 'ap-nt-050',
    );
    expect(shared).toBeDefined();
    expect(shared?.content).toContain('Long markdown body with detail');
    expect(shared?.content).not.toContain('Short csv summary');
  });

  it('parses Gmail Takeout mbox fixture', () => {
    const bytes = createZipPackage({
      'Takeout/Mail/All mail Including Spam and Trash.mbox': fixtureText(
        'gmail/Takeout/Mail/All mail Including Spam and Trash.mbox',
      ),
      'Takeout/Mail/archive_browser.html': '<html></html>',
    });

    const parsed = parseImportPayload('gmail-export.zip', bytes);
    expect(parsed.sourceType).toBe('gmail');
    expect(parsed.records).toEqual([
      {
        id: 'msg-1',
        from: 'orders@example.com',
        to: 'customer@example.com',
        subject: 'Order shipped',
        body: 'Your order has shipped and will arrive tomorrow.',
        date: '2026-02-09T16:15:00Z',
        labels: ['Inbox', 'Category Updates'],
      },
    ]);
  });

  it('parses Amazon order history csv fixture', () => {
    const bytes = createZipPackage({
      'Retail.OrderHistory.1.csv': fixtureText('amazon/Retail.OrderHistory.1.csv'),
      'manifest.json': '{"dataset":"Retail.OrderHistory"}\n',
    });

    const parsed = parseImportPayload('amazon-export.zip', bytes);
    expect(parsed.sourceType).toBe('amazon');
    expect(parsed.records).toEqual([
      {
        orderId: 'A-1001',
        orderDate: '2026-01-10T16:30:00Z',
        items: [
          {
            name: 'AeroPress Coffee Maker',
            category: 'Home',
            price: 39.95,
            quantity: 1,
            brand: 'AeroPress',
            asin: 'B000GXZ2GS',
          },
        ],
        total: 39.95,
        currency: 'USD',
        shippingAddress: {
          city: 'Portland',
          state: 'OR',
        },
        status: 'Delivered',
      },
    ]);
  });
});
