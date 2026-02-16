import type { AtomicSieveOptions, AtomicSieveResult } from './atomic-sieve';
import type { GeneralExtractionRecord } from './general-extractor';

export interface AtomicSieveWorkerRequest {
  records: GeneralExtractionRecord[];
  options?: Partial<AtomicSieveOptions>;
}

export type AtomicSieveWorkerResponse =
  | {
      ok: true;
      result: AtomicSieveResult;
    }
  | {
      ok: false;
      error: string;
    };
