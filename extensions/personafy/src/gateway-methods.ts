import crypto from "node:crypto";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { PersonafyPluginConfig, PersonafyRule } from "./types.js";
import { getActiveVault } from "./vault.js";
import { getApprovalById, getPendingApprovals, resolveApproval } from "./approval-queue.js";
import { getAuditLog } from "./audit.js";
import { getPosture, setPosture, isValidPosture } from "./posture.js";
import {
  addScheduledRule,
  createCronRule,
  createHeartbeatRule,
  revokeScheduledRule,
} from "./scheduled-rules.js";

export function registerPersonafyGatewayMethods(
  api: OpenClawPluginApi,
  cfg: PersonafyPluginConfig,
): void {
  // ── personafy.status ───────────────────────────────────────────────
  api.registerGatewayMethod("personafy.status", () => {
    const vault = getActiveVault();
    if (!vault) return { error: "Vault not initialized" };

    return {
      posture: getPosture(vault),
      pendingApprovals: getPendingApprovals(vault).length,
      scheduledRules: vault.scheduledRules.length,
      personas: Object.keys(vault.personas),
      vaultLocked: getPosture(vault) === "locked",
    };
  });

  // ── personafy.approvals ────────────────────────────────────────────
  api.registerGatewayMethod("personafy.approvals", () => {
    const vault = getActiveVault();
    if (!vault) return { error: "Vault not initialized" };
    return getPendingApprovals(vault);
  });

  // ── personafy.approvals.resolve ────────────────────────────────────
  api.registerGatewayMethod("personafy.approvals.resolve", (params) => {
    const vault = getActiveVault();
    if (!vault) return { error: "Vault not initialized" };

    const p = (params ?? {}) as Record<string, unknown>;
    const id = p.id as string;
    const decision = p.decision as "approved" | "denied";
    const createStandingRuleFlag = p.createStandingRule as boolean | undefined;

    const ok = resolveApproval(vault, id, decision);

    if (createStandingRuleFlag && decision === "approved") {
      const entry = getApprovalById(vault, id);
      if (entry) {
        const rule: PersonafyRule = {
          id: `rul_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
          kind: "standard",
          persona: entry.request.persona,
          fields: entry.request.fields,
          agentId: entry.request.agentId,
          createdAtMs: Date.now(),
        };
        vault.rules.push(rule);
      }
    }

    return { ok };
  });

  // ── personafy.rules ────────────────────────────────────────────────
  api.registerGatewayMethod("personafy.rules", () => {
    const vault = getActiveVault();
    if (!vault) return { error: "Vault not initialized" };
    return { standardRules: vault.rules, scheduledRules: vault.scheduledRules };
  });

  // ── personafy.rules.add ────────────────────────────────────────────
  api.registerGatewayMethod("personafy.rules.add", (params) => {
    const vault = getActiveVault();
    if (!vault) return { error: "Vault not initialized" };

    const p = (params ?? {}) as Record<string, unknown>;
    const kind = p.kind as "standard" | "heartbeat" | "cron";
    const persona = p.persona as string;
    const fields = p.fields as string[];
    const agentId = p.agentId as string | undefined;
    const purposePattern = p.purposePattern as string | undefined;
    const sourceId = p.sourceId as string | undefined;
    const timeWindow = p.timeWindow as { from: string; to: string } | undefined;
    const ttlMs = p.ttlMs as number | undefined;
    const expiresInDays = (p.expiresInDays as number | undefined) ?? cfg.scheduledRuleDefaultExpiryDays;

    if (kind === "standard") {
      const rule: PersonafyRule = {
        id: `rul_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
        kind: "standard",
        persona,
        fields,
        agentId,
        purposePattern,
        createdAtMs: Date.now(),
      };
      vault.rules.push(rule);
      return { ok: true, id: rule.id };
    }

    if (kind === "heartbeat") {
      const rule = createHeartbeatRule({
        agentId: agentId ?? "",
        heartbeatId: sourceId ?? "",
        persona,
        fields,
        ttlMs: ttlMs ?? expiresInDays * 24 * 60 * 60 * 1000,
      });
      addScheduledRule(vault, rule);
      return { ok: true, id: rule.id };
    }

    // cron
    const rule = createCronRule({
      agentId: agentId ?? "",
      cronId: sourceId ?? "",
      persona,
      fields,
      timeWindow,
      expiresInDays,
    });
    addScheduledRule(vault, rule);
    return { ok: true, id: rule.id };
  });

  // ── personafy.rules.remove ─────────────────────────────────────────
  api.registerGatewayMethod("personafy.rules.remove", (params) => {
    const vault = getActiveVault();
    if (!vault) return { error: "Vault not initialized" };

    const p = (params ?? {}) as Record<string, unknown>;
    const id = p.id as string;

    // Try standard rules first
    const beforeStd = vault.rules.length;
    vault.rules = vault.rules.filter((r) => r.id !== id);
    const removedStandard = vault.rules.length < beforeStd;

    // Then scheduled rules
    const removedScheduled = revokeScheduledRule(vault, id);

    return { ok: removedStandard || removedScheduled };
  });

  // ── personafy.audit ────────────────────────────────────────────────
  api.registerGatewayMethod("personafy.audit", (params) => {
    const vault = getActiveVault();
    if (!vault) return { error: "Vault not initialized" };

    const p = (params ?? {}) as Record<string, unknown>;
    return getAuditLog(vault, {
      since: p.since as number | undefined,
      agentId: p.agentId as string | undefined,
      limit: p.limit as number | undefined,
    });
  });

  // ── personafy.vault.posture ────────────────────────────────────────
  api.registerGatewayMethod("personafy.vault.posture", (params) => {
    const vault = getActiveVault();
    if (!vault) return { error: "Vault not initialized" };

    const p = (params ?? {}) as Record<string, unknown>;
    const posture = p.posture;

    if (posture !== undefined) {
      if (!isValidPosture(posture)) {
        return { error: `Invalid posture: "${posture}". Must be one of: open, guarded, locked` };
      }
      setPosture(vault, posture);
    }

    return { posture: getPosture(vault) };
  });
}
