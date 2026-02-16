import type { GeneralExtractionRecord } from './general-extractor';

export interface AtomicSieveSentence {
  sourceType: GeneralExtractionRecord['sourceType'];
  sourceId: string;
  sourceName: string;
  sentenceIndex: number;
  charStart: number;
  charEnd: number;
  text: string;
}

export interface AtomicSieveChunk {
  chunkId: string;
  sourceType: GeneralExtractionRecord['sourceType'];
  sourceId: string;
  sourceName: string;
  sentenceStartIndex: number;
  sentenceEndIndex: number;
  sentenceCount: number;
  estimatedChars: number;
  text: string;
  sentences: AtomicSieveSentence[];
}

export interface AtomicSieveWindow {
  windowId: string;
  sourceId: string;
  sourceName: string;
  chunkIds: string[];
  sentenceStartIndex: number;
  sentenceEndIndex: number;
  estimatedChars: number;
  text: string;
}

export interface AtomicSieveStats {
  recordsProcessed: number;
  sentencesTotal: number;
  sentencesRetained: number;
  sentencesDroppedNoise: number;
  sentencesDroppedShort: number;
  recordsTruncated: number;
  chunksProduced: number;
  windowsProduced: number;
  truncatedByBudget: boolean;
}

export interface AtomicSieveOptions {
  minSentenceChars: number;
  maxSentencesPerRecord: number;
  maxSentencesTotal: number;
  maxSentencesPerChunk: number;
  minSentencesPerChunk: number;
  maxCharsPerChunk: number;
  windowSize: number;
  windowStride: number;
  maxChunksTotal: number;
  maxWindowsTotal: number;
}

export interface AtomicSieveResult {
  chunks: AtomicSieveChunk[];
  windows: AtomicSieveWindow[];
  stats: AtomicSieveStats;
}

const DEFAULT_OPTIONS: AtomicSieveOptions = {
  minSentenceChars: 18,
  maxSentencesPerRecord: 240,
  maxSentencesTotal: 4_000,
  maxSentencesPerChunk: 5,
  minSentencesPerChunk: 3,
  maxCharsPerChunk: 1_200,
  windowSize: 3,
  windowStride: 1,
  maxChunksTotal: 1_500,
  maxWindowsTotal: 3_000,
};

const FIRST_PERSON_PATTERN = /\b(i|i'm|i am|i've|ive|my|we|our)\b/i;
const STABLE_PREFERENCE_PATTERN =
  /\b(prefer|like|love|hate|avoid|always|usually|typically|allergic|sensitive|wear|buy|book|fly|eat|drink|shop)\b/i;
