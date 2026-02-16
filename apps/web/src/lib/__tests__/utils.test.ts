import { describe, it, expect } from 'vitest';
import { timeAgo, eventType, createRuleCreatedAuditEvent, groupFactsByCategory, computeCompletionScore, validateVaultImport, deriveHighlights, sortFacts, detectDuplicateFacts } from '../utils';
import type { VaultFact, VaultAuditEvent, VaultPersona } from '../vault';

// ─── timeAgo ───────────────────────────────────────────────────────────────

describe('timeAgo', () => {
  const BASE = new Date('2026-02-03T12:00:00Z').getTime();

  it('returns "Just now" for timestamps < 1 minute ago', () => {
    const ts = new Date(BASE - 30_000).toISOString(); // 30s ago
    expect(timeAgo(ts, BASE)).toBe('Just now');
  });

  it('returns "Just now" for timestamps exactly at now', () => {
    const ts = new Date(BASE).toISOString();
    expect(timeAgo(ts, BASE)).toBe('Just now');
  });

  it('returns "1m ago" at 60 seconds', () => {
    const ts = new Date(BASE - 60_000).toISOString();
    expect(timeAgo(ts, BASE)).toBe('1m ago');
  });

  it('returns "59m ago" at 59 minutes', () => {
    const ts = new Date(BASE - 59 * 60_000).toISOString();
    expect(timeAgo(ts, BASE)).toBe('59m ago');
  });

  it('returns "1h ago" at 60 minutes', () => {
    const ts = new Date(BASE - 60 * 60_000).toISOString();
    expect(timeAgo(ts, BASE)).toBe('1h ago');
  });

  it('returns "23h ago" at 23 hours', () => {
    const ts = new Date(BASE - 23 * 3600_000).toISOString();
    expect(timeAgo(ts, BASE)).toBe('23h ago');
  });

  it('returns "1d ago" at 24 hours', () => {
    const ts = new Date(BASE - 24 * 3600_000).toISOString();
    expect(timeAgo(ts, BASE)).toBe('1d ago');
  });

  it('returns "7d ago" at 1 week', () => {
    const ts = new Date(BASE - 7 * 24 * 3600_000).toISOString();
    expect(timeAgo(ts, BASE)).toBe('7d ago');
  });

  it('returns "365d ago" at 1 year', () => {
    const ts = new Date(BASE - 365 * 24 * 3600_000).toISOString();
    expect(timeAgo(ts, BASE)).toBe('365d ago');
  });

  it('returns "Unknown" for invalid timestamps', () => {
    expect(timeAgo('not-a-date', BASE)).toBe('Unknown');
    expect(timeAgo('', BASE)).toBe('Unknown');
  });

  it('returns "Just now" for future timestamps', () => {
    const ts = new Date(BASE + 60_000).toISOString(); // 1 min in future
    expect(timeAgo(ts, BASE)).toBe('Just now');
  });

  it('uses Date.now() when no now param provided', () => {
    // Just verify it returns a string without throwing
    const ts = new Date().toISOString();
    const result = timeAgo(ts);
    expect(typeof result).toBe('string');
    expect(result).toBe('Just now');
  });
});

// ─── eventType ─────────────────────────────────────────────────────────────

describe('eventType', () => {
  const base: VaultAuditEvent = {
    id: 'aud_1',
    timestamp: '2026-02-03T12:00:00Z',
    requestId: 'req_1',
    decision: 'allow',
    recipientDomain: 'example.com',
    purpose: 'shopping/find_item',
    fieldsReleased: ['apparel.pants.waist_in'],
  };

  it('classifies "allow" as auto_allowed', () => {
    expect(eventType({ ...base, decision: 'allow' })).toBe('auto_allowed');
  });

  it('classifies "ask_approved" as approved', () => {
    expect(eventType({ ...base, decision: 'ask_approved' })).toBe('approved');
  });

  it('classifies "ask_denied" as denied', () => {
    expect(eventType({ ...base, decision: 'ask_denied' })).toBe('denied');
  });

  it('classifies "deny" as denied', () => {
    expect(eventType({ ...base, decision: 'deny' })).toBe('denied');
  });
});

// ─── createRuleCreatedAuditEvent ──────────────────────────────────────────

