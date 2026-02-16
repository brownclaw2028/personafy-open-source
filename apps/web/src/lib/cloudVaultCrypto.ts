import { isEncryptedEnvelope } from './vault-crypto-types';

export { isEncryptedEnvelope };

const PBKDF2_PARAMS = { iterations: 600000, hash: 'SHA-256', dkLen: 32 } as const;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export interface EncryptedVaultEnvelope {
  version: 1;
  encrypted: true;
  kdf: 'pbkdf2';
  kdfParams: { iterations: number; hash: string; dkLen: number };
  cipher: 'aes-256-gcm';
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
}

function utf8ToBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function bytesToUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, i + chunk);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  params: { iterations: number; hash: string } = PBKDF2_PARAMS,
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey('raw', toArrayBuffer(utf8ToBytes(passphrase)), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: toArrayBuffer(salt),
      iterations: params.iterations,
      hash: params.hash,
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptVaultPayload(payload: unknown, passphrase: string): Promise<EncryptedVaultEnvelope> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(passphrase, salt);
  const plaintext = utf8ToBytes(JSON.stringify(payload));
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(iv), tagLength: 128 },
      key,
      toArrayBuffer(plaintext),
    ),
  );
  const ciphertext = encrypted.slice(0, encrypted.length - TAG_BYTES);
  const tag = encrypted.slice(encrypted.length - TAG_BYTES);

  return {
    version: 1,
    encrypted: true,
    kdf: 'pbkdf2',
    kdfParams: { ...PBKDF2_PARAMS },
    cipher: 'aes-256-gcm',
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    tag: bytesToBase64(tag),
    ciphertext: bytesToBase64(ciphertext),
  };
}

export async function decryptVaultPayload(
  envelope: EncryptedVaultEnvelope,
  passphrase: string,
): Promise<unknown> {
  if (envelope.kdf && envelope.kdf !== 'pbkdf2') {
    throw new Error('Unsupported KDF for cloud vault.');
  }
  const params = envelope.kdfParams || PBKDF2_PARAMS;
  const ALLOWED_HASHES = ['SHA-256', 'SHA-384', 'SHA-512'];
  if (
    typeof params.iterations !== 'number' || params.iterations < 300_000 || params.iterations > 2_000_000 ||
    !ALLOWED_HASHES.includes(params.hash) ||
    params.dkLen !== 32
  ) {
    throw new Error('Rejected envelope: invalid PBKDF2 parameters.');
  }
  const salt = base64ToBytes(envelope.salt);
  const iv = base64ToBytes(envelope.iv);
  const tag = base64ToBytes(envelope.tag);
  const ciphertext = base64ToBytes(envelope.ciphertext);
  const combined = new Uint8Array(ciphertext.length + tag.length);
  combined.set(ciphertext, 0);
  combined.set(tag, ciphertext.length);
  const key = await deriveKey(passphrase, salt, {
    iterations: params.iterations,
    hash: params.hash,
  });
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv), tagLength: 128 },
    key,
    toArrayBuffer(combined),
  );
  return JSON.parse(bytesToUtf8(new Uint8Array(plaintext)));
}
