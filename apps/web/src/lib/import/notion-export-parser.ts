import type { NotionPage } from '../notion-extractor';

export interface NotionExportFileInput {
  path: string;
  content: string;
}

interface ParsedCsv {
  headers: string[];
  rows: string[][];
}

type NotionPageType = NotionPage['type'];
type NotionOrigin = 'csv' | 'md';

interface ParsedNotionRecord extends NotionPage {
  __origin: NotionOrigin;
}

const TITLE_HEADING_REGEX = /^#\s+(.+?)\s*$/;
const KNOWN_CSV_COLUMNS = new Set([
  'id',
  'name',
  'title',
  'content',
  'type',
  'tags',
  'created time',
  'created_time',
  'last edited time',
  'last_edited_time',
]);

function normalizePath(input: string): string {
  return input.replace(/\\/g, '/').replace(/^\.\/+/, '');
}

function normalizeNewlines(input: string): string {
  return input.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function normalizeHeaderName(input: string): string {
  return input.trim().toLowerCase().replace(/[\s_-]+/g, ' ');
}

function parseCsv(content: string): ParsedCsv {
  const text = normalizeNewlines(content);
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        currentCell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === ',') {
      currentRow.push(currentCell);
      currentCell = '';
      continue;
    }

    if (!inQuotes && char === '\n') {
      currentRow.push(currentCell);
      if (currentRow.some((value) => value.trim().length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentCell = '';
      continue;
    }

    currentCell += char;
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell);
    if (currentRow.some((value) => value.trim().length > 0)) {
      rows.push(currentRow);
    }
  }

  if (rows.length === 0) {
    return { headers: [], rows: [] };
  }

  return {
    headers: rows[0].map((header) => header.trim()),
    rows: rows.slice(1),
  };
}

function splitTags(input: string): string[] {
  return input
    .split(/[;,]/g)
    .map((part) => part.trim())
    .filter(Boolean);
}

function fileStem(pathValue: string): string {
  const normalized = normalizePath(pathValue);
  const filename = normalized.split('/').pop() ?? normalized;
  return filename.replace(/\.[^.]+$/, '');
}

function normalizeId(raw: string | undefined, fallback: string): string {
  const trimmed = (raw ?? '').trim();
  if (trimmed) return trimmed;
  return fallback;
}

