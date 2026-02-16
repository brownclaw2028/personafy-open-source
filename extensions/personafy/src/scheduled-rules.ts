import crypto from "node:crypto";

import type {
  PersonafyScheduledRule,
  PersonafyVault,
  PersonafyPreWarmedContext,
} from "./types.js";
import { getFieldValues } from "./vault.js";

// ---------------------------------------------------------------------------
// Rule creation
// ---------------------------------------------------------------------------

export function createHeartbeatRule(opts: {
  agentId: string;
  heartbeatId: string;
  persona: string;
  fields: string[];
  ttlMs: number;
}): PersonafyScheduledRule {
  const now = Date.now();
  return {
    id: `srl_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
    kind: "heartbeat",
    sourceId: opts.heartbeatId,
    agentId: opts.agentId,
    persona: opts.persona,
    fields: opts.fields,
    expiresAtMs: now + opts.ttlMs,
    createdAtMs: now,
  };
}

export function createCronRule(opts: {
  agentId: string;
  cronId: string;
  persona: string;
  fields: string[];
  timeWindow?: { from: string; to: string };
  expiresInDays: number;
}): PersonafyScheduledRule {
  const now = Date.now();
  return {
    id: `srl_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
    kind: "cron",
    sourceId: opts.cronId,
    agentId: opts.agentId,
    persona: opts.persona,
    fields: opts.fields,
    timeWindow: opts.timeWindow,
    expiresAtMs: now + opts.expiresInDays * 24 * 60 * 60 * 1000,
    createdAtMs: now,
  };
}

// ---------------------------------------------------------------------------
// Vault rule management
// ---------------------------------------------------------------------------

export function addScheduledRule(
  vault: PersonafyVault,
  rule: PersonafyScheduledRule,
): void {
  vault.scheduledRules.push(rule);
}

export function expireScheduledRules(
  vault: PersonafyVault,
  nowMs?: number,
): number {
  const now = nowMs ?? Date.now();
  const before = vault.scheduledRules.length;
  vault.scheduledRules = vault.scheduledRules.filter(
    (r) => now <= r.expiresAtMs,
  );
  return before - vault.scheduledRules.length;
}

export function listScheduledRules(
  vault: PersonafyVault,
  opts?: { type?: "heartbeat" | "cron"; agentId?: string },
): PersonafyScheduledRule[] {
  let rules = vault.scheduledRules;

  if (opts?.type) {
    rules = rules.filter((r) => r.kind === opts.type);
  }

  if (opts?.agentId) {
    rules = rules.filter((r) => r.agentId === opts.agentId);
  }

  return rules;
}

export function revokeScheduledRule(
  vault: PersonafyVault,
  ruleId: string,
): boolean {
  const before = vault.scheduledRules.length;
  vault.scheduledRules = vault.scheduledRules.filter((r) => r.id !== ruleId);
  return vault.scheduledRules.length < before;
}

// ---------------------------------------------------------------------------
// Pre-warming context for crons
// ---------------------------------------------------------------------------

const preWarmedCache = new Map<string, PersonafyPreWarmedContext>();

export function preWarmContext(
  cronId: string,
  vault: PersonafyVault,
  ttlMs: number = 10 * 60 * 1000,
): PersonafyPreWarmedContext | null {
  const matchingRules = vault.scheduledRules.filter(
    (r) => r.sourceId === cronId,
  );

  if (matchingRules.length === 0) {
    return null;
  }

  // Collect the union of all approved fields across matching rules
  const approvedFields = new Set<string>();
  for (const rule of matchingRules) {
    for (const field of rule.fields) {
      approvedFields.add(field);
    }
  }

  // Pre-warm needs a persona — use the first matching rule's persona
  const persona = matchingRules[0].persona;
  const fieldValues = getFieldValues(vault, persona, [...approvedFields]);

  const now = Date.now();
  const preWarmed: PersonafyPreWarmedContext = {
    cronId,
    fields: fieldValues,
    preparedAtMs: now,
    expiresAtMs: now + ttlMs,
  };

  preWarmedCache.set(cronId, preWarmed);
  return preWarmed;
}

export function getPreWarmedContext(
  cronId: string,
): PersonafyPreWarmedContext | null {
  const cached = preWarmedCache.get(cronId);

  if (!cached) {
    return null;
  }

  if (Date.now() > cached.expiresAtMs) {
    preWarmedCache.delete(cronId);
    return null;
  }

  return cached;
}

export function clearPreWarmedContext(cronId: string): void {
  preWarmedCache.delete(cronId);
}