const NOISE_PATTERN =
  /\b(unsubscribe|view in browser|privacy policy|terms of service|all rights reserved|do not reply|tracking number|shipment tracking|order (?:status|number|id)|invoice|subtotal|sales tax|your order has shipped)\b/i;

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function splitSegments(content: string): string[] {
  return normalizeWhitespace(content)
    .split(/(?<=[.!?])\s+|[\r\n]+/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

function isPreferenceSignal(segment: string): boolean {
  return FIRST_PERSON_PATTERN.test(segment) && STABLE_PREFERENCE_PATTERN.test(segment);
}

function isLikelyNoise(segment: string): boolean {
  if (isPreferenceSignal(segment)) return false;
  return NOISE_PATTERN.test(segment);
}

function toOptions(options: Partial<AtomicSieveOptions> | undefined): AtomicSieveOptions {
  const merged = {
    ...DEFAULT_OPTIONS,
    ...(options ?? {}),
  };
  return {
    ...merged,
    minSentenceChars: Math.max(8, Math.floor(merged.minSentenceChars)),
    maxSentencesPerRecord: Math.max(20, Math.floor(merged.maxSentencesPerRecord)),
    maxSentencesTotal: Math.max(10, Math.floor(merged.maxSentencesTotal)),
    maxSentencesPerChunk: Math.max(1, Math.floor(merged.maxSentencesPerChunk)),
    minSentencesPerChunk: Math.max(1, Math.floor(merged.minSentencesPerChunk)),
    maxCharsPerChunk: Math.max(120, Math.floor(merged.maxCharsPerChunk)),
    windowSize: Math.max(1, Math.floor(merged.windowSize)),
    windowStride: Math.max(1, Math.floor(merged.windowStride)),
    maxChunksTotal: Math.max(10, Math.floor(merged.maxChunksTotal)),
    maxWindowsTotal: Math.max(10, Math.floor(merged.maxWindowsTotal)),
  };
}

function createRecordSentences(params: {
  record: GeneralExtractionRecord;
  options: AtomicSieveOptions;
  remainingSentenceBudget: number;
}): {
  kept: AtomicSieveSentence[];
  total: number;
  droppedNoise: number;
  droppedShort: number;
  truncated: boolean;
} {
  const segments = splitSegments(params.record.content);
  const limited = segments.slice(0, params.options.maxSentencesPerRecord);
  const truncatedByRecordLimit = segments.length > limited.length;
  let cursor = 0;
  let keptCount = 0;
  let droppedNoise = 0;
  let droppedShort = 0;
  const kept: AtomicSieveSentence[] = [];

  for (let index = 0; index < limited.length; index += 1) {
    if (keptCount >= params.remainingSentenceBudget) {
      return {
        kept,
        total: limited.length,
        droppedNoise,
        droppedShort: droppedShort + (limited.length - index),
        truncated: true,
      };
    }

    const segment = limited[index];
    const start = cursor;
    const end = start + segment.length;
    cursor = end + 1;

    if (segment.length < params.options.minSentenceChars) {
      droppedShort += 1;
      continue;
    }
    if (isLikelyNoise(segment)) {
      droppedNoise += 1;
      continue;
    }

    kept.push({
      sourceType: params.record.sourceType,
      sourceId: params.record.sourceId,
      sourceName: params.record.sourceName,
      sentenceIndex: index,
      charStart: start,
      charEnd: end,
      text: segment,
    });
    keptCount += 1;
  }

  return {
    kept,
    total: limited.length,
    droppedNoise,
    droppedShort,
    truncated: truncatedByRecordLimit,
  };
}

function mergeTrailingSmallChunk(
  groups: AtomicSieveSentence[][],
  options: AtomicSieveOptions,
): AtomicSieveSentence[][] {
  if (groups.length < 2) return groups;
  const next = [...groups];
  const last = next[next.length - 1];
  if (last.length >= options.minSentencesPerChunk) return groups;

  const previous = next[next.length - 2];
  const merged = [...previous, ...last];
  next[next.length - 2] = merged;
  next.pop();
  return next;
}

function toChunksForRecord(
  record: GeneralExtractionRecord,
  sentences: AtomicSieveSentence[],
  options: AtomicSieveOptions,
  existingChunkCount: number,
): AtomicSieveChunk[] {
  if (sentences.length === 0) return [];

  const groups: AtomicSieveSentence[][] = [];
  let current: AtomicSieveSentence[] = [];
  let currentChars = 0;

  for (const sentence of sentences) {
    const nextChars = currentChars + sentence.text.length + (current.length > 0 ? 1 : 0);
    const exceedsSentenceCount = current.length >= options.maxSentencesPerChunk;
    const exceedsCharBudget = current.length > 0 && nextChars > options.maxCharsPerChunk;

    if (exceedsSentenceCount || exceedsCharBudget) {
      groups.push(current);
      current = [];
      currentChars = 0;
    }

    current.push(sentence);
    currentChars += sentence.text.length + (current.length > 1 ? 1 : 0);
  }

  if (current.length > 0) {
    groups.push(current);
  }

  const mergedGroups = mergeTrailingSmallChunk(groups, options);

  return mergedGroups.map((group, index) => ({
    chunkId: `chunk:${record.sourceId}:${existingChunkCount + index}`,
    sourceType: record.sourceType,
    sourceId: record.sourceId,
    sourceName: record.sourceName,
    sentenceStartIndex: group[0].sentenceIndex,
    sentenceEndIndex: group[group.length - 1].sentenceIndex,
    sentenceCount: group.length,
    estimatedChars: group.reduce((sum, sentence) => sum + sentence.text.length, 0),
    text: group.map((sentence) => sentence.text).join(' '),
    sentences: group,
  }));
}

function toWindows(
  chunks: AtomicSieveChunk[],
  options: AtomicSieveOptions,
): AtomicSieveWindow[] {
  const windows: AtomicSieveWindow[] = [];
  const bySource = new Map<string, AtomicSieveChunk[]>();
  for (const chunk of chunks) {
    const list = bySource.get(chunk.sourceId) ?? [];
    list.push(chunk);
    bySource.set(chunk.sourceId, list);
  }

  for (const [sourceId, sourceChunks] of bySource.entries()) {
    for (let i = 0; i < sourceChunks.length; i += options.windowStride) {
      if (windows.length >= options.maxWindowsTotal) return windows;
      const windowChunks = sourceChunks.slice(i, i + options.windowSize);
      if (windowChunks.length === 0) continue;

      const first = windowChunks[0];
      const last = windowChunks[windowChunks.length - 1];
      windows.push({
        windowId: `window:${sourceId}:${i}`,
        sourceId,
        sourceName: first.sourceName,
        chunkIds: windowChunks.map((chunk) => chunk.chunkId),
        sentenceStartIndex: first.sentenceStartIndex,
        sentenceEndIndex: last.sentenceEndIndex,
        estimatedChars: windowChunks.reduce((sum, chunk) => sum + chunk.estimatedChars, 0),
        text: windowChunks.map((chunk) => chunk.text).join(' '),
      });
    }
  }

  return windows;
}

export function runAtomicSieve(
  records: GeneralExtractionRecord[],
  partialOptions: Partial<AtomicSieveOptions> = {},
): AtomicSieveResult {
  const options = toOptions(partialOptions);
  const stats: AtomicSieveStats = {
    recordsProcessed: 0,
    sentencesTotal: 0,
    sentencesRetained: 0,
    sentencesDroppedNoise: 0,
    sentencesDroppedShort: 0,
    recordsTruncated: 0,
    chunksProduced: 0,
    windowsProduced: 0,
    truncatedByBudget: false,
  };
  const chunks: AtomicSieveChunk[] = [];

  for (const record of records) {
    if (!record.content || !record.content.trim()) continue;
    if (stats.sentencesRetained >= options.maxSentencesTotal || chunks.length >= options.maxChunksTotal) {
      stats.truncatedByBudget = true;
      break;
    }

    const remainingSentenceBudget = Math.max(0, options.maxSentencesTotal - stats.sentencesRetained);
    const sent = createRecordSentences({
      record,
      options,
      remainingSentenceBudget,
    });
    stats.recordsProcessed += 1;
    stats.sentencesTotal += sent.total;
    stats.sentencesRetained += sent.kept.length;
    stats.sentencesDroppedNoise += sent.droppedNoise;
    stats.sentencesDroppedShort += sent.droppedShort;
    if (sent.truncated) stats.recordsTruncated += 1;
    if (sent.truncated && sent.kept.length >= remainingSentenceBudget) {
      stats.truncatedByBudget = true;
    }

    const recordChunks = toChunksForRecord(record, sent.kept, options, chunks.length);
    for (const chunk of recordChunks) {
      if (chunks.length >= options.maxChunksTotal) {
        stats.truncatedByBudget = true;
        break;
      }
      chunks.push(chunk);
    }
  }

  const windows = toWindows(chunks, options);
  stats.chunksProduced = chunks.length;
  stats.windowsProduced = windows.length;

  return {
    chunks,
    windows,
    stats,
  };
}
