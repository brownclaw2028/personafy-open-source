import crypto from "node:crypto";
import type {
  PersonafyAuditEntry,
  PersonafyContextDecision,
  PersonafyRequestType,
  PersonafyVault,
} from "./types.js";
import { appendAudit } from "./vault.js";

export type CreateAuditOpts = {
  agentId: string;
  requestType: PersonafyRequestType;
  persona: string;
  fields: string[];
  purpose: string;
  decision: PersonafyContextDecision;
  correlationId?: string;
  sourceId?: string;
};

export function logAudit(vault: PersonafyVault, opts: CreateAuditOpts): PersonafyAuditEntry {
  const entry: PersonafyAuditEntry = {
    id: `aud_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
    agentId: opts.agentId,
    requestType: opts.requestType,
    persona: opts.persona,
    fields: opts.fields,
    purpose: opts.purpose,
    decision: opts.decision,
    timestamp: Date.now(),
    correlationId: opts.correlationId,
    sourceId: opts.sourceId,
  };
  appendAudit(vault, entry);
  return entry;
}

export type AuditQueryOpts = {
  agentId?: string;
  since?: number;
  correlationId?: string;
  limit?: number;
};

export function getAuditLog(vault: PersonafyVault, opts?: AuditQueryOpts): PersonafyAuditEntry[] {
  let entries = vault.auditLog;
  if (opts?.agentId) {
    entries = entries.filter((e) => e.agentId === opts.agentId);
  }
  if (opts?.since) {
    entries = entries.filter((e) => e.timestamp >= opts.since!);
  }
  if (opts?.correlationId) {
    entries = entries.filter((e) => e.correlationId === opts.correlationId);
  }
  if (opts?.limit && opts.limit > 0) {
    entries = entries.slice(-opts.limit);
  }
  return entries;
}

export function correlateAuditEntries(
  vault: PersonafyVault,
  correlationId: string,
): PersonafyAuditEntry[] {
  return vault.auditLog.filter((e) => e.correlationId === correlationId);
}
