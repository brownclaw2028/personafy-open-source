/// <reference lib="webworker" />

import type { SourceType } from '../lib/source-types';
import { PackageParseError, parseImportPayload, type PackageParseErrorCode, type ParsedImportPackage } from '../lib/import/package-parser';

type WorkerRequest = {
  fileName: string;
  bytes: ArrayBuffer;
  selectedSource?: SourceType;
};

type WorkerResponse =
  | {
      ok: true;
      parsed: ParsedImportPackage;
    }
  | {
      ok: false;
      code?: PackageParseErrorCode;
      error: string;
    };

const ctx: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (event: MessageEvent<WorkerRequest>) => {
  try {
    const { fileName, bytes, selectedSource } = event.data;
    if (!fileName || !(bytes instanceof ArrayBuffer)) {
      const invalidResponse: WorkerResponse = {
        ok: false,
        error: 'Invalid import package worker input',
      };
      ctx.postMessage(invalidResponse);
      return;
    }

    const parsed = parseImportPayload(
      fileName,
      new Uint8Array(bytes),
      selectedSource ? { selectedSource } : {},
    );

    const successResponse: WorkerResponse = {
      ok: true,
      parsed,
    };
    ctx.postMessage(successResponse);
  } catch (error) {
    if (error instanceof PackageParseError) {
      const parseErrorResponse: WorkerResponse = {
        ok: false,
        code: error.code,
        error: error.message,
      };
      ctx.postMessage(parseErrorResponse);
      return;
    }

    const genericErrorResponse: WorkerResponse = {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
    ctx.postMessage(genericErrorResponse);
  }
};
