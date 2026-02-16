// =============================================================================
// Personafy – Core Types
// =============================================================================

/** Privacy posture controls default approval behaviour. */
export type PersonafyPosture = "open" | "guarded" | "locked";

// ---------------------------------------------------------------------------
// Personas & Facts
// ---------------------------------------------------------------------------

export type PersonafyFact = {
  id: string;
  persona: string;
  field: string;
  value: string;
  createdAtMs: number;
  updatedAtMs: number;
};

export type PersonafyPersona = {
  id: string;
  label: string;
  fields: Record<string, string>;
  createdAtMs: number;
  updatedAtMs: number;
};

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export type PersonafyRuleKind = "standard" | "heartbeat" | "cron";

/** Standard policy rule – always evaluated. */
export type PersonafyRule = {
  id: string;
  kind: PersonafyRuleKind;
  /** Which persona this rule applies to. */
  persona: string;
  /** Allowed field names within the persona. */
  fields: string[];
  /** Optional agent ID restriction. */
  agentId?: string;
  /** Optional purpose pattern (substring match). */
  purposePattern?: string;
  createdAtMs: number;
};

/** Scheduled rule for heartbeats/crons with time-window + TTL scoping. */
export type PersonafyScheduledRule = {
  id: string;
  kind: "heartbeat" | "cron";
  /** Linked cron or heartbeat identifier. */
  sourceId: string;
  /** Optional agent ID this rule applies to. */
  agentId?: string;
  persona: string;
  fields: string[];
  /** Optional time-of-day window (HH:MM). */
  timeWindow?: { from: string; to: string };
  /** Absolute expiry timestamp (ms). */
  expiresAtMs: number;
  createdAtMs: number;
};

// ---------------------------------------------------------------------------
// Context Requests
// ---------------------------------------------------------------------------

export type PersonafyRequestType = "message" | "heartbeat" | "cron" | "webhook" | "hook";

export type PersonafyUrgency = "normal" | "urgent";

export type PersonafyContextRequest = {
  /** Requesting agent. */
  agentId: string;
  /** Type of trigger that initiated the request. */
  requestType: PersonafyRequestType;
  persona: string;
  fields: string[];
  purpose: string;
  urgency?: PersonafyUrgency;
  /** Linked cron/heartbeat ID for scheduled requests. */
  sourceId?: string;
  /** Correlation ID for multi-agent workflow tracking. */
  correlationId?: string;
};

export type PersonafyContextDecision = "approved" | "denied" | "pending";

export type PersonafyContextResult = {
  decision: PersonafyContextDecision;
  /** Fields that were approved and their values. */
  approvedFields: Record<string, string>;
  /** Fields that require async approval. */
  pendingFields: string[];
  /** Fields that were denied. */
  deniedFields: string[];
  /** Approval queue ID if any fields are pending. */
  approvalId?: string;
  /** Audit entry ID for this access. */
  auditId: string;
};

// ---------------------------------------------------------------------------
// Approval Queue
// ---------------------------------------------------------------------------

export type PersonafyApprovalStatus = "pending" | "approved" | "denied" | "expired";

export type PersonafyApprovalQueueEntry = {
  id: string;
  request: PersonafyContextRequest;
  status: PersonafyApprovalStatus;
  createdAtMs: number;
  expiresAtMs: number;
  resolvedAtMs?: number;
  resolvedBy?: string;
  /** If approved, optionally create a standing rule. */
  createStandingRule?: boolean;
};

// ---------------------------------------------------------------------------
// Audit Log
// ---------------------------------------------------------------------------

export type PersonafyAuditEntry = {
  id: string;
  agentId: string;
  requestType: PersonafyRequestType;
  persona: string;
  fields: string[];
  purpose: string;
  decision: PersonafyContextDecision;
  timestamp: number;
  /** Links audit events across agents in the same workflow. */
  correlationId?: string;
  /** Linked source (cron/heartbeat ID). */
  sourceId?: string;
};

// ---------------------------------------------------------------------------
// Pre-warmed Context
// ---------------------------------------------------------------------------

export type PersonafyPreWarmedContext = {
  cronId: string;
  fields: Record<string, string>;
  preparedAtMs: number;
  expiresAtMs: number;
};

// ---------------------------------------------------------------------------
// Vault (persistent state)
// ---------------------------------------------------------------------------

export type PersonafyVault = {
  version: 1;
  posture: PersonafyPosture;
  personas: Record<string, PersonafyPersona>;
  facts: PersonafyFact[];
  rules: PersonafyRule[];
  scheduledRules: PersonafyScheduledRule[];
  approvalQueue: PersonafyApprovalQueueEntry[];
  auditLog: PersonafyAuditEntry[];
};

// ---------------------------------------------------------------------------
// Plugin Config (resolved from openclaw config)
// ---------------------------------------------------------------------------

export type PersonafyPluginConfig = {
  enabled: boolean;
  defaultPosture: PersonafyPosture;
  approvalExpiryMs: number;
  auditRetentionDays: number;
  scheduledRuleDefaultExpiryDays: number;
  preWarmMinutes: number;
  notificationChannel?: string;
  posthogApiKey?: string;
};

export const DEFAULT_PERSONAFY_CONFIG: PersonafyPluginConfig = {
  enabled: true,
  defaultPosture: "guarded",
  approvalExpiryMs: 24 * 60 * 60 * 1000, // 24 hours
  auditRetentionDays: 90,
  scheduledRuleDefaultExpiryDays: 30,
  preWarmMinutes: 5,
};
