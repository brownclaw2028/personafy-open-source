// ============================================================================
// Shared vault encryption types — used by cloudVaultCrypto, api/_utils, and
// the desktop vault-server to avoid duplicating the envelope type guard.
// ============================================================================

/**
 * Minimal encrypted vault envelope fields shared across KDF variants
 * (PBKDF2 for cloud, scrypt for desktop).
 */
interface EncryptedEnvelopeBase {
  encrypted: true;
  cipher: 'aes-256-gcm';
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
}

/**
 * Type guard that detects whether an unknown value is an encrypted vault
 * envelope, regardless of which KDF was used (pbkdf2 or scrypt).
 */
export function isEncryptedEnvelope(value: unknown): value is EncryptedEnvelopeBase {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return (
    obj.encrypted === true &&
    obj.cipher === 'aes-256-gcm' &&
    typeof obj.salt === 'string' &&
    typeof obj.iv === 'string' &&
    typeof obj.tag === 'string' &&
    typeof obj.ciphertext === 'string'
  );
}
