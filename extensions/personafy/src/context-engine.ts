import type {
  PersonafyContextRequest,
  PersonafyContextResult,
  PersonafyPluginConfig,
  PersonafyVault,
} from "./types.js";
import { enqueueApproval } from "./approval-queue.js";
import { logAudit } from "./audit.js";
import { isAutoApproveEnabled, isVaultLocked } from "./posture.js";
import { evaluateRules, evaluateScheduledRules } from "./rules.js";
import { getFieldValues } from "./vault.js";
import { captureEvent } from "./posthog.js";

/**
 * Core context request engine. Evaluates a request against the vault's rules
 * and posture, logs the access, and returns the result.
 */
export function requestContext(
  request: PersonafyContextRequest,
  vault: PersonafyVault,
  config: PersonafyPluginConfig,
): PersonafyContextResult {
  // Locked posture → deny everything
  if (isVaultLocked(vault)) {
    const auditEntry = logAudit(vault, {
      agentId: request.agentId,
      requestType: request.requestType,
      persona: request.persona,
      fields: request.fields,
      purpose: request.purpose,
      decision: "denied",
      correlationId: request.correlationId,
      sourceId: request.sourceId,
    });
    captureEvent("context_request", {
      agent_id: request.agentId,
      request_type: request.requestType,
      persona: request.persona,
      field_count: request.fields.length,
      decision: "denied",
      reason: "vault_locked",
    });
    return {
      decision: "denied",
      approvedFields: {},
      pendingFields: [],
      deniedFields: request.fields,
      auditId: auditEntry.id,
    };
  }

  // Evaluate scheduled rules first (for heartbeat/cron requests)
  let approvedFieldSet = new Set<string>();
  if (request.requestType === "heartbeat" || request.requestType === "cron") {
    const scheduledResult = evaluateScheduledRules(request, vault);
    for (const f of scheduledResult.approvedFields) approvedFieldSet.add(f);
  }

  // Evaluate standard rules
  const standardResult = evaluateRules(request, vault);
  for (const f of standardResult.approvedFields) approvedFieldSet.add(f);

  // In "open" posture, auto-approve remaining fields if any standard rule matched
  if (isAutoApproveEnabled(vault) && standardResult.matchedRules.length > 0) {
    for (const f of request.fields) approvedFieldSet.add(f);
  }

  const approvedFieldNames = [...approvedFieldSet];
  const remainingFields = request.fields.filter((f) => !approvedFieldSet.has(f));

  // All fields approved
  if (remainingFields.length === 0) {
    const values = getFieldValues(vault, request.persona, approvedFieldNames);
    const auditEntry = logAudit(vault, {
      agentId: request.agentId,
      requestType: request.requestType,
      persona: request.persona,
      fields: approvedFieldNames,
      purpose: request.purpose,
      decision: "approved",
      correlationId: request.correlationId,
      sourceId: request.sourceId,
    });
    captureEvent("context_request", {
      agent_id: request.agentId,
      request_type: request.requestType,
      persona: request.persona,
      field_count: request.fields.length,
      decision: "approved",
      reason: "rules_matched",
      fields_approved: approvedFieldNames.length,
      matched_rules: standardResult.matchedRules.length,
    });
    return {
      decision: "approved",
      approvedFields: values,
      pendingFields: [],
      deniedFields: [],
      auditId: auditEntry.id,
    };
  }

  // Some fields unapproved — queue for async approval
  const approvalId = enqueueApproval(vault, request, config.approvalExpiryMs);
  const partialValues = getFieldValues(vault, request.persona, approvedFieldNames);
  const auditEntry = logAudit(vault, {
    agentId: request.agentId,
    requestType: request.requestType,
    persona: request.persona,
    fields: request.fields,
    purpose: request.purpose,
    decision: approvedFieldNames.length > 0 ? "approved" : "pending",
    correlationId: request.correlationId,
    sourceId: request.sourceId,
  });

  const decision = approvedFieldNames.length > 0 ? "approved" : "pending";
  captureEvent("context_request", {
    agent_id: request.agentId,
    request_type: request.requestType,
    persona: request.persona,
    field_count: request.fields.length,
    decision,
    reason: "pending_approval",
    fields_approved: approvedFieldNames.length,
    fields_pending: remainingFields.length,
  });
  return {
    decision,
    approvedFields: partialValues,
    pendingFields: remainingFields,
    deniedFields: [],
    approvalId,
    auditId: auditEntry.id,
  };
}
