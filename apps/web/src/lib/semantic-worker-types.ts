import type { GeneralExtractedFact, GeneralExtractionRecord } from './general-extractor';
import type { SemanticExtractionContract, SemanticExtractionStats } from './semantic-contracts';

export type SemanticWorkerMode = 'heuristic' | 'webgpu';

export type SemanticWorkerFallbackReason =
  | 'feature_disabled'
  | 'gpu_unavailable'
  | 'adapter_unavailable'
  | 'adapter_failed'
  | 'no_contracts';

export interface SemanticWorkerRuntime {
  mode: SemanticWorkerMode;
  usedWebGpu: boolean;
  modelId?: string;
  fallbackReason?: SemanticWorkerFallbackReason;
  fallbackMessage?: string;
}

export interface SemanticWorkerOptions {
  enableWebGpu: boolean;
  webGpuModel: string;
}

export type SemanticHydrationStatus =
  | 'not_downloaded'
  | 'downloading'
  | 'warming'
  | 'ready'
  | 'failed';

export interface SemanticWorkerProgressUpdate {
  modelId: string;
  status: SemanticHydrationStatus;
  progress: number;
  message?: string;
}

export interface SemanticWorkerRequest {
  records: GeneralExtractionRecord[];
  options?: Partial<SemanticWorkerOptions>;
}

export interface SemanticWorkerProgressResponse {
  ok: true;
  type: 'progress';
  progress: SemanticWorkerProgressUpdate;
}

export interface SemanticWorkerSuccessResponse {
  ok: true;
  type: 'result';
  facts: GeneralExtractedFact[];
  contracts: SemanticExtractionContract[];
  stats: SemanticExtractionStats;
  runtime: SemanticWorkerRuntime;
}

export interface SemanticWorkerErrorResponse {
  ok: false;
  error: string;
}

export type SemanticWorkerResponse =
  | SemanticWorkerProgressResponse
  | SemanticWorkerSuccessResponse
  | SemanticWorkerErrorResponse;
