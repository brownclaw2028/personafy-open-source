import type { GeneralExtractionRecord } from './general-extractor';
import type { ModelHydrationStatus } from './model-hydration-state';

interface WebLlmInitProgressReport {
  progress?: number;
  text?: string;
}

interface WebLlmCreateEngineConfig {
  initProgressCallback?: (report: WebLlmInitProgressReport) => void;
  logLevel?: 'INFO' | 'WARN' | 'ERROR';
}

interface WebLlmCompletionChoice {
  message?: {
    content?: string | null;
  };
}

interface WebLlmCompletionResponse {
  choices?: WebLlmCompletionChoice[];
}

interface WebLlmEngine {
  chat: {
    completions: {
      create: (request: {
        messages: Array<{ role: 'system' | 'user'; content: string }>;
        temperature?: number;
        top_p?: number;
        max_tokens?: number;
      }) => Promise<WebLlmCompletionResponse>;
    };
  };
}

interface WebLlmModule {
  CreateMLCEngine?: (modelId: string, config?: WebLlmCreateEngineConfig) => Promise<WebLlmEngine>;
}

export class WebLlmUnavailableError extends Error {
  constructor(message = 'WebLLM runtime unavailable') {
    super(message);
    this.name = 'WebLlmUnavailableError';
  }
}

export interface WebLlmAdapterProgressEvent {
  modelId: string;
  status: ModelHydrationStatus;
  progress: number;
  message?: string;
}

export interface WebLlmAdapterInput {
  records: GeneralExtractionRecord[];
  modelId: string;
  onProgress?: (event: WebLlmAdapterProgressEvent) => void;
}

export type WebLlmAdapterOutput = unknown[] | { contracts?: unknown[]; message?: string };

export interface WebLlmAdapterFactoryOptions {
  createEngine?: (
    modelId: string,
    config: WebLlmCreateEngineConfig,
  ) => Promise<WebLlmEngine>;
}

const PRIMARY_SYSTEM_PROMPT = `You extract durable user facts from text.
Rules:
- Return valid JSON only.
- Return an array of contract objects.
- Output only facts explicitly supported by evidence in source text.
- If no facts exist, return [].
- Use fields:
  domain, canonical_key, dynamic_key, value, temporal_status, is_negation,
  evidence_snippet, confidence, sensitivity, source_id, source_name
- confidence must be between 0 and 1.
- sensitivity must be one of: low, medium, high.
- temporal_status must be one of: current, past, hypothetical.
- Exactly one of canonical_key or dynamic_key must be non-null.
- dynamic_key must start with dynamic.
- source_id must exactly match one provided record source_id.
- evidence_snippet must be copied verbatim from source text (exact substring).
- Output JSON only. Do not include markdown or prose.`;

const RECOVERY_SYSTEM_PROMPT = `Return strict JSON only.
Output an array of contract objects using fields:
domain, canonical_key, dynamic_key, value, temporal_status, is_negation,
evidence_snippet, confidence, sensitivity, source_id, source_name.
Requirements:
- source_id must exactly match one provided source_id.
- evidence_snippet must be an exact substring from the same source record.
- Exactly one of canonical_key or dynamic_key must be non-null.
- dynamic_key must start with dynamic.
- If uncertain, return [].
Do not include markdown or explanation text.`;

const MAX_INPUT_RECORDS = 40;
const DEFAULT_RECORD_CHAR_LIMIT = 1_200;
const RECORD_CHAR_LIMIT_RETRY_STEPS = [1_200, 800, 500, 320] as const;
const MAX_BATCH_RECORDS = 8;
const MAX_BATCH_PAYLOAD_CHARS = 6_000;
const MAX_COMPLETION_TOKENS = 1_024;

interface PromptRecord {
  source_id: string;
  source_name: string;
  content: string;
}

function normalizeProgress(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value as number));
}

function statusFromProgress(progress: number): ModelHydrationStatus {
  if (progress >= 1) return 'ready';
  if (progress >= 0.8) return 'warming';
  if (progress > 0) return 'downloading';
  return 'not_downloaded';
}

function stripCodeFence(input: string): string {
  const trimmed = input.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  const withoutStart = trimmed.replace(/^```[a-z]*\n?/i, '');
  return withoutStart.replace(/\n?```$/, '').trim();
}

function extractJsonArrayText(input: string): string | null {
  const cleaned = stripCodeFence(input);
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return null;
  return cleaned.slice(start, end + 1);
}

function extractJsonObjectText(input: string): string | null {
  const cleaned = stripCodeFence(input);
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return cleaned.slice(start, end + 1);
}

function objectLooksLikeContract(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.source_id === 'string' &&
    typeof record.value === 'string' &&
    typeof record.evidence_snippet === 'string'
  );
}