describe('createRuleCreatedAuditEvent', () => {
  it('creates a config audit event with rule_created purpose prefix', () => {
    const e = createRuleCreatedAuditEvent({
      id: 'aud_test',
      timestamp: '2026-02-03T12:00:00Z',
      requestId: 'rule_123',
      recipientDomain: 'nordstrom.com',
      purposeCategory: 'shopping',
      purposeAction: 'find_item',
      allowedFields: ['apparel.pants.*', 'budget.*'],
    });

    expect(e).toEqual({
      id: 'aud_test',
      timestamp: '2026-02-03T12:00:00Z',
      requestId: 'rule_123',
      decision: 'allow',
      recipientDomain: 'nordstrom.com',
      purpose: 'rule_created/shopping/find_item',
      fieldsReleased: ['apparel.pants.*', 'budget.*'],
    });
  });
});

// ─── groupFactsByCategory ──────────────────────────────────────────────────

describe('groupFactsByCategory', () => {
  const makeFact = (key: string, value = 'v'): VaultFact => ({
    key,
    value,
    sensitivity: 'low',
    confidence: 0.9,
  });

  it('groups dotted keys by first segment', () => {
    const facts = [
      makeFact('apparel.pants.waist'),
      makeFact('apparel.shirts.size'),
      makeFact('travel.frequency'),
    ];
    const grouped = groupFactsByCategory(facts);
    expect(Object.keys(grouped).sort()).toEqual(['apparel', 'travel']);
    expect(grouped['apparel']).toHaveLength(2);
    expect(grouped['travel']).toHaveLength(1);
  });

  it('puts undotted keys into "general"', () => {
    const facts = [makeFact('nickname'), makeFact('height')];
    const grouped = groupFactsByCategory(facts);
    expect(Object.keys(grouped)).toEqual(['general']);
    expect(grouped['general']).toHaveLength(2);
  });

  it('normalizes legacy underscore keys into canonical groups', () => {
    const facts = [makeFact('shoe_size'), makeFact('waist_size')];
    const grouped = groupFactsByCategory(facts);
    expect(Object.keys(grouped)).toEqual(['apparel']);
    expect(grouped['apparel']).toHaveLength(2);
  });

  it('handles mixed dotted and undotted keys', () => {
    const facts = [
      makeFact('budget.monthly'),
      makeFact('nickname'),
      makeFact('budget.annual'),
    ];
    const grouped = groupFactsByCategory(facts);
    expect(Object.keys(grouped).sort()).toEqual(['budget', 'general']);
    expect(grouped['budget']).toHaveLength(2);
    expect(grouped['general']).toHaveLength(1);
  });

  it('returns empty object for empty facts array', () => {
    expect(groupFactsByCategory([])).toEqual({});
  });

  it('preserves fact order within each group', () => {
    const facts = [
      makeFact('a.first', '1'),
      makeFact('a.second', '2'),
      makeFact('a.third', '3'),
    ];
    const grouped = groupFactsByCategory(facts);
    expect(grouped['a']?.map((f) => f.value)).toEqual(['1', '2', '3']);
  });

  it('handles deeply dotted keys — uses only first segment', () => {
    const facts = [makeFact('a.b.c.d.e')];
    const grouped = groupFactsByCategory(facts);
    expect(Object.keys(grouped)).toEqual(['a']);
  });

  it('handles key that starts with a dot', () => {
    const facts = [makeFact('.weird_key')];
    const grouped = groupFactsByCategory(facts);
    // split('.') on ".weird_key" → ["", "weird_key"], parts.length > 1, category = ""
    expect(grouped['']).toHaveLength(1);
  });
});

// ─── computeCompletionScore ────────────────────────────────────────────────

