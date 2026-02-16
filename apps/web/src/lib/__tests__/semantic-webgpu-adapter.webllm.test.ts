import { describe, expect, it } from 'vitest';
import type { GeneralExtractionRecord } from '../general-extractor';
import {
  createWebLlmSemanticAdapter,
  WebLlmUnavailableError,
  type WebLlmAdapterProgressEvent,
} from '../semantic-webgpu-adapter.webllm';

const RECORDS: GeneralExtractionRecord[] = [
  {
    sourceType: 'gmail',
    sourceId: 'gmail-1',
    sourceName: 'Gmail: Travel',
    content: 'I prefer aisle seats for flights and avoid red-eye departures.',
  },
];

function outputContracts(output: unknown[] | { contracts?: unknown[] }): unknown[] {
  if (Array.isArray(output)) return output;
  if (output && typeof output === 'object' && Array.isArray(output.contracts)) return output.contracts;
  return [];
}

describe('semantic webllm adapter', () => {
  it('parses JSON output and emits progress events', async () => {
    const progressEvents: WebLlmAdapterProgressEvent[] = [];

    const adapter = createWebLlmSemanticAdapter({
      createEngine: async (_modelId, config) => {
        config.initProgressCallback?.({ progress: 0.35, text: 'Downloading model assets' });
        return {
          chat: {
            completions: {
              create: async () => ({
                choices: [
                  {
                    message: {
                      content: `\`\`\`json
[
  {
    "domain": "travel",
    "canonical_key": "flight.seat_preference",
    "dynamic_key": null,
    "value": "aisle",
    "temporal_status": "current",
    "is_negation": false,
    "evidence_snippet": "prefer aisle seats",
    "confidence": 0.9,
    "sensitivity": "low",
    "source_id": "gmail-1",
    "source_name": "Gmail: Travel"
  }
]
\`\`\``,
                    },
                  },
                ],
              }),
            },
          },
        };
      },
    });

    const output = await adapter({
      records: RECORDS,
      modelId: 'Llama-3.2-1B-Instruct-q4f16_1',
      onProgress: (event) => progressEvents.push(event),
    });

    expect(Array.isArray(output)).toBe(true);
    const contracts = output as unknown[];
    expect(contracts).toHaveLength(1);
    expect(progressEvents.some((event) => event.status === 'downloading')).toBe(true);
    expect(progressEvents.at(-1)?.status).toBe('ready');
    expect(progressEvents.at(-1)?.progress).toBe(1);
  });

  it('reuses cached model engine for the same model id', async () => {
    let createCount = 0;
    const adapter = createWebLlmSemanticAdapter({
      createEngine: async () => {
        createCount += 1;
        return {
          chat: {
            completions: {
              create: async () => ({
                choices: [{ message: { content: '[]' } }],
              }),
            },
          },
        };
      },
    });

    await adapter({ records: RECORDS, modelId: 'shared-model' });
    await adapter({ records: RECORDS, modelId: 'shared-model' });

    expect(createCount).toBe(1);
  });

  it('surfaces unavailable runtime failures from engine creation', async () => {
    const adapter = createWebLlmSemanticAdapter({
      createEngine: async () => {
        throw new WebLlmUnavailableError('WebLLM package not installed');
      },
    });

    await expect(adapter({
      records: RECORDS,
      modelId: 'Llama-3.2-1B-Instruct-q4f16_1',
    })).rejects.toBeInstanceOf(WebLlmUnavailableError);
  });

  it('extracts contracts from object-wrapped payloads', async () => {
    const adapter = createWebLlmSemanticAdapter({
      createEngine: async () => ({
        chat: {
          completions: {
            create: async () => ({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      facts: [
                        {
                          domain: 'travel',
                          canonical_key: 'flight.seat_preference',
                          dynamic_key: null,
                          value: 'aisle',
                          temporal_status: 'current',
                          is_negation: false,
                          evidence_snippet: 'aisle seats',
                          confidence: 0.9,
                          sensitivity: 'low',
                          source_id: 'gmail-1',
                          source_name: 'Gmail: Travel',
                        },
                      ],
                    }),
                  },
                },
              ],
            }),
          },
        },
      }),
    });

    const output = await adapter({ records: RECORDS, modelId: 'object-wrapper-model' });
    expect(Array.isArray(output)).toBe(true);
    expect((output as unknown[])).toHaveLength(1);
  });

  it('splits larger payloads into multiple completion batches', async () => {
    let completionCalls = 0;
    const adapter = createWebLlmSemanticAdapter({
      createEngine: async () => ({
        chat: {
          completions: {
            create: async () => {
              completionCalls += 1;
              return {
                choices: [{ message: { content: '[]' } }],
              };
            },
          },
        },
      }),
    });

    const manyRecords: GeneralExtractionRecord[] = Array.from({ length: 16 }, (_, index) => ({
      sourceType: 'gmail',
      sourceId: `r-${index + 1}`,
      sourceName: `Source ${index + 1}`,
      content: 'x'.repeat(2_000),
    }));

    const output = await adapter({ records: manyRecords, modelId: 'batch-model' });
    expect(Array.isArray(outputContracts(output))).toBe(true);
    expect(completionCalls).toBeGreaterThan(1);
  });

  it('retries with smaller prompts when context window overflow occurs', async () => {
    const promptLengths: number[] = [];
    let callNumber = 0;
    const adapter = createWebLlmSemanticAdapter({
      createEngine: async () => ({
        chat: {
          completions: {
            create: async (request) => {
              callNumber += 1;
              promptLengths.push(request.messages[1]?.content.length ?? 0);
              if (callNumber === 1) {
                throw new Error('Prompt tokens exceed context window size');
              }
              return {
                choices: [{ message: { content: '[]' } }],
              };
            },
          },
        },
      }),
    });

    const output = await adapter({
      records: [
        {
          sourceType: 'gmail',
          sourceId: 'overflow-source',
          sourceName: 'Overflow Source',
          content: 'context '.repeat(2_000),
        },
      ],
      modelId: 'retry-model',
    });

    expect(Array.isArray(outputContracts(output))).toBe(true);
    expect(promptLengths.length).toBeGreaterThanOrEqual(2);
    expect(promptLengths[1]).toBeLessThan(promptLengths[0]);
  });

  it('runs a recovery completion when primary pass returns no parseable contracts', async () => {
    let callNumber = 0;
    const adapter = createWebLlmSemanticAdapter({
      createEngine: async () => ({
        chat: {
          completions: {
            create: async () => {
              callNumber += 1;
              if (callNumber === 1) {
                return { choices: [{ message: { content: 'No facts found.' } }] };
              }
              return {
                choices: [
                  {
                    message: {
                      content: JSON.stringify([
                        {
                          domain: 'travel',
                          canonical_key: 'flight.seat_preference',
                          dynamic_key: null,
                          value: 'aisle',
                          temporal_status: 'current',
                          is_negation: false,
                          evidence_snippet: 'prefer aisle seats',
                          confidence: 0.9,
                          sensitivity: 'low',
                          source_id: 'gmail-1',
                          source_name: 'Gmail: Travel',
                        },
                      ]),
                    },
                  },
                ],
              };
            },
          },
        },
      }),
    });

    const output = await adapter({ records: RECORDS, modelId: 'recovery-model' });
    expect(Array.isArray(output)).toBe(true);
    expect((output as unknown[])).toHaveLength(1);
    expect(callNumber).toBe(2);
  });
});
