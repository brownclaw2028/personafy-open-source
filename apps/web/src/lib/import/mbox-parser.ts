import { decodeMimeHeaderValue, parseGmailLabelsHeader } from './gmail-label-parser';

export interface ParsedGmailMboxEmail {
  id: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  date: string;
  labels: string[];
  threadId?: string;
  messageId?: string;
}

interface MboxChunk {
  separatorLine: string;
  messageText: string;
}

type HeaderMap = Record<string, string[]>;

function normalizeNewlines(input: string): string {
  return input.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function splitMboxChunks(input: string): MboxChunk[] {
  const lines = normalizeNewlines(input).split('\n');
  const chunks: MboxChunk[] = [];

  let separatorLine = '';
  let bodyLines: string[] = [];
  let started = false;

  const flush = () => {
    const messageText = bodyLines.join('\n');
    if (!messageText.trim()) return;
    chunks.push({ separatorLine, messageText });
  };

  for (const line of lines) {
    if (line.startsWith('From ')) {
      if (started) flush();
      separatorLine = line;
      bodyLines = [];
      started = true;
      continue;
    }

    if (!started && line.trim() === '') continue;
    if (!started) started = true;
    bodyLines.push(line);
  }

  if (started) flush();
  return chunks;
}

function splitHeadersAndBody(messageText: string): { headers: string[]; body: string } {
  const lines = messageText.split('\n');
  const separator = lines.findIndex((line) => line.trim() === '');
  if (separator < 0) {
    return {
      headers: lines,
      body: '',
    };
  }

  return {
    headers: lines.slice(0, separator),
    body: lines.slice(separator + 1).join('\n'),
  };
}

function unfoldHeaders(rawHeaders: string[]): string[] {
  const unfolded: string[] = [];
  for (const line of rawHeaders) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && unfolded.length > 0) {
      // RFC-style folded header continuation should preserve separation.
      unfolded[unfolded.length - 1] += ` ${line.trimStart()}`;
    } else {
      unfolded.push(line);
    }
  }
  return unfolded;
}

function buildHeaderMap(rawHeaders: string[]): HeaderMap {
  const map: HeaderMap = {};
  for (const line of unfoldHeaders(rawHeaders)) {
    const divider = line.indexOf(':');
    if (divider <= 0) continue;
    const key = line.slice(0, divider).trim().toLowerCase();
    const value = line.slice(divider + 1).trim();
    if (!key) continue;
    if (!map[key]) map[key] = [];
    map[key].push(value);
  }
  return map;
}

function getHeader(map: HeaderMap, key: string): string | undefined {
  return map[key.toLowerCase()]?.[0];
}

function stripAngleBrackets(value: string | undefined): string {
  if (!value) return '';
  return value.trim().replace(/^<+/, '').replace(/>+$/, '');
}

function normalizeBody(rawBody: string): string {
  return rawBody.replace(/^>From /gm, 'From ').replace(/\n+$/, '');
}

function decodeBase64Body(raw: string): string {
  const compact = raw.replace(/\s+/g, '');
  if (!compact) return '';
  try {
    const binary = atob(compact);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
  } catch {
    return raw;
  }
}

function decodeQuotedPrintableBody(raw: string): string {
  const input = normalizeNewlines(raw).replace(/=\n/g, '');
  const bytes: number[] = [];

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (char === '=' && i + 2 < input.length) {
      const hex = input.slice(i + 1, i + 3);
      if (/^[0-9a-fA-F]{2}$/.test(hex)) {
        bytes.push(Number.parseInt(hex, 16));
        i += 2;
        continue;
      }
    }
    bytes.push(input.charCodeAt(i));
  }

  return new TextDecoder().decode(new Uint8Array(bytes));
}

