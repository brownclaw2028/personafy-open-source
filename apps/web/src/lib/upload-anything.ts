import { gunzipSync, unzipSync } from 'fflate';
import type { SourceType } from './source-types';
import type { GeneralExtractionRecord } from './general-extractor';

const MAX_FILE_BYTES = 40 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 500;
const MAX_NESTED_ARCHIVE_DEPTH = 2;
const MAX_TEXT_CHARS_PER_FILE = 120_000;
const MAX_RECORD_CHARS = 8_000;

interface ExtractedTextBlock {
  sourcePath: string;
  sourceType: SourceType;
  text: string;
}

interface TarEntry {
  path: string;
  bytes: Uint8Array;
  kind: 'file' | 'symlink' | 'hardlink';
}

export interface UniversalUploadParseResult {
  records: GeneralExtractionRecord[];
  warnings: string[];
  parsedFiles: number;
  skippedFiles: number;
}

function toFileArray(files: FileList | File[]): File[] {
  return Array.isArray(files) ? files : Array.from(files);
}

function lowerPath(path: string): string {
  return path.toLowerCase();
}

function fileExt(path: string): string {
  const normalized = lowerPath(path);
  if (normalized.endsWith('.tar.gz')) return '.tar.gz';
  const lastDot = normalized.lastIndexOf('.');
  if (lastDot < 0) return '';
  return normalized.slice(lastDot);
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

function decodeLatin1(bytes: Uint8Array): string {
  return new TextDecoder('latin1', { fatal: false }).decode(bytes);
}

function looksLikeZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4
    && bytes[0] === 0x50
    && bytes[1] === 0x4b
    && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07);
}

function looksLikeGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

function looksLikeTar(bytes: Uint8Array): boolean {
  if (bytes.length < 512) return false;
  const magic = decodeLatin1(bytes.subarray(257, 263));
  return magic.startsWith('ustar');
}

function isArchivePath(path: string): boolean {
  const ext = fileExt(path);
  return ext === '.zip' || ext === '.tgz' || ext === '.tar.gz' || ext === '.tar' || ext === '.gz';
}

function inferSourceType(path: string): SourceType {
  const lower = lowerPath(path);
  if (lower.includes('gmail') || lower.includes('mbox') || lower.includes('takeout') || lower.includes('/mail')) {
    return 'gmail';
  }
  if (lower.includes('amazon') || lower.includes('orderhistory') || lower.includes('retail.')) {
    return 'amazon';
  }
  if (lower.includes('claude') || lower.includes('anthropic')) {
    return 'claude';
  }
  if (lower.includes('notion')) {
    return 'notion';
  }
  if (lower.includes('gemini')) {
    return 'gemini';
  }
  if (lower.includes('calendar') || lower.endsWith('.ics')) {
    return 'calendar';
  }
  return 'chatgpt';
}

function normalizeText(text: string): string {
  return text
    .replace(/\r/g, '\n')
    .split('\0').join(' ')
    .replace(/[\t\f]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function chunkText(text: string, chunkSize = MAX_RECORD_CHARS): string[] {
  if (text.length <= chunkSize) return [text];
  const chunks: string[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const next = text.slice(cursor, cursor + chunkSize);
    chunks.push(next.trim());
    cursor += chunkSize;
  }
  return chunks.filter(Boolean);
}

function stripHtmlLike(input: string): string {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');
}

function extractCsvText(input: string): string {
  return input
    .split(/\r?\n/)
    .map((line) => line.replace(/,+/g, ', ').trim())
    .filter(Boolean)
    .join('\n');
}

function collectJsonStrings(value: unknown, out: string[], depth = 0): void {
  if (depth > 8 || out.length >= 3_000) return;

  if (typeof value === 'string') {
    const normalized = value.trim().replace(/\s+/g, ' ');
    if (normalized.length >= 3) out.push(normalized);
    return;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    out.push(String(value));
    return;
  }

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length && i < 2_000; i += 1) {
      collectJsonStrings(value[i], out, depth + 1);
      if (out.length >= 3_000) break;
    }
    return;
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const role = typeof record.role === 'string' ? record.role.toLowerCase() : null;

    if (role === 'user' || role === 'human') {
      const text = typeof record.content === 'string'
        ? record.content
        : (typeof record.text === 'string' ? record.text : null);
      if (text) out.push(text);
    }

    for (const [key, entry] of Object.entries(record)) {
      out.push(key.replace(/[_-]/g, ' '));
      collectJsonStrings(entry, out, depth + 1);
      if (out.length >= 3_000) break;
    }
  }
}

