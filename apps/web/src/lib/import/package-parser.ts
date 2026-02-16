import { gunzipSync, unzipSync } from 'fflate';
import type { SourceType } from '../dev/types';
import {
  createAdapterContext,
  selectPackageAdapter,
  type PackageAdapterFile,
} from './package-adapters';

export interface PackageSecurityLimits {
  maxUncompressedBytes: number;
  maxArchiveEntries: number;
  maxNestedArchiveDepth: number;
  maxSingleFileBytes: number;
}

export const DEFAULT_PACKAGE_SECURITY_LIMITS: PackageSecurityLimits = {
  maxUncompressedBytes: 500 * 1024 * 1024, // 500 MB
  maxArchiveEntries: 20_000,
  maxNestedArchiveDepth: 3,
  maxSingleFileBytes: 50 * 1024 * 1024, // 50 MB
};

export type PackageType = 'json' | 'zip' | 'tgz' | 'ics';

export type PackageParseErrorCode =
  | 'UNSUPPORTED_FORMAT'
  | 'FORMAT_SPOOFED'
  | 'PATH_TRAVERSAL'
  | 'MAX_ENTRIES_EXCEEDED'
  | 'MAX_UNCOMPRESSED_BYTES_EXCEEDED'
  | 'MAX_SINGLE_FILE_BYTES_EXCEEDED'
  | 'NESTED_ARCHIVE_DEPTH_EXCEEDED'
  | 'SYMLINK_ENTRY_REJECTED'
  | 'HARDLINK_ENTRY_REJECTED'
  | 'ADAPTER_PARSE_FAILED';

export class PackageParseError extends Error {
  code: PackageParseErrorCode;

  constructor(code: PackageParseErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'PackageParseError';
  }
}

export interface ParsePackageOptions {
  selectedSource?: SourceType;
  limits?: Partial<PackageSecurityLimits>;
}

export interface ParsedImportPackage<T = unknown> {
  sourceType: SourceType;
  packageType: PackageType;
  records: T[];
  fileCount: number;
  totalUncompressedBytes: number;
  warnings: string[];
}

interface ArchiveEntry {
  path: string;
  bytes: Uint8Array;
  kind: 'file' | 'symlink' | 'hardlink';
}

interface SecurityBudgetLedger {
  fileCount: number;
  totalUncompressedBytes: number;
}

function mergeLimits(
  overrides?: Partial<PackageSecurityLimits>,
): PackageSecurityLimits {
  return {
    ...DEFAULT_PACKAGE_SECURITY_LIMITS,
    ...(overrides ?? {}),
  };
}

function extFromName(fileName: string): string {
  return fileName.toLowerCase();
}

function isZipMagic(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4
    && bytes[0] === 0x50
    && bytes[1] === 0x4b
    && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07)
  );
}

function isGzipMagic(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

function isLikelyText(bytes: Uint8Array): boolean {
  const maxScan = Math.min(bytes.length, 1024);
  for (let i = 0; i < maxScan; i += 1) {
    const b = bytes[i];
    if (b === 0) return false;
  }
  return true;
}

function detectPackageType(fileName: string, bytes: Uint8Array): PackageType {
  const lower = extFromName(fileName);
  const zipMagic = isZipMagic(bytes);
  const gzipMagic = isGzipMagic(bytes);

  if (lower.endsWith('.zip')) {
    if (!zipMagic) {
      throw new PackageParseError(
        'FORMAT_SPOOFED',
        'File extension indicates zip but content is not a zip archive',
      );
    }
    return 'zip';
  }

  if (lower.endsWith('.tgz') || lower.endsWith('.tar.gz') || lower.endsWith('.gz')) {
    if (!gzipMagic) {
      throw new PackageParseError(
        'FORMAT_SPOOFED',
        'File extension indicates gzip/tgz but content is not gzip',
      );
    }
    return 'tgz';
  }

  if (lower.endsWith('.ics')) {
    if (zipMagic || gzipMagic) {
      throw new PackageParseError(
        'FORMAT_SPOOFED',
        'File extension indicates ICS but content appears to be an archive',
      );
    }
    return 'ics';
  }

  if (lower.endsWith('.json')) {
    if (zipMagic || gzipMagic) {
      throw new PackageParseError(
        'FORMAT_SPOOFED',
        'File extension indicates JSON but content appears to be an archive',
      );
    }
    return 'json';
  }

  // Fallback to content sniffing.
  if (zipMagic) return 'zip';
  if (gzipMagic) return 'tgz';
  if (isLikelyText(bytes)) return 'json';

  throw new PackageParseError(
    'UNSUPPORTED_FORMAT',
    `Unsupported import package format for file: ${fileName}`,
  );
}

function assertSafePath(pathValue: string): void {
  const normalized = pathValue.replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/')) {
    throw new PackageParseError('PATH_TRAVERSAL', `Unsafe archive path: ${pathValue}`);
  }
  if (normalized.includes('../') || normalized.startsWith('..')) {
    throw new PackageParseError('PATH_TRAVERSAL', `Unsafe archive path: ${pathValue}`);
  }
  if (/^[a-z]:/i.test(normalized)) {
    throw new PackageParseError('PATH_TRAVERSAL', `Unsafe archive path: ${pathValue}`);
  }
}