describe('computeCompletionScore', () => {
  const makeFactWithConf = (confidence: number): VaultFact => ({
    key: 'test', value: 'val', sensitivity: 'low', confidence,
  });

  it('returns 0 for empty facts', () => {
    expect(computeCompletionScore('Shopping', [])).toBe(0);
  });

  it('returns 0 for any category with no facts', () => {
    expect(computeCompletionScore('Travel', [])).toBe(0);
    expect(computeCompletionScore('Unknown Category', [])).toBe(0);
  });

  it('returns > 0 for a single fact', () => {
    const score = computeCompletionScore('Shopping', [makeFactWithConf(0.8)]);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('increases as more facts are added', () => {
    const one = computeCompletionScore('Shopping', [makeFactWithConf(0.8)]);
    const four = computeCompletionScore('Shopping', Array(4).fill(null).map(() => makeFactWithConf(0.8)));
    const eight = computeCompletionScore('Shopping', Array(8).fill(null).map(() => makeFactWithConf(0.8)));
    expect(four).toBeGreaterThan(one);
    expect(eight).toBeGreaterThan(four);
  });

  it('caps at 1.0 even with excess facts', () => {
    const facts = Array(20).fill(null).map(() => makeFactWithConf(1.0));
    expect(computeCompletionScore('Shopping', facts)).toBe(1);
  });

  it('higher confidence yields higher score at same fact count', () => {
    const lowConf = computeCompletionScore('Travel', Array(3).fill(null).map(() => makeFactWithConf(0.3)));
    const highConf = computeCompletionScore('Travel', Array(3).fill(null).map(() => makeFactWithConf(0.9)));
    expect(highConf).toBeGreaterThan(lowConf);
  });

  it('uses default expected count for unknown categories', () => {
    const score = computeCompletionScore('Astrology', Array(5).fill(null).map(() => makeFactWithConf(1.0)));
    // Default expected = 5, 5/5 coverage = 1.0, confidence avg = 1.0
    // 1.0 * 0.7 + 1.0 * 0.3 = 1.0
    expect(score).toBe(1);
  });

  it('known categories have specific thresholds', () => {
    // Shopping expects 8 facts — 4 facts should be ~half coverage
    const score = computeCompletionScore('Shopping', Array(4).fill(null).map(() => makeFactWithConf(0.8)));
    expect(score).toBeGreaterThan(0.3);
    expect(score).toBeLessThan(0.8);
  });

  it('handles zero confidence gracefully', () => {
    const score = computeCompletionScore('Work', [makeFactWithConf(0)]);
    // coverage = 1/3 * 0.7 = 0.233, confidence = 0
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(0.5);
  });

  it('confidence above 1.0 still caps at 1', () => {
    const facts = Array(10).fill(null).map(() => makeFactWithConf(1.5));
    const score = computeCompletionScore('Work', facts);
    expect(score).toBeLessThanOrEqual(1);
  });
});

// ─── validateVaultImport ───────────────────────────────────────────────────

describe('validateVaultImport', () => {
  const validVault = {
    version: 1,
    createdAt: '2026-01-01T00:00:00Z',
    privacyPosture: 'alarm_system',
    settings: {},
    personas: [
      { id: 'p1', name: 'Shopping', category: 'Shopping', icon: 'ShoppingBag', description: '', completionScore: 0.5, facts: [] },
    ],
    rules: [],
    auditLog: [],
  };

  it('accepts a valid vault object', () => {
    const result = validateVaultImport(validVault);
    expect(result.ok).toBe(true);
  });

  it('returns the data on success', () => {
    const result = validateVaultImport(validVault);
    if (result.ok) expect(result.data).toBe(validVault);
  });

  it('accepts settings with valid shape', () => {
    const result = validateVaultImport({
      ...validVault,
      settings: { contextTtlMinutes: 30, hideHighSensitivity: true, approvalNotifications: false },
    });
    expect(result.ok).toBe(true);
  });

  it('rejects non-object settings', () => {
    const result = validateVaultImport({ ...validVault, settings: 'nope' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('settings must be an object');
  });

  it('rejects non-numeric contextTtlMinutes', () => {
    const result = validateVaultImport({ ...validVault, settings: { contextTtlMinutes: '10' } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('settings.contextTtlMinutes must be a number');
  });

  it('rejects negative contextTtlMinutes', () => {
    const result = validateVaultImport({ ...validVault, settings: { contextTtlMinutes: -1 } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('settings.contextTtlMinutes must be >= 0');
  });

  it('rejects invalid boolean settings', () => {
    const result = validateVaultImport({
      ...validVault,
      settings: { hideHighSensitivity: 'true', approvalNotifications: 1 },
    });
    expect(result.ok).toBe(false);
  });

  it('rejects null', () => {
    const result = validateVaultImport(null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('Invalid vault format');
  });

  it('rejects undefined', () => {
    const result = validateVaultImport(undefined);
    expect(result.ok).toBe(false);
  });

  it('rejects a string', () => {
    const result = validateVaultImport('not a vault');
    expect(result.ok).toBe(false);
  });

  it('rejects a number', () => {
    const result = validateVaultImport(42);
    expect(result.ok).toBe(false);
  });

  it('rejects missing personas', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { personas: _p, ...rest } = validVault;
    const result = validateVaultImport(rest);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('Missing personas array');
  });

  it('rejects non-array personas', () => {
    const result = validateVaultImport({ ...validVault, personas: 'not array' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('Missing personas array');
  });

  it('rejects missing rules', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { rules: _r, ...rest } = validVault;
    const result = validateVaultImport(rest);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('Missing rules array');
  });

  it('rejects missing auditLog', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { auditLog: _a, ...rest } = validVault;
    const result = validateVaultImport(rest);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('Missing auditLog array');
  });

  it('rejects missing privacyPosture', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { privacyPosture: _pp, ...rest } = validVault;
    const result = validateVaultImport(rest);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('Missing privacyPosture');
  });

  it('rejects non-string privacyPosture', () => {
    const result = validateVaultImport({ ...validVault, privacyPosture: 123 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('Missing privacyPosture');
  });

  it('rejects unknown posture values', () => {
    const result = validateVaultImport({ ...validVault, privacyPosture: 'lockdown' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('Unknown posture: lockdown');
  });

  it('accepts all three valid postures', () => {
    for (const posture of ['simple_lock', 'alarm_system', 'safe_room']) {
      const result = validateVaultImport({ ...validVault, privacyPosture: posture });
      expect(result.ok).toBe(true);
    }
  });

  it('rejects persona without id', () => {
    const result = validateVaultImport({
      ...validVault,
      personas: [{ name: 'Test', category: 'Shopping', icon: 'ShoppingBag', description: '', completionScore: 0, facts: [] }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('missing id');
  });

  it('rejects persona without name', () => {
    const result = validateVaultImport({
      ...validVault,
      personas: [{ id: 'p1', category: 'Shopping', icon: 'ShoppingBag', description: '', completionScore: 0, facts: [] }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('missing name');
  });

  it('rejects persona without facts array', () => {
    const result = validateVaultImport({
      ...validVault,
      personas: [{ id: 'p1', name: 'Test', category: 'Shopping', icon: 'ShoppingBag', description: '', completionScore: 0 }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('missing facts array');
  });

  it('rejects non-object persona entry', () => {
    const result = validateVaultImport({
      ...validVault,
      personas: ['not an object'],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('not an object');
  });

  it('accepts empty personas array', () => {
    const result = validateVaultImport({ ...validVault, personas: [] });
    expect(result.ok).toBe(true);
  });

  it('accepts vault with multiple valid personas', () => {
    const result = validateVaultImport({
      ...validVault,
      personas: [
        { id: 'p1', name: 'Shopping', category: 'Shopping', icon: 'ShoppingBag', description: '', completionScore: 0, facts: [] },
        { id: 'p2', name: 'Travel', category: 'Travel', icon: 'Plane', description: '', completionScore: 0, facts: [] },
      ],
    });
    expect(result.ok).toBe(true);
  });

  // ── Device validation ────────────────────────────────────────────────

  it('accepts vault without devices (optional field)', () => {
    const result = validateVaultImport(validVault);
    expect(result.ok).toBe(true);
  });

  it('accepts vault with valid devices array', () => {
    const result = validateVaultImport({
      ...validVault,
      devices: [
        { id: 'dev_1', name: 'MacBook Pro', type: 'vault', status: 'connected', lastSeen: '2026-02-02T00:00:00Z' },
        { id: 'dev_2', name: 'Mac Studio', type: 'agent', status: 'disconnected', lastSeen: '2026-02-02T00:00:00Z' },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it('accepts empty devices array', () => {
    const result = validateVaultImport({ ...validVault, devices: [] });
    expect(result.ok).toBe(true);
  });

  it('rejects non-array devices', () => {
    const result = validateVaultImport({ ...validVault, devices: 'not array' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('devices must be an array');
  });

  it('rejects device without id', () => {
    const result = validateVaultImport({
      ...validVault,
      devices: [{ name: 'Test', type: 'agent', status: 'connected', lastSeen: '2026-01-01T00:00:00Z' }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('missing id');
  });

  it('rejects device without name', () => {
    const result = validateVaultImport({
      ...validVault,
      devices: [{ id: 'dev_1', type: 'agent', status: 'connected', lastSeen: '2026-01-01T00:00:00Z' }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('missing name');
  });

  it('rejects device with invalid type', () => {
    const result = validateVaultImport({
      ...validVault,
      devices: [{ id: 'dev_1', name: 'Test', type: 'server', status: 'connected', lastSeen: '2026-01-01T00:00:00Z' }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('invalid type');
  });

  it('rejects device with invalid status', () => {
    const result = validateVaultImport({
      ...validVault,
      devices: [{ id: 'dev_1', name: 'Test', type: 'agent', status: 'offline', lastSeen: '2026-01-01T00:00:00Z' }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('invalid status');
  });

  it('accepts all valid device types', () => {
    for (const type of ['vault', 'agent', 'mobile']) {
      const result = validateVaultImport({
        ...validVault,
        devices: [{ id: 'dev_1', name: 'Test', type, status: 'connected', lastSeen: '2026-01-01T00:00:00Z' }],
      });
      expect(result.ok).toBe(true);
    }
  });

  it('accepts all valid device statuses', () => {
    for (const status of ['connected', 'disconnected', 'pairing']) {
      const result = validateVaultImport({
        ...validVault,
        devices: [{ id: 'dev_1', name: 'Test', type: 'agent', status, lastSeen: '2026-01-01T00:00:00Z' }],
      });
      expect(result.ok).toBe(true);
    }
  });
});

// ─── deriveHighlights ──────────────────────────────────────────────────────

describe('deriveHighlights', () => {
  const makePersona = (overrides: Partial<VaultPersona> = {}): VaultPersona => ({
    id: 'p1',
    name: 'Shopping',
    category: 'Shopping',
    icon: 'ShoppingBag',
    description: 'Shopping preferences',
    completionScore: 0.5,
    facts: [
      { key: 'apparel.fit_preference', value: 'slim fit', sensitivity: 'low', confidence: 0.9, source: 'import', extractedAt: 1 },
      { key: 'apparel.pants.waist', value: '32', sensitivity: 'medium', confidence: 0.8, source: 'import', extractedAt: 1 },
      { key: 'apparel.preferred_brands', value: 'j.crew', sensitivity: 'low', confidence: 0.7, source: 'import', extractedAt: 1 },
    ],
    ...overrides,
  });

  it('returns empty array for empty personas', () => {
    expect(deriveHighlights([])).toEqual([]);
  });

  it('skips personas with no facts', () => {
    const result = deriveHighlights([makePersona({ facts: [] })]);
    expect(result).toEqual([]);
  });

  it('returns highlights for a single persona', () => {
    const result = deriveHighlights([makePersona()]);
    expect(result).toHaveLength(1);
    expect(result[0].personaId).toBe('p1');
    expect(result[0].personaName).toBe('Shopping');
    expect(result[0].snippets.length).toBeGreaterThan(0);
  });

  it('includes priority key facts in snippets', () => {
    const result = deriveHighlights([makePersona()]);
    const text = result[0].snippets.join(' ');
    // Should include apparel.fit_preference or apparel.preferred_brands (priority keys for Shopping)
    expect(text.toLowerCase()).toMatch(/slim fit|j\.crew|waist/i);
  });

  it('masks high-sensitivity facts', () => {
    const persona = makePersona({
      facts: [
        { key: 'credit_card', value: '4111-xxxx-xxxx-1234', sensitivity: 'high', confidence: 1, source: 'import', extractedAt: 1 },
      ],
    });
    const result = deriveHighlights([persona]);
    const text = result[0].snippets.join(' ');
    expect(text).not.toContain('4111');
    expect(text).toContain('Credit Card'); // humanized key
  });

  it('respects maxPersonas limit', () => {
    const personas = Array.from({ length: 6 }, (_, i) =>
      makePersona({ id: `p${i}`, name: `Persona ${i}` }),
    );
    const result = deriveHighlights(personas, 3);
    expect(result).toHaveLength(3);
  });

  it('defaults to max 4 personas', () => {
    const personas = Array.from({ length: 10 }, (_, i) =>
      makePersona({ id: `p${i}`, name: `P${i}` }),
    );
    const result = deriveHighlights(personas);
    expect(result.length).toBeLessThanOrEqual(4);
  });

  it('produces at most 4 snippets per persona', () => {
    const manyFacts = Array.from({ length: 20 }, (_, i) => ({
      key: `fact_${i}`,
      value: `value ${i}`,
      sensitivity: 'low' as const,
      confidence: 0.8,
      source: 'import',
      extractedAt: 1,
    }));
    const result = deriveHighlights([makePersona({ facts: manyFacts })]);
    expect(result[0].snippets.length).toBeLessThanOrEqual(4);
  });

  it('includes icon from persona', () => {
    const result = deriveHighlights([makePersona({ icon: 'Plane' })]);
    expect(result[0].icon).toBe('Plane');
  });

  it('truncates long values', () => {
    const persona = makePersona({
      facts: [
        { key: 'note', value: 'A very long description that should definitely be truncated at some point', sensitivity: 'low', confidence: 1, source: 'import', extractedAt: 1 },
      ],
    });
    const result = deriveHighlights([persona]);
    expect(result[0].snippets[0].length).toBeLessThanOrEqual(35); // 28 + ellipsis + margin
  });
});

// ─── sortFacts ─────────────────────────────────────────────────────────────

describe('sortFacts', () => {
  const makeFact = (overrides: Partial<VaultFact> = {}): VaultFact => ({
    key: 'key',
    value: 'val',
    sensitivity: 'low',
    confidence: 0.8,
    source: 'test',
    extractedAt: 1000,
    ...overrides,
  });

  const facts: VaultFact[] = [
    makeFact({ key: 'apparel.pants.waist', sensitivity: 'medium', confidence: 0.9 }),
    makeFact({ key: 'apparel.shoe.size', sensitivity: 'low', confidence: 0.7 }),
    makeFact({ key: 'credit_card', sensitivity: 'high', confidence: 1.0 }),
    makeFact({ key: 'brand_pref', sensitivity: 'low', confidence: 0.5 }),
    makeFact({ key: 'address', sensitivity: 'high', confidence: 0.85 }),
  ];

  it('returns same array reference for "default" sort', () => {
    const result = sortFacts(facts, 'default');
    expect(result).toBe(facts);
  });

  it('returns same array reference for single-element array', () => {
    const single = [makeFact()];
    expect(sortFacts(single, 'key_asc')).toBe(single);
  });

  it('does not mutate the input array', () => {
    const copy = [...facts];
    sortFacts(facts, 'key_asc');
    expect(facts.map((f) => f.key)).toEqual(copy.map((f) => f.key));
  });

  it('sorts by key A→Z', () => {
    const sorted = sortFacts(facts, 'key_asc');
    const keys = sorted.map((f) => f.key);
    expect(keys).toEqual([
      'address',
      'apparel.pants.waist',
      'apparel.shoe.size',
      'brand_pref',
      'credit_card',
    ]);
  });

  it('sorts by sensitivity high → medium → low', () => {
    const sorted = sortFacts(facts, 'sensitivity_desc');
    const sensitivities = sorted.map((f) => f.sensitivity);
    expect(sensitivities).toEqual(['high', 'high', 'medium', 'low', 'low']);
  });

  it('uses key as secondary sort when sensitivity is equal', () => {
    const sorted = sortFacts(facts, 'sensitivity_desc');
    expect(sorted[0].key).toBe('address');
    expect(sorted[1].key).toBe('credit_card');
    expect(sorted[3].key).toBe('apparel.shoe.size');
    expect(sorted[4].key).toBe('brand_pref');
  });

  it('sorts by confidence high → low', () => {
    const sorted = sortFacts(facts, 'confidence_desc');
    const confidences = sorted.map((f) => f.confidence);
    expect(confidences).toEqual([1.0, 0.9, 0.85, 0.7, 0.5]);
  });

  it('uses key as secondary sort when confidence is equal', () => {
    const tied = [
      makeFact({ key: 'zebra', confidence: 0.9 }),
      makeFact({ key: 'alpha', confidence: 0.9 }),
    ];
    const sorted = sortFacts(tied, 'confidence_desc');
    expect(sorted.map((f) => f.key)).toEqual(['alpha', 'zebra']);
  });

  it('handles empty array', () => {
    expect(sortFacts([], 'key_asc')).toEqual([]);
  });

  it('handles unknown sensitivity gracefully (sorts to end)', () => {
    const weird = [
      makeFact({ key: 'a', sensitivity: 'low' }),
      makeFact({ key: 'b', sensitivity: 'unknown' as VaultFact['sensitivity'] }),
    ];
    const sorted = sortFacts(weird, 'sensitivity_desc');
    expect(sorted[0].key).toBe('a');
    expect(sorted[1].key).toBe('b');
  });
});

// ─── detectDuplicateFacts ──────────────────────────────────────────────────

describe('detectDuplicateFacts', () => {
  const makeFact = (overrides: Partial<VaultFact> = {}): VaultFact => ({
    key: 'key',
    value: 'val',
    sensitivity: 'low',
    confidence: 0.8,
    source: 'test',
    extractedAt: 1000,
    ...overrides,
  });

  it('returns empty array when no duplicates', () => {
    const facts = [
      makeFact({ key: 'a', value: '1' }),
      makeFact({ key: 'b', value: '2' }),
      makeFact({ key: 'c', value: '3' }),
    ];
    expect(detectDuplicateFacts(facts)).toEqual([]);
  });

  it('returns empty array for empty input', () => {
    expect(detectDuplicateFacts([])).toEqual([]);
  });

  it('detects duplicate keys with different values', () => {
    const facts = [
      makeFact({ key: 'budget', value: '$100' }),
      makeFact({ key: 'budget', value: '$200' }),
      makeFact({ key: 'size', value: 'M' }),
    ];
    const dupes = detectDuplicateFacts(facts);
    expect(dupes).toHaveLength(1);
    expect(dupes[0].key).toBe('budget');
    expect(dupes[0].count).toBe(2);
    expect(dupes[0].values).toEqual(['$100', '$200']);
  });

  it('detects duplicate keys with same values', () => {
    const facts = [
      makeFact({ key: 'brand', value: 'Nike' }),
      makeFact({ key: 'brand', value: 'Nike' }),
    ];
    const dupes = detectDuplicateFacts(facts);
    expect(dupes).toHaveLength(1);
    expect(dupes[0].count).toBe(2);
    expect(dupes[0].values).toEqual(['Nike', 'Nike']);
  });

  it('sorts by count descending', () => {
    const facts = [
      makeFact({ key: 'x', value: '1' }),
      makeFact({ key: 'x', value: '2' }),
      makeFact({ key: 'y', value: 'a' }),
      makeFact({ key: 'y', value: 'b' }),
      makeFact({ key: 'y', value: 'c' }),
    ];
    const dupes = detectDuplicateFacts(facts);
    expect(dupes).toHaveLength(2);
    expect(dupes[0].key).toBe('y'); // count 3
    expect(dupes[1].key).toBe('x'); // count 2
  });

  it('uses alphabetical key as tiebreaker when counts are equal', () => {
    const facts = [
      makeFact({ key: 'zebra', value: '1' }),
      makeFact({ key: 'zebra', value: '2' }),
      makeFact({ key: 'alpha', value: 'a' }),
      makeFact({ key: 'alpha', value: 'b' }),
    ];
    const dupes = detectDuplicateFacts(facts);
    expect(dupes[0].key).toBe('alpha');
    expect(dupes[1].key).toBe('zebra');
  });

  it('handles many duplicates of same key', () => {
    const facts = Array.from({ length: 7 }, (_, i) =>
      makeFact({ key: 'budget.monthly_clothing', value: `$${(i + 1) * 50}` }),
    );
    const dupes = detectDuplicateFacts(facts);
    expect(dupes).toHaveLength(1);
    expect(dupes[0].count).toBe(7);
    expect(dupes[0].values).toHaveLength(7);
  });

  it('single fact per key produces no duplicates', () => {
    const facts = Array.from({ length: 10 }, (_, i) =>
      makeFact({ key: `key_${i}`, value: `val_${i}` }),
    );
    expect(detectDuplicateFacts(facts)).toEqual([]);
  });
});
