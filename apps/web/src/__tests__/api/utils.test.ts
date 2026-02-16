import { describe, it, expect, vi } from 'vitest';
import { createMockRequest, createMockResponse } from './_helpers';

/**
 * Tests for pure utility functions in api/_utils.ts that don't
 * require Supabase env (getBearerToken, isEncryptedEnvelope,
 * ensureObject, getErrorMessage, json).
 *
 * For functions that need SUPABASE_URL/SERVICE_ROLE_KEY we mock
 * process.env to avoid the ensureSupabaseEnv guard.
 */

// Set env vars before importing _utils
vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');

import {
  getBearerToken,
  isEncryptedEnvelope,
  ensureObject,
  getErrorMessage,
  json,
  generatePairingCode,
  hashToken,
} from '../../../api/_utils';

describe('getBearerToken', () => {
  it('extracts token from valid Bearer header', () => {
    const req = createMockRequest({
      headers: { authorization: 'Bearer abc123' },
    });
    expect(getBearerToken(req)).toBe('abc123');
  });

  it('returns null for missing authorization header', () => {
    const req = createMockRequest({ headers: {} });
    expect(getBearerToken(req)).toBeNull();
  });

  it('returns null for non-Bearer scheme', () => {
    const req = createMockRequest({
      headers: { authorization: 'Basic abc123' },
    });
    expect(getBearerToken(req)).toBeNull();
  });

  it('returns null for Bearer with no token', () => {
    const req = createMockRequest({
      headers: { authorization: 'Bearer ' },
    });
    expect(getBearerToken(req)).toBeNull();
  });

  it('returns null for double-space before token (split yields empty segment)', () => {
    const req = createMockRequest({
      headers: { authorization: 'Bearer  tok123' },
    });
    // 'Bearer  tok123'.split(' ') => ['Bearer', '', 'tok123'] — token is ''
    expect(getBearerToken(req)).toBeNull();
  });
});

describe('isEncryptedEnvelope', () => {
  const valid = {
    encrypted: true,
    cipher: 'aes-256-gcm',
    salt: 'salt-value',
    iv: 'iv-value',
    tag: 'tag-value',
    ciphertext: 'data',
  };

  it('returns true for valid envelope', () => {
    expect(isEncryptedEnvelope(valid)).toBe(true);
  });

  it('returns false when encrypted is false', () => {
    expect(isEncryptedEnvelope({ ...valid, encrypted: false })).toBe(false);
  });

  it('returns false when cipher is wrong', () => {
    expect(isEncryptedEnvelope({ ...valid, cipher: 'aes-128-gcm' })).toBe(
      false,
    );
  });

  it('returns false when salt is missing', () => {
    const { salt: _, ...rest } = valid;
    expect(isEncryptedEnvelope(rest)).toBe(false);
  });

  it('returns false when iv is missing', () => {
    const { iv: _, ...rest } = valid;
    expect(isEncryptedEnvelope(rest)).toBe(false);
  });

  it('returns false when tag is missing', () => {
    const { tag: _, ...rest } = valid;
    expect(isEncryptedEnvelope(rest)).toBe(false);
  });

  it('returns false when ciphertext is missing', () => {
    const { ciphertext: _, ...rest } = valid;
    expect(isEncryptedEnvelope(rest)).toBe(false);
  });

  it('returns false for null', () => {
    expect(isEncryptedEnvelope(null)).toBe(false);
  });

  it('returns false for string', () => {
    expect(isEncryptedEnvelope('not an object')).toBe(false);
  });

  it('returns false for number', () => {
    expect(isEncryptedEnvelope(42)).toBe(false);
  });
});

describe('ensureObject', () => {
  it('returns the object for a valid object', () => {
    const obj = { key: 'value' };
    expect(ensureObject(obj)).toBe(obj);
  });

  it('returns null for null', () => {
    expect(ensureObject(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(ensureObject(undefined)).toBeNull();
  });

  it('returns null for string', () => {
    expect(ensureObject('string')).toBeNull();
  });

  it('returns null for number', () => {
    expect(ensureObject(123)).toBeNull();
  });

  it('returns null for array', () => {
    expect(ensureObject([1, 2, 3])).toBeNull();
  });

  it('returns empty object for empty object', () => {
    const obj = {};
    expect(ensureObject(obj)).toBe(obj);
  });
});

describe('getErrorMessage', () => {
  it('returns Error message for Error instances', () => {
    expect(getErrorMessage(new Error('oops'))).toBe('oops');
  });

  it('returns fallback for non-Error values', () => {
    expect(getErrorMessage('string error')).toBe('Server error');
    expect(getErrorMessage(42)).toBe('Server error');
    expect(getErrorMessage(null)).toBe('Server error');
  });

  it('uses custom fallback when provided', () => {
    expect(getErrorMessage(null, 'Custom error')).toBe('Custom error');
  });

  it('returns fallback for Error with empty message', () => {
    expect(getErrorMessage(new Error(''))).toBe('Server error');
  });
});

describe('json helper', () => {
  it('sets status code, content-type, and cache-control', () => {
    const res = createMockResponse();
    json(res as any, 200, { ok: true });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/json');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('serializes body as JSON', () => {
    const res = createMockResponse();
    json(res as any, 400, { error: 'Bad request' });
    expect(res.json()).toEqual({ error: 'Bad request' });
  });

  it('ends the response', () => {
    const res = createMockResponse();
    json(res as any, 200, { data: 'test' });
    expect(res.ended).toBe(true);
  });
});

describe('generatePairingCode', () => {
  it('returns a string matching PFY-XXXX-XXXX pattern', () => {
    const code = generatePairingCode();
    expect(code).toMatch(/^PFY-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  });

  it('generates unique codes', () => {
    const codes = new Set(Array.from({ length: 50 }, () => generatePairingCode()));
    // With 30^8 possible values, collisions in 50 samples are essentially impossible
    expect(codes.size).toBe(50);
  });
});

describe('hashToken', () => {
  it('returns a hex SHA-256 hash', () => {
    const hash = hashToken('my-secret-token');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'));
  });

  it('produces different hashes for different inputs', () => {
    expect(hashToken('token-a')).not.toBe(hashToken('token-b'));
  });
});
