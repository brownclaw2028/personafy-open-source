import { afterEach, describe, expect, it } from 'vitest';
import type { GeneralExtractionRecord } from '../general-extractor';
import { runWebGpuSemanticAdapter } from '../semantic-webgpu-adapter';

interface TestGlobalScope {
  navigator?: { gpu?: unknown };
  __PERSONAFY_WEBGPU_SEMANTIC_ADAPTER__?: (input: {
    records: GeneralExtractionRecord[];
    modelId: string;
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

const BASE_RECORDS: GeneralExtractionRecord[] = [
  {
    sourceType: 'gmail',
    sourceId: 'r1',
    sourceName: 'Record 1',
    content: 'I always prefer a window seat on flights.',
  },
];

afterEach(() => {
  setGlobalScope({ navigator: undefined, __PERSONAFY_WEBGPU_SEMANTIC_ADAPTER__: undefined });
});

describe('semantic webgpu adapter', () => {
  it('returns feature_disabled when flag is not enabled', async () => {
    const result = await runWebGpuSemanticAdapter({
      records: BASE_RECORDS,
      enableWebGpu: false,
      modelId: 'model',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('feature_disabled');
    }
  });

  it('falls back safely when gpu exists but adapter hook is missing', async () => {
    setGlobalScope({ navigator: { gpu: {} }, __PERSONAFY_WEBGPU_SEMANTIC_ADAPTER__: undefined });
    const result = await runWebGpuSemanticAdapter({
      records: BASE_RECORDS,
      enableWebGpu: true,
      modelId: 'model',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(['adapter_unavailable', 'adapter_failed', 'gpu_unavailable']).toContain(result.reason);
    }
  });

  it('validates and accepts contracts returned by injected adapter hook', async () => {
    setGlobalScope({
      navigator: { gpu: {} },
      __PERSONAFY_WEBGPU_SEMANTIC_ADAPTER__: async () => ([
        {
          domain: 'travel',
          canonical_key: 'flight.seat_preference',
          dynamic_key: null,
          value: 'window seat',
          temporal_status: 'current',
          is_negation: false,
          evidence_snippet: 'I always prefer a window seat',
          confidence: 0.83,
          sensitivity: 'low',
          source_id: 'r1',
          source_name: 'Record 1',
        },
      ]),
    });

    const result = await runWebGpuSemanticAdapter({
      records: BASE_RECORDS,
      enableWebGpu: true,
      modelId: 'model',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.contracts).toHaveLength(1);
      expect(result.contracts[0].canonical_key).toBe('flight.seat_preference');
    }
  });
});
