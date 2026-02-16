/// <reference lib="webworker" />

import {
  runAtomicSieve,
} from '../lib/atomic-sieve';
import type {
  AtomicSieveWorkerRequest,
  AtomicSieveWorkerResponse,
} from '../lib/atomic-sieve-worker-types';

const ctx: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (event: MessageEvent<AtomicSieveWorkerRequest>) => {
  try {
    if (!Array.isArray(event.data?.records)) {
      const invalid: AtomicSieveWorkerResponse = {
        ok: false,
        error: 'Invalid input: records must be an array',
      };
      ctx.postMessage(invalid);
      return;
    }

    const result = runAtomicSieve(event.data.records, event.data.options ?? {});
    const response: AtomicSieveWorkerResponse = {
      ok: true,
      result,
    };
    ctx.postMessage(response);
  } catch (error) {
    const response: AtomicSieveWorkerResponse = {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
    ctx.postMessage(response);
  }
};
