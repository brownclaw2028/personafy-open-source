/// <reference lib="webworker" />

import { extractSemanticFacts } from '../lib/semantic-extractor';
import type {
  SemanticWorkerProgressResponse,
  SemanticWorkerRequest,
  SemanticWorkerResponse,
  SemanticWorkerSuccessResponse,
} from '../lib/semantic-worker-types';
import { runWebGpuSemanticAdapter } from '../lib/semantic-webgpu-adapter';
import { applySemanticJsonGuardrails } from '../lib/semantic-json-guardrails';

const ctx: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

const DEFAULT_WEBGPU_MODEL = 'Llama-3.2-3B-Instruct-q4f16_1';

ctx.onmessage = async (event: MessageEvent<SemanticWorkerRequest>) => {
  try {
    if (!Array.isArray(event.data?.records)) {
      const invalidResponse: SemanticWorkerResponse = {
        ok: false,
        error: 'Invalid input: records must be an array',
      };
      ctx.postMessage(invalidResponse);
      return;
    }

    const records = event.data.records;
    const options = event.data.options ?? {};
    const webGpuModel = options.webGpuModel ?? DEFAULT_WEBGPU_MODEL;
    const enableWebGpu = options.enableWebGpu === true;

    const webGpuAttempt = await runWebGpuSemanticAdapter({
      records,
      enableWebGpu,
      modelId: webGpuModel,
      onProgress: (progress) => {
        const progressResponse: SemanticWorkerProgressResponse = {
          ok: true,
          type: 'progress',
          progress,
        };
        ctx.postMessage(progressResponse);
      },
    });

    let successResponse: SemanticWorkerSuccessResponse;

    if (webGpuAttempt.ok) {
      const guardrails = applySemanticJsonGuardrails({
        records,
        contracts: webGpuAttempt.contracts,
      });
      successResponse = {
        ok: true,
        type: 'result',
        facts: guardrails.facts,
        contracts: guardrails.contracts,
        stats: {
          recordsProcessed: records.length,
          segmentsProcessed: 0,
          candidateSegments: 0,
          candidateWindows: 0,
          contractsAccepted: guardrails.contracts.length,
          contractsRejected: webGpuAttempt.rejectedContracts + guardrails.rejectedContracts,
        },
        runtime: {
          mode: 'webgpu',
          usedWebGpu: true,
          modelId: webGpuModel,
        },
      };
    } else {
      const fallbackResult = extractSemanticFacts(records);
      const guardrails = applySemanticJsonGuardrails({
        records,
        contracts: fallbackResult.contracts,
      });
      successResponse = {
        ok: true,
        type: 'result',
        facts: guardrails.facts,
        contracts: guardrails.contracts,
        stats: {
          ...fallbackResult.stats,
          contractsAccepted: guardrails.contracts.length,
          contractsRejected: fallbackResult.stats.contractsRejected + guardrails.rejectedContracts,
        },
        runtime: {
          mode: 'heuristic',
          usedWebGpu: false,
          modelId: webGpuModel,
          fallbackReason: webGpuAttempt.reason,
          fallbackMessage: webGpuAttempt.message,
        },
      };
    }

    ctx.postMessage(successResponse);
  } catch (error) {
    const failureResponse: SemanticWorkerResponse = {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
    ctx.postMessage(failureResponse);
  }
};
