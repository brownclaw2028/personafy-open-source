import { afterEach, describe, expect, it } from 'vitest';
import type { GeneralExtractionRecord } from '../general-extractor';
import type { SemanticWorkerProgressUpdate } from '../semantic-worker-types';
import { runWebGpuSemanticAdapter } from '../semantic-webgpu-adapter';
import { WebLlmUnavailableError } from '../semantic-webgpu-adapter.webllm';

interface TestGlobalScope {
  navigator?: { gpu?: unknown };
  __PERSONAFY_WEBGPU_SEMANTIC_ADAPTER__?: (input: {
    records: GeneralExtractionRecord[];
    modelId: string;
    onProgress?: (event: SemanticWorkerProgressUpdate) => void;
  }) => Promise<unknown[] | { contracts?: unknown[] }>;
}

function setGlobalScope(value: TestGlobalScope): void {
  Object.defineProperty(globalThis, 'navigator', {
    value: value.navigator,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(globalThis, '__PERSONAFY_WEBGPU_SEMANTIC_ADAPTER__', {
    value: value.__PERSONAFY_WEBGPU_SEMANTIC_ADAPTER__,
    writable: true,
    configurable: true,
  });
}

const RECORDS: GeneralExtractionRecord[] = [
  {
    sourceType: 'gmail',
    sourceId: 's1',
    sourceName: 'Sample Source',
    content: 'I always choose aisle seats for long flights.',
  },
];

afterEach(() => {
  setGlobalScope({ navigator: undefined, __PERSONAFY_WEBGPU_SEMANTIC_ADAPTER__: undefined });
});

describe('semantic worker contracts', () => {
  it('forwards adapter progress events to caller callback', async () => {
    const seenProgress: SemanticWorkerProgressUpdate[] = [];

    setGlobalScope({
      navigator: { gpu: {} },
      __PERSONAFY_WEBGPU_SEMANTIC_ADAPTER__: async ({ onProgress }) => {
        onProgress?.({
          modelId: 'test-model',
          status: 'downloading',
          progress: 0.4,
          message: 'Downloading model',
        });

        return [
          {
            domain: 'travel',
            canonical_key: 'flight.seat_preference',
            dynamic_key: null,
            value: 'aisle',
            temporal_status: 'current',
            is_negation: false,
            evidence_snippet: 'choose aisle seats',
            confidence: 0.81,
            sensitivity: 'low',
            source_id: 's1',
            source_name: 'Sample Source',
          },
        ];
      },
    });

    const result = await runWebGpuSemanticAdapter({
      records: RECORDS,
      enableWebGpu: true,
      modelId: 'test-model',
      onProgress: (event) => seenProgress.push(event),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.contracts).toHaveLength(1);
    }
    expect(seenProgress).toHaveLength(1);
    expect(seenProgress[0].status).toBe('downloading');
  });

  it('maps runtime unavailability errors to adapter_unavailable', async () => {
    setGlobalScope({
      navigator: { gpu: {} },
      __PERSONAFY_WEBGPU_SEMANTIC_ADAPTER__: async () => {
        throw new WebLlmUnavailableError('runtime unavailable');
      },
    });

    const result = await runWebGpuSemanticAdapter({
      records: RECORDS,
      enableWebGpu: true,
      modelId: 'test-model',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('adapter_unavailable');
      expect(result.message).toContain('runtime unavailable');
    }
  });

  it('maps compatible-GPU runtime failures to gpu_unavailable', async () => {
    setGlobalScope({
      navigator: { gpu: {} },
      __PERSONAFY_WEBGPU_SEMANTIC_ADAPTER__: async () => {
        throw new Error('Unable to find a compatible GPU for WebGPU initialization');
      },
    });

    const result = await runWebGpuSemanticAdapter({
      records: RECORDS,
      enableWebGpu: true,
      modelId: 'test-model',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('gpu_unavailable');
      expect(result.message).toContain('compatible GPU');
    }
  });

  it('normalizes adapter contracts to recover valid entries before validation', async () => {
    setGlobalScope({
      navigator: { gpu: {} },
      __PERSONAFY_WEBGPU_SEMANTIC_ADAPTER__: async () => ({
        contracts: [
          {
            domain: 'TRAVEL',
            canonical_key: 'flight.seat_preference',
            dynamic_key: null,
            value: '"aisle"',
            temporal_status: 'CURRENT',
            is_negation: 'false',
            evidence_snippet: '"not-in-source-snippet"',
            confidence: '0.92',
            sensitivity: 'LOW',
            source_id: 'unknown-source',
            source_name: 'Sample Source',
          },
        ],
      }),
    });

    const result = await runWebGpuSemanticAdapter({
      records: RECORDS,
      enableWebGpu: true,
      modelId: 'test-model',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.contracts).toHaveLength(1);
      expect(result.contracts[0].source_id).toBe('s1');
      expect(result.contracts[0].evidence_snippet).toBe('aisle');
      expect(result.contracts[0].temporal_status).toBe('current');
    }
  });
});
