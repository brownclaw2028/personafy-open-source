import { describe, expect, it } from 'vitest';
import { ClaudeExtractor, type ClaudeExport } from '../claude-extractor';

function buildConversation(messages: ClaudeExport['chat_messages']): ClaudeExport {
  return {
    uuid: 'conv-1',
    name: 'test conversation',
    created_at: '2026-02-09T10:00:00.000Z',
    updated_at: '2026-02-09T10:05:00.000Z',
    chat_messages: messages,
  };
}

function factValues(extractor: ClaudeExtractor, key: string): string[] {
  return extractor
    .getAllFacts()
    .filter((fact) => fact.key === key)
    .map((fact) => fact.value);
}

describe('ClaudeExtractor compatibility', () => {
  it('treats sender=user as a user-authored message', () => {
    const extractor = new ClaudeExtractor([
      buildConversation([
        {
          uuid: 'm1',
          sender: 'user',
          text: 'I wear a 32 waist in pants',
          created_at: '2026-02-09T10:00:00.000Z',
        },
      ]),
    ]);

    expect(factValues(extractor, 'apparel.pants.waist')).toContain('32');
  });

  it('falls back to structured content blocks when text is empty', () => {
    const extractor = new ClaudeExtractor([
      buildConversation([
        {
          uuid: 'm1',
          sender: 'human',
          text: '',
          content: [
            { type: 'text', text: 'Always book me a window seat for flights.' },
          ],
          created_at: '2026-02-09T10:00:00.000Z',
        },
      ]),
    ]);

    expect(factValues(extractor, 'flight.seat_preference')).toContain('window seat');
  });
});