function contractsFromObjectPayload(value: unknown): unknown[] {
  if (!value || typeof value !== 'object') return [];
  const obj = value as Record<string, unknown>;

  const candidateKeys = ['contracts', 'facts', 'items', 'results', 'data', 'output'] as const;
  for (const key of candidateKeys) {
    const nested = obj[key];
    if (Array.isArray(nested)) return nested;
  }

  if (objectLooksLikeContract(obj)) {
    return [obj];
  }

  return [];
}

function isLikelyContractCandidate(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (typeof record.source_id !== 'string') return false;

  // Distinguish contract-like objects from echoed source-record objects.
  const hasContractSignals =
    typeof record.domain === 'string' ||
    typeof record.canonical_key === 'string' ||
    typeof record.dynamic_key === 'string' ||
    typeof record.value === 'string' ||
    typeof record.evidence_snippet === 'string' ||
    typeof record.temporal_status === 'string';
  return hasContractSignals;
}

function parseContractsFromContent(content: string | null | undefined): unknown[] {
  if (!content || !content.trim()) return [];
  const trimmed = stripCodeFence(content);

  try {
    const direct = JSON.parse(trimmed) as unknown;
    if (Array.isArray(direct)) return direct;
    const objectContracts = contractsFromObjectPayload(direct);
    if (objectContracts.length > 0) {
      return objectContracts;
    }
  } catch {
    // fallback to array extraction
  }

  const arrayText = extractJsonArrayText(trimmed);
  if (!arrayText) return [];
  try {
    const parsed = JSON.parse(arrayText) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // continue to object fallbacks
  }

  const objectText = extractJsonObjectText(trimmed);
  if (!objectText) return [];
  try {
    const parsed = JSON.parse(objectText) as unknown;
    const objectContracts = contractsFromObjectPayload(parsed);
    return objectContracts;
  } catch {
    return [];
  }
}

function toPromptRecords(records: GeneralExtractionRecord[], contentLimit: number): PromptRecord[] {
  return records.slice(0, MAX_INPUT_RECORDS).map((record) => ({
    source_id: record.sourceId,
    source_name: record.sourceName,
    content: record.content.slice(0, contentLimit),
  }));
}

function promptRecordSize(record: PromptRecord): number {
  // Estimate serialized payload overhead to keep prompt payload inside a conservative budget.
  return record.source_id.length + record.source_name.length + record.content.length + 48;
}

function partitionPromptRecords(records: PromptRecord[]): PromptRecord[][] {
  const batches: PromptRecord[][] = [];
  let current: PromptRecord[] = [];
  let currentSize = 0;

  for (const record of records) {
    const nextSize = promptRecordSize(record);
    const exceedsRecordCount = current.length >= MAX_BATCH_RECORDS;
    const exceedsCharBudget = current.length > 0 && currentSize + nextSize > MAX_BATCH_PAYLOAD_CHARS;
    if (exceedsRecordCount || exceedsCharBudget) {
      batches.push(current);
      current = [];
      currentSize = 0;
    }
    current.push(record);
    currentSize += nextSize;
  }

  if (current.length > 0) {
    batches.push(current);
  }

  return batches;
}

function buildUserPrompt(batchRecords: PromptRecord[], batchIndex: number, totalBatches: number): string {
  const batchPrefix = totalBatches > 1
    ? `Batch ${batchIndex + 1} of ${totalBatches}. `
    : '';
  const sourceIds = batchRecords.map((record) => record.source_id);

  return [
    `${batchPrefix}Extract durable user facts from the following records.`,
    'Return a JSON array only.',
    `Allowed source_id values: ${JSON.stringify(sourceIds)}.`,
    'If none, return [].',
    '',
    JSON.stringify({ records: batchRecords }),
  ].join('\n');
}

function isContextOverflowError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /context window|prompt tokens exceed|input length|too many tokens/i.test(message);
}

async function requestBatchContracts(params: {
  engine: WebLlmEngine;
  systemPrompt: string;
  batchRecords: PromptRecord[];
  batchIndex: number;
  totalBatches: number;
}): Promise<{ contracts: unknown[]; rawContent: string }> {
  const completion = await params.engine.chat.completions.create({
    messages: [
      { role: 'system', content: params.systemPrompt },
      { role: 'user', content: buildUserPrompt(params.batchRecords, params.batchIndex, params.totalBatches) },
    ],
    temperature: 0,
    top_p: 1,
    max_tokens: MAX_COMPLETION_TOKENS,
  });

  const content = completion.choices?.[0]?.message?.content ?? '';
  return {
    contracts: parseContractsFromContent(content).filter(isLikelyContractCandidate),
    rawContent: content,
  };
}

