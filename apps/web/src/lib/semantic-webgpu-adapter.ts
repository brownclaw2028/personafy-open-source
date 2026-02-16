import type { GeneralExtractionRecord } from './general-extractor';
import {
  type SemanticExtractionContract,
  validateSemanticContract,
} from './semantic-contracts';
import type {
  SemanticWorkerFallbackReason,
  SemanticWorkerProgressUpdate,
} from './semantic-worker-types';
import {
  getDefaultWebLlmSemanticAdapter,
  WebLlmUnavailableError,
} from './semantic-webgpu-adapter.webllm';

interface WebGpuAdapterInput {
  records: GeneralExtractionRecord[];
  modelId: string;
  onProgress?: (event: SemanticWorkerProgressUpdate) => void;
}

type WebGpuAdapterOutput = unknown[] | { contracts?: unknown[]; message?: string };

type InjectedWebGpuAdapter = (input: WebGpuAdapterInput) => Promise<WebGpuAdapterOutput>;

interface AdapterGlobalScope {
  __PERSONAFY_WEBGPU_SEMANTIC_ADAPTER__?: InjectedWebGpuAdapter;
  navigator?: {
    gpu?: unknown;
  };
}

interface WebGpuAdapterFailure {
  ok: false;
  reason: SemanticWorkerFallbackReason;
  message?: string;
}

interface WebGpuAdapterSuccess {
  ok: true;
  contracts: SemanticExtractionContract[];
  rejectedContracts: number;
}

export type WebGpuAdapterAttempt =
  | WebGpuAdapterFailure
  | WebGpuAdapterSuccess;

export interface WebGpuAdapterRequest {
  records: GeneralExtractionRecord[];
  enableWebGpu: boolean;
  modelId: string;
  onProgress?: (event: SemanticWorkerProgressUpdate) => void;
}

function getAdapterGlobalScope(): AdapterGlobalScope {
  return globalThis as unknown as AdapterGlobalScope;
}

function hasWebGpuSupport(scope: AdapterGlobalScope): boolean {
  return Boolean(scope.navigator?.gpu);
}

function resolveInjectedAdapter(scope: AdapterGlobalScope): InjectedWebGpuAdapter | null {
  const adapter = scope.__PERSONAFY_WEBGPU_SEMANTIC_ADAPTER__;
  return typeof adapter === 'function' ? adapter : null;
}

function toRawContracts(raw: WebGpuAdapterOutput): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object' && Array.isArray(raw.contracts)) return raw.contracts;
  return [];
}

function toRawMessage(raw: WebGpuAdapterOutput): string | undefined {
  if (!raw || Array.isArray(raw) || typeof raw !== 'object') return undefined;
  return typeof raw.message === 'string' && raw.message.trim().length > 0 ? raw.message : undefined;
}

function sourceTextById(records: GeneralExtractionRecord[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const record of records) {
    map.set(record.sourceId, record.content);
  }
  return map;
}

function sourceIdByName(records: GeneralExtractionRecord[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const record of records) {
    const key = record.sourceName.trim().toLowerCase();
    if (key.length === 0) continue;
    if (!map.has(key)) {
      map.set(key, record.sourceId);
    }
  }
  return map;
}

function stripOuterQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function normalizeForContainsCheck(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function sourceContainsEvidence(sourceText: string, evidenceSnippet: string): boolean {
  const source = normalizeForContainsCheck(sourceText);
  const evidence = normalizeForContainsCheck(evidenceSnippet);
  if (!source || !evidence) return false;
  return source.includes(evidence);
}

function normalizeRawCandidateForValidation(params: {
  rawContract: Record<string, unknown>;
  sourceTextByIdMap: Map<string, string>;
  sourceIdByNameMap: Map<string, string>;
}): Record<string, unknown> {
  const normalized: Record<string, unknown> = { ...params.rawContract };

  if (typeof normalized.domain === 'string') {
    normalized.domain = normalized.domain.trim().toLowerCase();
  }
  if (typeof normalized.temporal_status === 'string') {
    normalized.temporal_status = normalized.temporal_status.trim().toLowerCase();
  }
  if (typeof normalized.sensitivity === 'string') {
    normalized.sensitivity = normalized.sensitivity.trim().toLowerCase();
  }
  if (typeof normalized.is_negation === 'string') {
    const flag = normalized.is_negation.trim().toLowerCase();
    if (flag === 'true') normalized.is_negation = true;
    if (flag === 'false') normalized.is_negation = false;
  }
  if (typeof normalized.confidence === 'string') {
    const parsed = Number.parseFloat(normalized.confidence);
    if (Number.isFinite(parsed)) normalized.confidence = parsed;
  }
  if (typeof normalized.evidence_snippet === 'string') {
    normalized.evidence_snippet = stripOuterQuotes(normalized.evidence_snippet);
  }
  if (typeof normalized.value === 'string') {
    normalized.value = stripOuterQuotes(normalized.value);
  }

  const sourceName = typeof normalized.source_name === 'string'
    ? normalized.source_name.trim()
    : '';
  const sourceNameLookup = sourceName.toLowerCase();
  const sourceId = typeof normalized.source_id === 'string' ? normalized.source_id.trim() : '';
  const knownSourceId = sourceId.length > 0 && params.sourceTextByIdMap.has(sourceId)
    ? sourceId
    : params.sourceIdByNameMap.get(sourceNameLookup) ?? '';
  if (knownSourceId) {
    normalized.source_id = knownSourceId;
  }

  const matchedSourceText = knownSourceId ? (params.sourceTextByIdMap.get(knownSourceId) ?? '') : '';
  const evidence = typeof normalized.evidence_snippet === 'string'
    ? normalized.evidence_snippet
    : '';
  const value = typeof normalized.value === 'string' ? normalized.value : '';
  const valueLooksGrounded = value.length >= 3 && sourceContainsEvidence(matchedSourceText, value);
  if (!sourceContainsEvidence(matchedSourceText, evidence) && valueLooksGrounded) {
    normalized.evidence_snippet = value;
  }

  return normalized;
}

export async function runWebGpuSemanticAdapter({
  records,
  enableWebGpu,
  modelId,
  onProgress,
}: WebGpuAdapterRequest): Promise<WebGpuAdapterAttempt> {
  if (!enableWebGpu) {
    return { ok: false, reason: 'feature_disabled' };
  }

  const scope = getAdapterGlobalScope();
  if (!hasWebGpuSupport(scope)) {
    return { ok: false, reason: 'gpu_unavailable' };
  }

  const adapter = resolveInjectedAdapter(scope) ?? getDefaultWebLlmSemanticAdapter();

  try {
    const raw = await adapter({ records, modelId, onProgress });
    const rawContracts = toRawContracts(raw);
    const rawMessage = toRawMessage(raw);
    if (rawContracts.length === 0) {
      // Reaching this point means the WebGPU adapter path executed successfully,
      // but the model yielded no contract candidates.
      return {
        ok: true,
        contracts: [],
        rejectedContracts: 0,
      };
    }

    const sourceText = sourceTextById(records);
    const sourceIdLookupByName = sourceIdByName(records);
    const accepted: SemanticExtractionContract[] = [];
    let rejected = 0;
    let validationRejected = 0;
    let nonObjectRejected = 0;
    let nonCurrentRejected = 0;
    let firstCandidatePreview: string | null = null;

    for (const candidate of rawContracts) {
      if (!candidate || typeof candidate !== 'object') {
        rejected += 1;
        nonObjectRejected += 1;
        continue;
      }
      const rawContract = candidate as Record<string, unknown>;
      if (!firstCandidatePreview) {
        try {
          firstCandidatePreview = JSON.stringify(rawContract).slice(0, 260);
        } catch {
          firstCandidatePreview = null;
        }
      }
      const normalizedCandidate = normalizeRawCandidateForValidation({
        rawContract,
        sourceTextByIdMap: sourceText,
        sourceIdByNameMap: sourceIdLookupByName,
      });
      const sourceId = typeof normalizedCandidate.source_id === 'string' ? normalizedCandidate.source_id : '';
      const sourceRecordText = sourceText.get(sourceId) ?? '';
      const validated = validateSemanticContract(normalizedCandidate, sourceRecordText);
      if (!validated) {
        rejected += 1;
        validationRejected += 1;
        continue;
      }
      if (validated.temporal_status !== 'current') {
        rejected += 1;
        nonCurrentRejected += 1;
        continue;
      }
      accepted.push(validated);
    }

    if (accepted.length === 0) {
      console.info('[semantic-webgpu-adapter] no accepted contracts', {
        modelId,
        rawContracts: rawContracts.length,
        nonObjectRejected,
        validationRejected,
        nonCurrentRejected,
        rawMessage,
        firstCandidatePreview,
      });
      return {
        ok: true,
        contracts: [],
        rejectedContracts: rejected,
      };
    }

    return {
      ok: true,
      contracts: accepted,
      rejectedContracts: rejected,
    };
  } catch (error) {
    const isUnavailable = error instanceof WebLlmUnavailableError;
    const errorMessage = error instanceof Error ? error.message : String(error);
    const looksLikeGpuUnavailable = /compatible gpu|webgpu|requestadapter|adapter not found|no adapter/i.test(
      errorMessage.toLowerCase(),
    );
    return {
      ok: false,
      reason: isUnavailable
        ? 'adapter_unavailable'
        : looksLikeGpuUnavailable
          ? 'gpu_unavailable'
          : 'adapter_failed',
      message: errorMessage,
    };
  }
}
