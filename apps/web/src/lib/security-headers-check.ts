export interface SecurityHeadersCheckResult {
  checkedAt: number;
  coop: string | null;
  coep: string | null;
  crossOriginIsolated: boolean;
  sharedArrayBufferAvailable: boolean;
  headersCompliant: boolean;
  sabUsable: boolean;
  fastPathReady: boolean;
  issues: string[];
}

interface CheckOptions {
  url?: string;
  fetchImpl?: typeof fetch;
  crossOriginIsolated?: boolean;
  sharedArrayBufferAvailable?: boolean;
}

const REQUIRED_COOP = 'same-origin';
const REQUIRED_COEP = 'require-corp';

function normalizeHeader(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function readRuntimeCrossOriginIsolated(): boolean {
  if (typeof self === 'undefined') return false;
  return self.crossOriginIsolated === true;
}

function readRuntimeSharedArrayBufferAvailable(): boolean {
  if (typeof globalThis === 'undefined') return false;
  return typeof (globalThis as { SharedArrayBuffer?: unknown }).SharedArrayBuffer !== 'undefined';
}

function evaluateIssues(input: {
  coop: string | null;
  coep: string | null;
  crossOriginIsolated: boolean;
  sharedArrayBufferAvailable: boolean;
  headersVerified: boolean;
}): string[] {
  const issues: string[] = [];

  if (!input.headersVerified) {
    issues.push('could_not_verify_response_headers');
  }
  if (input.coop !== REQUIRED_COOP) {
    issues.push('missing_or_invalid_coop');
  }
  if (input.coep !== REQUIRED_COEP) {
    issues.push('missing_or_invalid_coep');
  }
  if (!input.crossOriginIsolated) {
    issues.push('context_not_cross_origin_isolated');
  }
  if (!input.sharedArrayBufferAvailable) {
    issues.push('shared_array_buffer_unavailable');
  }

  return issues;
}

async function fetchHeaders(
  fetchImpl: typeof fetch,
  url: string,
): Promise<{ coop: string | null; coep: string | null; headersVerified: boolean }> {
  try {
    const headResponse = await fetchImpl(url, {
      method: 'HEAD',
      cache: 'no-store',
      credentials: 'same-origin',
    });

    if (headResponse.ok) {
      return {
        coop: normalizeHeader(headResponse.headers.get('cross-origin-opener-policy')),
        coep: normalizeHeader(headResponse.headers.get('cross-origin-embedder-policy')),
        headersVerified: true,
      };
    }

    const getResponse = await fetchImpl(url, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: {
        range: 'bytes=0-0',
      },
    });

    if (getResponse.ok) {
      return {
        coop: normalizeHeader(getResponse.headers.get('cross-origin-opener-policy')),
        coep: normalizeHeader(getResponse.headers.get('cross-origin-embedder-policy')),
        headersVerified: true,
      };
    }

    return {
      coop: null,
      coep: null,
      headersVerified: false,
    };
  } catch {
    return {
      coop: null,
      coep: null,
      headersVerified: false,
    };
  }
}

export async function checkSecurityHeadersForSAB(
  options: CheckOptions = {},
): Promise<SecurityHeadersCheckResult> {
  const fetchImpl = options.fetchImpl ?? (typeof fetch === 'function' ? fetch : null);
  const url = options.url ?? (typeof window !== 'undefined' ? window.location.href : '');

  const crossOriginIsolated = options.crossOriginIsolated ?? readRuntimeCrossOriginIsolated();
  const sharedArrayBufferAvailable = options.sharedArrayBufferAvailable ?? readRuntimeSharedArrayBufferAvailable();

  const headers = fetchImpl && url
    ? await fetchHeaders(fetchImpl, url)
    : { coop: null, coep: null, headersVerified: false };

  const headersCompliant = headers.coop === REQUIRED_COOP && headers.coep === REQUIRED_COEP;
  const sabUsable = crossOriginIsolated && sharedArrayBufferAvailable;
  const fastPathReady = sabUsable && headersCompliant;

  return {
    checkedAt: Date.now(),
    coop: headers.coop,
    coep: headers.coep,
    crossOriginIsolated,
    sharedArrayBufferAvailable,
    headersCompliant,
    sabUsable,
    fastPathReady,
    issues: evaluateIssues({
      coop: headers.coop,
      coep: headers.coep,
      crossOriginIsolated,
      sharedArrayBufferAvailable,
      headersVerified: headers.headersVerified,
    }),
  };
}

export function summarizeSecurityHeadersIssues(result: SecurityHeadersCheckResult): string {
  if (result.fastPathReady) {
    return 'WebGPU fast path ready.';
  }

  const readable = result.issues.map((issue) => {
    switch (issue) {
      case 'missing_or_invalid_coop':
        return 'COOP must be set to same-origin';
      case 'missing_or_invalid_coep':
        return 'COEP must be set to require-corp';
      case 'context_not_cross_origin_isolated':
        return 'Page is not cross-origin isolated';
      case 'shared_array_buffer_unavailable':
        return 'SharedArrayBuffer is unavailable';
      case 'could_not_verify_response_headers':
        return 'Could not verify response headers';
      default:
        return issue;
    }
  });

  return readable.join('; ');
}