async function importWebLlmModule(): Promise<WebLlmModule> {
  try {
    // Keep this as a direct dynamic import so Vite can resolve and bundle it for worker runtime.
    return await import('@mlc-ai/web-llm') as WebLlmModule;
  } catch {
    throw new WebLlmUnavailableError('WebLLM package not available');
  }
}

async function defaultCreateEngine(
  modelId: string,
  config: WebLlmCreateEngineConfig,
): Promise<WebLlmEngine> {
  const module = await importWebLlmModule();
  if (typeof module.CreateMLCEngine !== 'function') {
    throw new WebLlmUnavailableError('CreateMLCEngine is unavailable');
  }
  return module.CreateMLCEngine(modelId, config);
}

function progressEvent(modelId: string, report: WebLlmInitProgressReport): WebLlmAdapterProgressEvent {
  const progress = normalizeProgress(report.progress);
  return {
    modelId,
    progress,
    status: statusFromProgress(progress),
    message: report.text,
  };
}

export function createWebLlmSemanticAdapter(
  options: WebLlmAdapterFactoryOptions = {},
): (input: WebLlmAdapterInput) => Promise<WebLlmAdapterOutput> {
  const createEngine = options.createEngine ?? defaultCreateEngine;
  const engineByModel = new Map<string, Promise<WebLlmEngine>>();

  async function ensureEngine(input: WebLlmAdapterInput): Promise<WebLlmEngine> {
    const cached = engineByModel.get(input.modelId);
    if (cached) {
      input.onProgress?.({
        modelId: input.modelId,
        status: 'ready',
        progress: 1,
        message: 'Model is ready (cached).',
      });
      return cached;
    }

    const pending = createEngine(input.modelId, {
      logLevel: 'WARN',
      initProgressCallback: (report) => {
        input.onProgress?.(progressEvent(input.modelId, report));
      },
    }).then((engine) => {
      input.onProgress?.({
        modelId: input.modelId,
        status: 'ready',
        progress: 1,
        message: 'Model ready.',
      });
      return engine;
    }).catch((error) => {
      engineByModel.delete(input.modelId);
      input.onProgress?.({
        modelId: input.modelId,
        status: 'failed',
        progress: 0,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    });

    engineByModel.set(input.modelId, pending);
    return pending;
  }

  return async (input: WebLlmAdapterInput): Promise<WebLlmAdapterOutput> => {
    const engine = await ensureEngine(input);
    if (input.records.length === 0) return [];

    let overflowError: unknown = null;
    const retrySteps = [...new Set([DEFAULT_RECORD_CHAR_LIMIT, ...RECORD_CHAR_LIMIT_RETRY_STEPS])]
      .sort((a, b) => b - a);

    for (const contentLimit of retrySteps) {
      const promptRecords = toPromptRecords(input.records, contentLimit);
      const batches = partitionPromptRecords(promptRecords);
      const aggregatedContracts: unknown[] = [];
      let lastRawContent = '';
      try {
        for (let index = 0; index < batches.length; index += 1) {
          const primaryContracts = await requestBatchContracts({
            engine,
            systemPrompt: PRIMARY_SYSTEM_PROMPT,
            batchRecords: batches[index],
            batchIndex: index,
            totalBatches: batches.length,
          });
          lastRawContent = primaryContracts.rawContent || lastRawContent;
          if (primaryContracts.contracts.length > 0) {
            aggregatedContracts.push(...primaryContracts.contracts);
            continue;
          }

          // Recovery pass: keep validator requirements but force strict JSON framing.
          const recoveryContracts = await requestBatchContracts({
            engine,
            systemPrompt: RECOVERY_SYSTEM_PROMPT,
            batchRecords: batches[index],
            batchIndex: index,
            totalBatches: batches.length,
          });
          lastRawContent = recoveryContracts.rawContent || lastRawContent;
          aggregatedContracts.push(...recoveryContracts.contracts);
        }

        if (aggregatedContracts.length === 0) {
          const preview = stripCodeFence(lastRawContent).slice(0, 320);
          return {
            contracts: [],
            message: preview ? `No parseable contracts from model response: ${preview}` : 'No parseable contracts from model response.',
          };
        }
        return aggregatedContracts;
      } catch (error) {
        if (!isContextOverflowError(error)) {
          throw error;
        }
        overflowError = error;
      }
    }

    throw overflowError ?? new Error('WebLLM prompt exceeded context limits');
  };
}

let defaultAdapter: ((input: WebLlmAdapterInput) => Promise<WebLlmAdapterOutput>) | null = null;

export function getDefaultWebLlmSemanticAdapter(): (
  input: WebLlmAdapterInput
) => Promise<WebLlmAdapterOutput> {
  if (!defaultAdapter) {
    defaultAdapter = createWebLlmSemanticAdapter();
  }
  return defaultAdapter;
}