function extractIdFromStem(stem: string): string | null {
  const hexLike = stem.match(
    /(?:^|[\s(])([a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\)?$/i,
  );
  if (hexLike?.[1]) return hexLike[1].toLowerCase();

  // Synthetic fixtures and some exports use human-readable IDs with hyphens and digits.
  const slugLike = stem.match(/(?:^|[\s(])([a-z0-9][a-z0-9_-]*-[a-z0-9_-]*\d[a-z0-9_-]*)\)?$/i);
  if (slugLike?.[1]) return slugLike[1];

  return null;
}

function stripExportIdSuffix(stem: string): string {
  return stem
    .replace(
      /\s*\(?([a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\)?$/i,
      '',
    )
    .replace(
      /\s*\(?([a-z0-9][a-z0-9_-]*-[a-z0-9_-]*\d[a-z0-9_-]*)\)?$/i,
      '',
    )
    .trim();
}

function inferType(pathValue: string, title: string, explicitType?: string): NotionPageType {
  const normalizedExplicit = explicitType?.trim().toLowerCase();
  if (
    normalizedExplicit
    && ['page', 'database', 'journal', 'task', 'note'].includes(normalizedExplicit)
  ) {
    return normalizedExplicit as NotionPageType;
  }

  const lowerPath = normalizePath(pathValue).toLowerCase();
  const lowerTitle = title.toLowerCase();

  if (lowerPath.endsWith('.csv')) return 'database';
  if (/\bjournal\b/.test(lowerTitle) || lowerPath.includes('/journals/')) return 'journal';
  if (/\bnote(s)?\b/.test(lowerTitle) || lowerPath.includes('/notes/')) return 'note';
  if (/\btask(s)?\b/.test(lowerTitle) || lowerPath.includes('/tasks/')) return 'task';
  return 'page';
}

function createFallbackId(pathValue: string, rowIndex?: number): string {
  const base = normalizePath(pathValue)
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (typeof rowIndex === 'number') return `${base}-row-${rowIndex + 1}`;
  return base || 'notion-record';
}

function readCsvValue(
  row: string[],
  headerIndexes: Map<string, number>,
  aliases: string[],
): string {
  for (const alias of aliases) {
    const index = headerIndexes.get(normalizeHeaderName(alias));
    if (index === undefined) continue;
    const value = row[index] ?? '';
    if (value.trim()) return value.trim();
  }
  return '';
}

function parseCsvRecords(file: NotionExportFileInput): ParsedNotionRecord[] {
  const parsed = parseCsv(file.content);
  if (parsed.headers.length === 0 || parsed.rows.length === 0) return [];

  const headerIndexes = new Map<string, number>();
  parsed.headers.forEach((header, index) => {
    headerIndexes.set(normalizeHeaderName(header), index);
  });

  const stem = fileStem(file.path);
  const idFromFile = extractIdFromStem(stem);
  const titleFromFile = stripExportIdSuffix(stem) || 'Untitled Database';

  const records: ParsedNotionRecord[] = [];
  parsed.rows.forEach((row, rowIndex) => {
    if (row.every((cell) => cell.trim().length === 0)) return;

    const id = normalizeId(
      readCsvValue(row, headerIndexes, ['id']),
      idFromFile ? `${idFromFile}-row-${rowIndex + 1}` : createFallbackId(file.path, rowIndex),
    );
    const title = readCsvValue(row, headerIndexes, ['title', 'name']) || titleFromFile;
    const content = readCsvValue(row, headerIndexes, ['content', 'notes', 'description', 'body']);
    const createdTime = readCsvValue(row, headerIndexes, ['created_time', 'created time']);
    const lastEditedTime = readCsvValue(row, headerIndexes, ['last_edited_time', 'last edited time']);
    const typeValue = readCsvValue(row, headerIndexes, ['type']);
    const tagsRaw = readCsvValue(row, headerIndexes, ['tags', 'labels']);

    const properties: Record<string, string> = {};
    parsed.headers.forEach((header, index) => {
      const normalized = normalizeHeaderName(header);
      if (KNOWN_CSV_COLUMNS.has(normalized)) return;
      const value = (row[index] ?? '').trim();
      if (!value) return;
      properties[header.trim()] = value;
    });

    const fallbackContent = parsed.headers
      .map((header, index) => `${header.trim()}: ${(row[index] ?? '').trim()}`)
      .filter((line) => !line.endsWith(':'))
      .join('. ');

    const page: ParsedNotionRecord = {
      id,
      title,
      type: inferType(file.path, title, typeValue),
      content: content || fallbackContent,
      created_time: createdTime || undefined,
      last_edited_time: lastEditedTime || undefined,
      tags: tagsRaw ? splitTags(tagsRaw) : undefined,
      properties: Object.keys(properties).length > 0 ? properties : undefined,
      __origin: 'csv',
    };

    records.push(page);
  });

  return records;
}

interface ParsedMarkdownMeta {
  content: string;
  explicitType?: string;
  createdTime?: string;
  lastEditedTime?: string;
  tags?: string[];
  properties?: Record<string, string>;
}

function parseMarkdownMetadata(content: string): ParsedMarkdownMeta {
  const normalized = normalizeNewlines(content);
  const lines = normalized.split('\n');

  let cursor = 0;
  while (cursor < lines.length && lines[cursor].trim() === '') cursor += 1;
  if (cursor < lines.length && TITLE_HEADING_REGEX.test(lines[cursor])) {
    cursor += 1;
  }
  while (cursor < lines.length && lines[cursor].trim() === '') cursor += 1;

  const dividerIndex = lines.findIndex(
    (line, index) => index >= cursor && line.trim() === '---',
  );

  if (dividerIndex < 0 || dividerIndex - cursor > 60) {
    return { content: normalized.trim() };
  }

  const metadataLines = lines.slice(cursor, dividerIndex);
  const hasMetadataMarker = metadataLines.some((line) => {
    const lower = line.trim().toLowerCase();
    return (
      lower.startsWith('created time:')
      || lower.startsWith('last edited time:')
      || lower.startsWith('type:')
      || lower.startsWith('tags:')
      || lower.startsWith('## properties')
      || lower.startsWith('properties:')
    );
  });

  if (!hasMetadataMarker) {
    return { content: normalized.trim() };
  }

  const result: ParsedMarkdownMeta = {
    content: normalizeNewlines(lines.slice(dividerIndex + 1).join('\n')).trim(),
  };

  const properties: Record<string, string> = {};
  let inProperties = false;
  for (const line of metadataLines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const lower = trimmed.toLowerCase();

    if (lower === '## properties' || lower === 'properties:') {
      inProperties = true;
      continue;
    }

    if (inProperties && trimmed.startsWith('-')) {
      const kv = trimmed.slice(1).trim();
      const sep = kv.indexOf(':');
      if (sep > 0) {
        const key = kv.slice(0, sep).trim();
        const value = kv.slice(sep + 1).trim();
        if (key && value) properties[key] = value;
      }
      continue;
    }

    inProperties = false;

    if (lower.startsWith('created time:')) {
      result.createdTime = trimmed.slice('created time:'.length).trim();
      continue;
    }
    if (lower.startsWith('last edited time:')) {
      result.lastEditedTime = trimmed.slice('last edited time:'.length).trim();
      continue;
    }
    if (lower.startsWith('type:')) {
      result.explicitType = trimmed.slice('type:'.length).trim();
      continue;
    }
    if (lower.startsWith('tags:')) {
      const tagsRaw = trimmed.slice('tags:'.length).trim();
      result.tags = tagsRaw ? splitTags(tagsRaw) : undefined;
      continue;
    }
  }

  if (Object.keys(properties).length > 0) {
    result.properties = properties;
  }

  return result;
}

function parseMarkdownRecord(file: NotionExportFileInput): ParsedNotionRecord {
  const normalizedPath = normalizePath(file.path);
  const stem = fileStem(normalizedPath);
  const idFromFile = extractIdFromStem(stem);
  const titleFromFile = stripExportIdSuffix(stem) || 'Untitled';
  const normalized = normalizeNewlines(file.content).trim();
  const firstLine = normalized.split('\n', 1)[0] ?? '';
  const headingMatch = firstLine.match(TITLE_HEADING_REGEX);
  const title = headingMatch?.[1]?.trim() || titleFromFile;

  const metadata = parseMarkdownMetadata(file.content);
  const content = metadata.content || normalized;

  return {
    id: idFromFile ?? createFallbackId(normalizedPath),
    title,
    type: inferType(normalizedPath, title, metadata.explicitType),
    content,
    properties: metadata.properties,
    created_time: metadata.createdTime,
    last_edited_time: metadata.lastEditedTime,
    tags: metadata.tags,
    __origin: 'md',
  };
}

function mergeProperties(
  existing: Record<string, string> | undefined,
  incoming: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!existing && !incoming) return undefined;
  return {
    ...(incoming ?? {}),
    ...(existing ?? {}),
  };
}

function mergeTags(existing: string[] | undefined, incoming: string[] | undefined): string[] | undefined {
  const merged = [...(existing ?? [])];
  for (const tag of incoming ?? []) {
    if (!merged.includes(tag)) merged.push(tag);
  }
  return merged.length > 0 ? merged : undefined;
}

function choosePreferredTitle(existing: ParsedNotionRecord, incoming: ParsedNotionRecord): string {
  if (existing.__origin === 'md' && existing.title) return existing.title;
  if (incoming.__origin === 'md' && incoming.title) return incoming.title;
  return existing.title || incoming.title;
}

function choosePreferredType(existing: ParsedNotionRecord, incoming: ParsedNotionRecord): NotionPageType {
  if (existing.__origin === 'md') return existing.type;
  if (incoming.__origin === 'md') return incoming.type;
  return existing.type || incoming.type;
}

function choosePreferredContent(existing: ParsedNotionRecord, incoming: ParsedNotionRecord): string {
  const existingContent = existing.content.trim();
  const incomingContent = incoming.content.trim();

  if (existing.__origin === 'md' && existingContent) return existing.content;
  if (incoming.__origin === 'md' && incomingContent) return incoming.content;

  if (existingContent && incomingContent) {
    return incomingContent.length > existingContent.length
      ? incoming.content
      : existing.content;
  }

  return existing.content || incoming.content;
}

function mergeRecord(existing: ParsedNotionRecord, incoming: ParsedNotionRecord): ParsedNotionRecord {
  return {
    ...existing,
    title: choosePreferredTitle(existing, incoming),
    type: choosePreferredType(existing, incoming),
    content: choosePreferredContent(existing, incoming),
    properties: mergeProperties(existing.properties, incoming.properties),
    created_time: existing.created_time ?? incoming.created_time,
    last_edited_time: existing.last_edited_time ?? incoming.last_edited_time,
    tags: mergeTags(existing.tags, incoming.tags),
    __origin:
      existing.__origin === 'md' || incoming.__origin === 'md'
        ? 'md'
        : existing.__origin,
  };
}

export function parseNotionExportFiles(files: NotionExportFileInput[]): NotionPage[] {
  const recordsById = new Map<string, ParsedNotionRecord>();
  const orderedIds: string[] = [];

  const upsertRecord = (record: ParsedNotionRecord) => {
    const existing = recordsById.get(record.id);
    if (!existing) {
      recordsById.set(record.id, record);
      orderedIds.push(record.id);
      return;
    }
    recordsById.set(record.id, mergeRecord(existing, record));
  };

  for (const file of files) {
    const pathValue = normalizePath(file.path).toLowerCase();
    if (pathValue.endsWith('.csv')) {
      for (const record of parseCsvRecords(file)) {
        upsertRecord(record);
      }
      continue;
    }
    if (pathValue.endsWith('.md')) {
      upsertRecord(parseMarkdownRecord(file));
    }
  }

  return orderedIds
    .map((id) => recordsById.get(id))
    .filter((record): record is ParsedNotionRecord => Boolean(record))
    .map((record) => ({
      id: record.id,
      title: record.title,
      type: record.type,
      content: record.content,
      properties: record.properties,
      created_time: record.created_time,
      last_edited_time: record.last_edited_time,
      tags: record.tags,
    }));
}