function parseOctal(input: Uint8Array): number {
  const text = new TextDecoder().decode(input).replace(/\0/g, '').trim();
  if (!text) return 0;
  return Number.parseInt(text, 8);
}

function readTarString(input: Uint8Array): string {
  return new TextDecoder().decode(input).replace(/\0.*$/, '').trim();
}

function parseTarEntries(buffer: Uint8Array): ArchiveEntry[] {
  const entries: ArchiveEntry[] = [];
  let offset = 0;

  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    const emptyBlock = header.every((b) => b === 0);
    if (emptyBlock) break;

    const name = readTarString(header.subarray(0, 100));
    const prefix = readTarString(header.subarray(345, 500));
    const fullPath = prefix ? `${prefix}/${name}` : name;
    const size = parseOctal(header.subarray(124, 136));
    const typeByte = header[156] || 48;
    const typeFlag = String.fromCharCode(typeByte);
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    if (dataEnd > buffer.length) {
      throw new PackageParseError('ADAPTER_PARSE_FAILED', 'Malformed tar archive: entry exceeds archive size');
    }

    let kind: ArchiveEntry['kind'] = 'file';
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

function decodeText(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

function normalizeArchiveParseError(error: unknown, contextPath: string): PackageParseError {
  if (error instanceof PackageParseError) return error;
  const detail = error instanceof Error ? error.message : String(error);
  return new PackageParseError(
    'ADAPTER_PARSE_FAILED',
    `Malformed archive content at ${contextPath}: ${detail}`,
  );
}

function consumeSecurityBudget(
  entryPath: string,
  bytes: Uint8Array,
  limits: PackageSecurityLimits,
  ledger: SecurityBudgetLedger,
): void {
  ledger.fileCount += 1;
  if (ledger.fileCount > limits.maxArchiveEntries) {
    throw new PackageParseError(
      'MAX_ENTRIES_EXCEEDED',
      `Archive entry count ${ledger.fileCount} exceeds limit ${limits.maxArchiveEntries}`,
    );
  }

  if (bytes.length > limits.maxSingleFileBytes) {
    throw new PackageParseError(
      'MAX_SINGLE_FILE_BYTES_EXCEEDED',
      `File ${entryPath} exceeds max single-file size limit`,
    );
  }

  ledger.totalUncompressedBytes += bytes.length;
  if (ledger.totalUncompressedBytes > limits.maxUncompressedBytes) {
    throw new PackageParseError(
      'MAX_UNCOMPRESSED_BYTES_EXCEEDED',
      'Total uncompressed size exceeds configured limit',
    );
  }
}

function inspectNestedArchive(
  bytes: Uint8Array,
  pathValue: string,
  depth: number,
  limits: PackageSecurityLimits,
  ledger: SecurityBudgetLedger,
): void {
  if (depth > limits.maxNestedArchiveDepth) {
    throw new PackageParseError(
      'NESTED_ARCHIVE_DEPTH_EXCEEDED',
      `Nested archive depth exceeded for ${pathValue}`,
    );
  }

  const lower = pathValue.toLowerCase();
  const isZip = lower.endsWith('.zip') || isZipMagic(bytes);
  const isTgz = lower.endsWith('.tgz') || lower.endsWith('.tar.gz') || isGzipMagic(bytes);
  if (!isZip && !isTgz) return;

  if (isZip) {
    try {
      const nested = unzipSync(bytes);
      for (const [nestedPath, nestedBytes] of Object.entries(nested)) {
        assertSafePath(nestedPath);
        consumeSecurityBudget(nestedPath, nestedBytes, limits, ledger);
        inspectNestedArchive(nestedBytes, nestedPath, depth + 1, limits, ledger);
      }
    } catch (error) {
      throw normalizeArchiveParseError(error, pathValue);
    }
    return;
  }

  if (isTgz) {
    try {
      const tarBytes = gunzipSync(bytes);
      const entries = parseTarEntries(tarBytes);
      for (const entry of entries) {
        assertSafePath(entry.path);
        if (entry.kind === 'symlink') {
          throw new PackageParseError(
            'SYMLINK_ENTRY_REJECTED',
            `Symlink entries are not allowed in import archives (${entry.path})`,
          );
        }
        if (entry.kind === 'hardlink') {
          throw new PackageParseError(
            'HARDLINK_ENTRY_REJECTED',
            `Hardlink entries are not allowed in import archives (${entry.path})`,
          );
        }
        consumeSecurityBudget(entry.path, entry.bytes, limits, ledger);
        inspectNestedArchive(entry.bytes, entry.path, depth + 1, limits, ledger);
      }
    } catch (error) {
      throw normalizeArchiveParseError(error, pathValue);
    }
  }
}

function enforceLimits(
  entries: ArchiveEntry[],
  limits: PackageSecurityLimits,
): { totalUncompressedBytes: number; fileCount: number } {
  const ledger: SecurityBudgetLedger = {
    fileCount: 0,
    totalUncompressedBytes: 0,
  };

  for (const entry of entries) {
    assertSafePath(entry.path);

    if (entry.kind === 'symlink') {
      throw new PackageParseError(
        'SYMLINK_ENTRY_REJECTED',
        `Symlink entries are not allowed in import archives (${entry.path})`,
      );
    }
    if (entry.kind === 'hardlink') {
      throw new PackageParseError(
        'HARDLINK_ENTRY_REJECTED',
        `Hardlink entries are not allowed in import archives (${entry.path})`,
      );
    }

    consumeSecurityBudget(entry.path, entry.bytes, limits, ledger);
    inspectNestedArchive(entry.bytes, entry.path, 1, limits, ledger);
  }

  return {
    totalUncompressedBytes: ledger.totalUncompressedBytes,
    fileCount: ledger.fileCount,
  };
}

function entriesFromZip(bytes: Uint8Array): ArchiveEntry[] {
  const zipped = unzipSync(bytes);
  return Object.entries(zipped).map(([entryPath, entryBytes]) => ({
    path: entryPath,
    bytes: entryBytes,
    kind: 'file',
  }));
}

function entriesFromTgz(bytes: Uint8Array): ArchiveEntry[] {
  const tar = gunzipSync(bytes);
  return parseTarEntries(tar);
}

export async function parseImportPackage(
  file: Pick<File, 'name' | 'arrayBuffer'>,
  options: ParsePackageOptions = {},
): Promise<ParsedImportPackage> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return parseImportPayload(file.name, bytes, options);
}

export function parseImportPayload(
  fileName: string,
  bytes: Uint8Array,
  options: ParsePackageOptions = {},
): ParsedImportPackage {
  const limits = mergeLimits(options.limits);
  const packageType = detectPackageType(fileName, bytes);
  const warnings: string[] = [];
  const entries: ArchiveEntry[] = [];

  try {
    if (packageType === 'zip') {
      entries.push(...entriesFromZip(bytes));
    } else if (packageType === 'tgz') {
      entries.push(...entriesFromTgz(bytes));
    } else {
      entries.push({
        path: fileName,
        bytes,
        kind: 'file',
      });
    }
  } catch (error) {
    throw normalizeArchiveParseError(error, fileName);
  }

  const { totalUncompressedBytes, fileCount } = enforceLimits(entries, limits);

  const adapterFiles: PackageAdapterFile[] = entries
    .filter((entry) => entry.kind === 'file')
    .map((entry) => ({
      path: entry.path,
      content: decodeText(entry.bytes),
    }));

  try {
    const adapterContext = createAdapterContext(adapterFiles, options.selectedSource);
    const adapter = selectPackageAdapter(adapterContext);
    const records = adapter.normalize(adapterContext);
    if (packageType === 'json' && !options.selectedSource && adapter.sourceType !== 'chatgpt') {
      warnings.push(`Detected ${adapter.sourceType} records from JSON payload`);
    }
    return {
      sourceType: adapter.sourceType,
      packageType,
      records,
      fileCount,
      totalUncompressedBytes,
      warnings,
    };
  } catch (error) {
    if (error instanceof PackageParseError) throw error;
    throw new PackageParseError(
      'ADAPTER_PARSE_FAILED',
      error instanceof Error ? error.message : String(error),
    );
  }
}
