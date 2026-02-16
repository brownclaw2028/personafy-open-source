import { describe, expect, it } from 'vitest';
import { parseGmailMbox } from '../mbox-parser';

describe('parseGmailMbox', () => {
  it('preserves whitespace when unfolding folded headers', () => {
    const mbox = [
      'From sender@example.com Tue, 10 Feb 2026 12:00:00 +0000',
      'X-GM-MSGID: folded-1',
      'Date: Tue, 10 Feb 2026 12:00:00 +0000',
      'From: Sender <sender@example.com>',
      'To: Receiver <receiver@example.com>',
      'Subject: Weekly',
      ' update',
      'X-Gmail-Labels: Inbox,',
      ' Important',
      '',
      'Hello world',
      '',
    ].join('\n');

    const [email] = parseGmailMbox(mbox);
    expect(email.subject).toBe('Weekly update');
    expect(email.labels).toEqual(['Inbox', 'Important']);
  });

  it('decodes multipart quoted-printable email body to plain text', () => {
    const mbox = [
      'From sender@example.com Tue, 10 Feb 2026 12:00:00 +0000',
      'X-GM-MSGID: mime-qp-1',
      'Date: Tue, 10 Feb 2026 12:00:00 +0000',
      'From: Sender <sender@example.com>',
      'To: Receiver <receiver@example.com>',
      'Subject: MIME test',
      'Content-Type: multipart/alternative; boundary="bnd-1"',
      '',
      '--bnd-1',
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      'Line=201=0ALine=202=0A',
      '--bnd-1',
      'Content-Type: text/html; charset="UTF-8"',
      '',
      '<p>Line 1</p><p>Line 2</p>',
      '--bnd-1--',
      '',
    ].join('\n');

    const [email] = parseGmailMbox(mbox);
    expect(email.body).toBe('Line 1\nLine 2');
  });

  it('decodes base64 encoded text/plain body', () => {
    const mbox = [
      'From sender@example.com Tue, 10 Feb 2026 12:00:00 +0000',
      'X-GM-MSGID: mime-b64-1',
      'Date: Tue, 10 Feb 2026 12:00:00 +0000',
      'From: Sender <sender@example.com>',
      'To: Receiver <receiver@example.com>',
      'Subject: Base64',
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      '',
      'SGVsbG8gZnJvbSBiYXNlNjQh',
      '',
    ].join('\n');

    const [email] = parseGmailMbox(mbox);
    expect(email.body).toBe('Hello from base64!');
  });
});