function extractJsonText(input: string): string {
  try {
    const parsed = JSON.parse(input) as unknown;
    const segments: string[] = [];
    collectJsonStrings(parsed, segments);
    return segments.join('. ');
  } catch {
    return input;
  }
}

function extractXmlText(input: string): string {
  return input
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodePdfEscapes(value: string): string {
  return value
    .replace(/\\n/g, ' ')
    .replace(/\\r/g, ' ')
    .replace(/\\t/g, ' ')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\');
}

function extractPdfText(bytes: Uint8Array): string {
  const raw = decodeLatin1(bytes);
  const snippets: string[] = [];

  const directMatches = raw.matchAll(/\(([^()]{2,320})\)\s*Tj/g);
  for (const match of directMatches) {
    const decoded = decodePdfEscapes(match[1]).trim();
    if (decoded.length >= 2) snippets.push(decoded);
  }

  const arrayMatches = raw.matchAll(/\[(.*?)\]\s*TJ/gs);
  for (const match of arrayMatches) {
    const pieces = [...match[1].matchAll(/\(([^()]{1,320})\)/g)]
      .map((piece) => decodePdfEscapes(piece[1]).trim())
      .filter((piece) => piece.length >= 2);
    if (pieces.length > 0) snippets.push(pieces.join(' '));
  }

  if (snippets.length === 0) {
    const fallback = raw.match(/[A-Za-z][A-Za-z0-9 ,.'"\-()]{3,}/g) ?? [];
    snippets.push(...fallback.slice(0, 500));
  }

  return snippets.join('\n');
}

function extractDocxText(path: string, bytes: Uint8Array, warnings: string[]): string {
  try {
    const files = unzipSync(bytes);
    const textParts: string[] = [];
    for (const [entryPath, entryBytes] of Object.entries(files)) {
      if (!entryPath.startsWith('word/')) continue;
      if (!entryPath.endsWith('.xml')) continue;
      if (!/document|header|footer|footnotes|endnotes/.test(entryPath)) continue;
      const xml = decodeUtf8(entryBytes);
      const extracted = extractXmlText(xml);
      if (extracted) textParts.push(extracted);
    }
    return textParts.join('\n');
  } catch {
    warnings.push(`Could not parse DOCX internals for ${path}.`);
    return '';
  }
}

function extractMboxText(input: string): string {
  return input
    .split(/\nFrom /)
    .slice(0, 400)
    .join('\nFrom ')
    .replace(/Content-Transfer-Encoding:[^\n]+/gi, ' ')
    .replace(/=\r?\n/g, '')
    .replace(/\n{3,}/g, '\n\n');
}

function extractTextFromExtension(path: string, bytes: Uint8Array, warnings: string[]): string {
  const ext = fileExt(path);
  const utf8 = () => decodeUtf8(bytes);

  if (ext === '.txt' || ext === '.md' || ext === '.log' || ext === '.rtf' || ext === '.yaml' || ext === '.yml') {
    return utf8();
  }
  if (ext === '.csv' || ext === '.tsv') {
    return extractCsvText(utf8());
  }
  if (ext === '.json' || ext === '.jsonl') {
    return extractJsonText(utf8());
  }
  if (ext === '.html' || ext === '.htm') {
    return stripHtmlLike(utf8());
  }
  if (ext === '.xml' || ext === '.ics') {
    return extractXmlText(utf8());
  }
  if (ext === '.mbox' || ext === '.eml') {
    return extractMboxText(utf8());
  }
  if (ext === '.pdf') {
    return extractPdfText(bytes);
  }
  if (ext === '.docx') {
    return extractDocxText(path, bytes, warnings);
  }

  const guessed = utf8();
  const readableChars = guessed.match(/[\x20-\x7E\n\r\t]/g)?.length ?? 0;
  const readability = guessed.length > 0 ? readableChars / guessed.length : 0;
  if (readability > 0.85) return guessed;

  warnings.push(`Skipped unsupported binary file ${path}.`);
  return '';
}

function parseOctal(input: Uint8Array): number {
  const text = decodeLatin1(input).replace(/\0/g, '').trim();
  if (!text) return 0;
  return Number.parseInt(text, 8);
}

function readTarString(input: Uint8Array): string {
  return decodeLatin1(input).replace(/\0.*$/, '').trim();
}

function parseTarEntries(buffer: Uint8Array): TarEntry[] {
  const entries: TarEntry[] = [];
  let offset = 0;

  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    const emptyBlock = header.every((byte) => byte === 0);
    if (emptyBlock) break;

    const name = readTarString(header.subarray(0, 100));
    const prefix = readTarString(header.subarray(345, 500));
    const fullPath = prefix ? `${prefix}/${name}` : name;
    const size = parseOctal(header.subarray(124, 136));
    const typeByte = header[156] || 48;
    const typeFlag = String.fromCharCode(typeByte);

    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    if (dataEnd > buffer.length) break;

    let kind: TarEntry['kind'] = 'file';
    if (typeFlag === '2') kind = 'symlink';
    if (typeFlag === '1') kind = 'hardlink';

    entries.push({
      path: fullPath,
      bytes: buffer.subarray(dataStart, dataEnd),
      kind,
    });

    const paddedSize = Math.ceil(size / 512) * 512;
    offset = dataStart + paddedSize;
  }

  return entries;
}

function parseArchivePayload(
  archivePath: string,
  bytes: Uint8Array,
  warnings: string[],
  depth: number,
): ExtractedTextBlock[] {
  if (depth > MAX_NESTED_ARCHIVE_DEPTH) {
    warnings.push(`Skipped nested archive ${archivePath}: max nesting depth exceeded.`);
    return [];
  }

  if (looksLikeZip(bytes) || fileExt(archivePath) === '.zip') {
    return parseZipArchive(archivePath, bytes, warnings, depth);
  }
  if (looksLikeGzip(bytes) || fileExt(archivePath) === '.gz' || fileExt(archivePath) === '.tgz' || fileExt(archivePath) === '.tar.gz') {
    return parseGzipArchive(archivePath, bytes, warnings, depth);
  }
  if (looksLikeTar(bytes) || fileExt(archivePath) === '.tar') {
    return parseTarArchive(archivePath, bytes, warnings, depth);
  }

  return [];
}

function parseZipArchive(
  archivePath: string,
  bytes: Uint8Array,
  warnings: string[],
  depth: number,
): ExtractedTextBlock[] {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    warnings.push(`Could not unzip archive ${archivePath}.`);
    return [];
  }

  const results: ExtractedTextBlock[] = [];
  let inspected = 0;

  for (const [entryPath, entryBytes] of Object.entries(entries)) {
    inspected += 1;
    if (inspected > MAX_ARCHIVE_ENTRIES) {
      warnings.push(`Archive ${archivePath} exceeded ${MAX_ARCHIVE_ENTRIES} entries; truncated.`);
      break;
    }
    if (entryBytes.length === 0) continue;

    const fullPath = `${archivePath}:${entryPath}`;
    if (entryBytes.length > MAX_FILE_BYTES) {
      warnings.push(`Skipped ${fullPath}: file too large (${entryBytes.length} bytes).`);
      continue;
    }

    if (isArchivePath(entryPath) || looksLikeZip(entryBytes) || looksLikeGzip(entryBytes) || looksLikeTar(entryBytes)) {
      results.push(...parseArchivePayload(fullPath, entryBytes, warnings, depth + 1));
      continue;
    }

    const extracted = normalizeText(extractTextFromExtension(fullPath, entryBytes, warnings));
    if (!extracted) continue;

    results.push({
      sourcePath: fullPath,
      sourceType: inferSourceType(fullPath),
      text: extracted.slice(0, MAX_TEXT_CHARS_PER_FILE),
    });
  }

  return results;
}

function parseTarArchive(
  archivePath: string,
  bytes: Uint8Array,
  warnings: string[],
  depth: number,
): ExtractedTextBlock[] {
  const entries = parseTarEntries(bytes);
  const results: ExtractedTextBlock[] = [];
  let inspected = 0;

  for (const entry of entries) {
    inspected += 1;
    if (inspected > MAX_ARCHIVE_ENTRIES) {
      warnings.push(`Archive ${archivePath} exceeded ${MAX_ARCHIVE_ENTRIES} entries; truncated.`);
      break;
    }
    if (entry.kind !== 'file') continue;
    if (entry.bytes.length === 0) continue;

    const fullPath = `${archivePath}:${entry.path}`;
    if (entry.bytes.length > MAX_FILE_BYTES) {
      warnings.push(`Skipped ${fullPath}: file too large (${entry.bytes.length} bytes).`);
      continue;
    }

    if (isArchivePath(entry.path) || looksLikeZip(entry.bytes) || looksLikeGzip(entry.bytes) || looksLikeTar(entry.bytes)) {
      results.push(...parseArchivePayload(fullPath, entry.bytes, warnings, depth + 1));
      continue;
    }

    const extracted = normalizeText(extractTextFromExtension(fullPath, entry.bytes, warnings));
    if (!extracted) continue;

    results.push({
      sourcePath: fullPath,
      sourceType: inferSourceType(fullPath),
      text: extracted.slice(0, MAX_TEXT_CHARS_PER_FILE),
    });
  }

  return results;
}

function parseGzipArchive(
  archivePath: string,
  bytes: Uint8Array,
  warnings: string[],
  depth: number,
): ExtractedTextBlock[] {
  let inflated: Uint8Array;
  try {
    inflated = gunzipSync(bytes);
  } catch {
    warnings.push(`Could not gunzip archive ${archivePath}.`);
    return [];
  }

  if (looksLikeTar(inflated) || fileExt(archivePath) === '.tgz' || fileExt(archivePath) === '.tar.gz') {
    return parseTarArchive(archivePath, inflated, warnings, depth);
  }

  const strippedPath = archivePath.replace(/\.gz$/i, '');
  const extracted = normalizeText(extractTextFromExtension(strippedPath, inflated, warnings));
  if (!extracted) return [];

  return [{
    sourcePath: strippedPath,
    sourceType: inferSourceType(strippedPath),
    text: extracted.slice(0, MAX_TEXT_CHARS_PER_FILE),
  }];
}

function parseFileToBlocks(fileName: string, bytes: Uint8Array, warnings: string[]): ExtractedTextBlock[] {
  const archiveBlocks = parseArchivePayload(fileName, bytes, warnings, 0);
  if (archiveBlocks.length > 0) return archiveBlocks;

  const extracted = normalizeText(extractTextFromExtension(fileName, bytes, warnings));
  if (!extracted) return [];

  return [{
    sourcePath: fileName,
    sourceType: inferSourceType(fileName),
    text: extracted.slice(0, MAX_TEXT_CHARS_PER_FILE),
  }];
}

export async function parseUniversalUploadFiles(files: FileList | File[]): Promise<UniversalUploadParseResult> {
  const fileArray = toFileArray(files);
  const warnings: string[] = [];
  const records: GeneralExtractionRecord[] = [];
  let parsedFiles = 0;
  let skippedFiles = 0;

  for (const file of fileArray) {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.length === 0) {
        skippedFiles += 1;
        warnings.push(`Skipped empty file ${file.name}.`);
        continue;
      }
      if (bytes.length > MAX_FILE_BYTES) {
        skippedFiles += 1;
        warnings.push(`Skipped ${file.name}: file too large (${bytes.length} bytes).`);
        continue;
      }

      const blocks = parseFileToBlocks(file.name, bytes, warnings);
      if (blocks.length === 0) {
        skippedFiles += 1;
        continue;
      }

      parsedFiles += 1;
      for (const block of blocks) {
        const chunks = chunkText(block.text);
        for (let i = 0; i < chunks.length; i += 1) {
          records.push({
            sourceType: block.sourceType,
            sourceId: `${block.sourcePath}#${i + 1}`,
            sourceName: block.sourcePath,
            content: chunks[i],
          });
        }
      }
    } catch {
      skippedFiles += 1;
      warnings.push(`Failed to read file ${file.name}.`);
    }
  }

  return {
    records,
    warnings,
    parsedFiles,
    skippedFiles,
  };
}