function stripHtml(raw: string): string {
  return raw
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseContentType(value: string | undefined): {
  mimeType: string;
  boundary?: string;
} {
  const raw = (value ?? '').trim();
  if (!raw) return { mimeType: 'text/plain' };

  const segments = raw.split(';');
  const mimeType = segments[0].trim().toLowerCase() || 'text/plain';
  let boundary: string | undefined;

  for (const segment of segments.slice(1)) {
    const divider = segment.indexOf('=');
    if (divider <= 0) continue;
    const key = segment.slice(0, divider).trim().toLowerCase();
    const unquoted = segment.slice(divider + 1).trim().replace(/^"+|"+$/g, '');
    if (key === 'boundary' && unquoted) {
      boundary = unquoted;
      break;
    }
  }

  return { mimeType, boundary };
}

function splitMultipartParts(rawBody: string, boundary: string): string[] {
  const marker = `--${boundary}`;
  const closingMarker = `--${boundary}--`;
  const lines = normalizeNewlines(rawBody).split('\n');
  const parts: string[] = [];
  let current: string[] | null = null;

  for (const line of lines) {
    const trimmed = line.trimEnd();
    if (trimmed === marker || trimmed === closingMarker) {
      if (current && current.length > 0) {
        parts.push(current.join('\n'));
      }
      if (trimmed === closingMarker) {
        current = null;
        break;
      }
      current = [];
      continue;
    }

    if (current) current.push(line);
  }

  return parts;
}

function decodeTransferEncoding(rawBody: string, encodingHeader: string | undefined): string {
  const encoding = (encodingHeader ?? '').trim().toLowerCase();
  if (encoding === 'base64') return decodeBase64Body(rawBody);
  if (encoding === 'quoted-printable') return decodeQuotedPrintableBody(rawBody);
  return rawBody;
}

function decodeMimeBody(rawBody: string, headers: HeaderMap): string {
  const { mimeType, boundary } = parseContentType(getHeader(headers, 'content-type'));

  if (mimeType.startsWith('multipart/') && boundary) {
    const parts = splitMultipartParts(rawBody, boundary);
    let htmlFallback = '';

    for (const part of parts) {
      const { headers: partRawHeaders, body: partBody } = splitHeadersAndBody(part);
      const partHeaders = buildHeaderMap(partRawHeaders);
      const decoded = decodeMimeBody(partBody, partHeaders);
      if (!decoded) continue;

      const partType = parseContentType(getHeader(partHeaders, 'content-type')).mimeType;
      if (partType.startsWith('text/plain')) return decoded;
      if (!htmlFallback && partType.startsWith('text/html')) {
        htmlFallback = stripHtml(decoded);
      } else if (!htmlFallback) {
        htmlFallback = decoded;
      }
    }

    if (htmlFallback) return normalizeBody(htmlFallback);
    return normalizeBody(rawBody);
  }

  const decoded = decodeTransferEncoding(
    rawBody,
    getHeader(headers, 'content-transfer-encoding'),
  );
  if (mimeType.startsWith('text/html')) {
    return normalizeBody(stripHtml(decoded));
  }
  return normalizeBody(decoded);
}

function extractDateFromSeparator(separatorLine: string): string {
  if (!separatorLine.startsWith('From ')) return '';
  const parts = separatorLine.trim().split(/\s+/);
  if (parts.length < 3) return '';
  return parts.slice(2).join(' ');
}

function normalizeDate(dateHeader: string | undefined, separatorLine: string): string {
  const candidates = [dateHeader, extractDateFromSeparator(separatorLine)];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const parsed = new Date(candidate);
    if (!Number.isNaN(parsed.valueOf())) {
      return parsed.toISOString().replace('.000Z', 'Z');
    }
  }
  return '';
}

function parseChunk(chunk: MboxChunk, index: number): ParsedGmailMboxEmail {
  const { headers: rawHeaders, body } = splitHeadersAndBody(chunk.messageText);
  const headers = buildHeaderMap(rawHeaders);

  const gmMsgId = stripAngleBrackets(getHeader(headers, 'x-gm-msgid'));
  const messageId = stripAngleBrackets(getHeader(headers, 'message-id'));
  const id = gmMsgId || messageId || `mbox-${index + 1}`;

  const from = decodeMimeHeaderValue(getHeader(headers, 'from') ?? '');
  const to = decodeMimeHeaderValue(getHeader(headers, 'to') ?? '');
  const subject = decodeMimeHeaderValue(getHeader(headers, 'subject') ?? '');
  const labels = parseGmailLabelsHeader(getHeader(headers, 'x-gmail-labels'));

  return {
    id,
    from,
    to,
    subject,
    body: decodeMimeBody(body, headers),
    date: normalizeDate(getHeader(headers, 'date'), chunk.separatorLine),
    labels,
  };
}

export function parseGmailMbox(content: string): ParsedGmailMboxEmail[] {
  const chunks = splitMboxChunks(content);
  return chunks.map((chunk, index) => parseChunk(chunk, index));
}
