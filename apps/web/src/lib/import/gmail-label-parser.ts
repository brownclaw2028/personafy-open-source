function normalizeCharset(charset: string): string {
  const lower = charset.trim().toLowerCase();
  if (lower.includes('utf-8') || lower.includes('utf8')) return 'utf-8';
  if (lower.includes('iso-8859-1') || lower.includes('latin1')) return 'iso-8859-1';
  if (lower.includes('us-ascii') || lower.includes('ascii')) return 'utf-8';
  return 'utf-8';
}

function decodeBytes(bytes: Uint8Array, charset: string): string | null {
  const normalized = normalizeCharset(charset);
  try {
    return new TextDecoder(normalized, { fatal: false }).decode(bytes);
  } catch {
    try {
      return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    } catch {
      return null;
    }
  }
}

function decodeBase64ToBytes(encoded: string): Uint8Array | null {
  try {
    const binary = globalThis.atob(encoded.replace(/\s+/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

function decodeQToBytes(encoded: string): Uint8Array {
  const input = encoded.replace(/_/g, ' ');
  const bytes: number[] = [];

  for (let i = 0; i < input.length; i += 1) {
    const current = input[i];
    const nextTwo = input.slice(i + 1, i + 3);
    if (current === '=' && /^[0-9A-Fa-f]{2}$/.test(nextTwo)) {
      bytes.push(Number.parseInt(nextTwo, 16));
      i += 2;
      continue;
    }
    bytes.push(input.charCodeAt(i));
  }

  return new Uint8Array(bytes);
}

function decodeEncodedWord(
  charset: string,
  encoding: string,
  payload: string,
): string | null {
  const mode = encoding.toUpperCase();
  if (mode === 'B') {
    const bytes = decodeBase64ToBytes(payload);
    if (!bytes) return null;
    return decodeBytes(bytes, charset);
  }

  if (mode === 'Q') {
    const bytes = decodeQToBytes(payload);
    return decodeBytes(bytes, charset);
  }

  return null;
}

export function decodeMimeHeaderValue(input: string): string {
  if (!input.includes('=?')) return input;

  return input.replace(
    /=\?([^?]+)\?([bBqQ])\?([^?]+)\?=/g,
    (segment, charset: string, encoding: string, payload: string) => {
      const decoded = decodeEncodedWord(charset, encoding, payload);
      return decoded ?? segment;
    },
  );
}

export function parseGmailLabelsHeader(
  rawHeader: string | null | undefined,
): string[] {
  if (!rawHeader) return [];

  const labels: string[] = [];
  for (const token of rawHeader.split(',')) {
    const trimmed = token.trim();
    if (!trimmed) continue;
    const unquoted = trimmed.replace(/^"(.*)"$/, '$1');
    const decoded = decodeMimeHeaderValue(unquoted).trim();
    if (!decoded) continue;
    labels.push(decoded);
  }

  return [...new Set(labels)];
}
