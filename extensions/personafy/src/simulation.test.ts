import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  createEmptyVault,
  setPersona,
  addFact,
  getFieldValue,
  getFieldValues,
  setActiveVault,
  getPosture,
  setPosture,
  pruneAuditLog,
} from "./vault.js";
import { requestContext } from "./context-engine.js";
import { evaluateRules, evaluateScheduledRules, isScheduledRuleActive } from "./rules.js";
import {
  enqueueApproval,
  resolveApproval,
  getPendingApprovals,
  getApprovalById,
  expireStaleApprovals,
  pruneResolvedApprovals,
} from "./approval-queue.js";
import {
  createHeartbeatRule,
  createCronRule,
  addScheduledRule,
  expireScheduledRules,
  listScheduledRules,
  revokeScheduledRule,
  preWarmContext,
  getPreWarmedContext,
  clearPreWarmedContext,
} from "./scheduled-rules.js";
import { logAudit, getAuditLog, correlateAuditEntries } from "./audit.js";
import { isVaultLocked, isAutoApproveEnabled } from "./posture.js";
import type {
  PersonafyVault,
  PersonafyPluginConfig,
  PersonafyContextRequest,
  PersonafyContextResult,
  PersonafyPosture,
  PersonafyRule,
} from "./types.js";
import { DEFAULT_PERSONAFY_CONFIG } from "./types.js";

// =============================================================================
// SimLogger — structured in-memory logger, dumps on failure
// =============================================================================

type SimLogEntry = {
  timestamp: number;
  prefix: string;
  message: string;
  data?: unknown;
};

class SimLogger {
  entries: SimLogEntry[] = [];
  private verbose = !!process.env.SIM_VERBOSE;

  log(
    prefix:
      | "[SIM]"
      | `[AGENT:${string}]`
      | "[VAULT]"
      | "[APPROVAL]"
      | "[RULE]"
      | "[POSTURE]"
      | "[AUDIT]"
      | "[MAINTENANCE]"
      | "[CHAOS]",
    message: string,
    data?: unknown,
  ): void {
    const entry: SimLogEntry = { timestamp: Date.now(), prefix, message, data };
    this.entries.push(entry);
    if (this.verbose) {
      console.log(`${entry.prefix} ${entry.message}`, data !== undefined ? data : "");
    }
  }

  dump(): void {
    console.log("\n=== SIMULATION LOG DUMP ===");
    for (const e of this.entries) {
      console.log(`[${e.timestamp}] ${e.prefix} ${e.message}`, e.data !== undefined ? JSON.stringify(e.data) : "");
    }
    console.log("=== END LOG DUMP ===\n");
  }
}

// =============================================================================
// Helpers
// =============================================================================

function buildRealisticVault(): PersonafyVault {
  const vault = createEmptyVault("guarded");

  setPersona(vault, "work", "Work Profile", {
    tools: "vscode",
    communication_style: "concise",
    review_preferences: "thorough",
    timezone: "America/New_York",
    role: "senior-engineer",
  });

  setPersona(vault, "personal", "Personal", {
    name: "Alice",
    email: "alice@example.com",
    birthday: "1990-03-15",
    hobbies: "hiking,reading",
    dietary_preferences: "vegetarian",
  });

  setPersona(vault, "shopping", "Shopping", {
    clothing_size: "M",
    shoe_size: "9",
    preferred_brands: "acme,globex",
    shipping_address: "123 Main St",
    payment_method: "visa-4242",
  });

  // Add 2 facts for work persona to test fact fallback
  addFact(vault, "work", "editor", "vim");
  addFact(vault, "work", "os", "linux");

  return vault;
}

function simulateAgent(
  agentId: string,
  vault: PersonafyVault,
  config: PersonafyPluginConfig,
  logger: SimLogger,
  request: Omit<PersonafyContextRequest, "agentId">,
): PersonafyContextResult {
  const fullRequest: PersonafyContextRequest = { agentId, ...request };
  logger.log(`[AGENT:${agentId}]`, "Requesting context", {
    persona: fullRequest.persona,
    fields: fullRequest.fields,
    purpose: fullRequest.purpose,
    requestType: fullRequest.requestType,
  });

  const result = requestContext(fullRequest, vault, config);

  logger.log(`[AGENT:${agentId}]`, "Context result", {
    decision: result.decision,
    approvedFields: Object.keys(result.approvedFields),
    pendingFields: result.pendingFields,
    deniedFields: result.deniedFields,
    approvalId: result.approvalId,
  });

  return result;
}

function addStandardRule(
  vault: PersonafyVault,
  logger: SimLogger,
  rule: Omit<PersonafyRule, "createdAtMs">,
): PersonafyRule {
  const fullRule: PersonafyRule = { ...rule, createdAtMs: Date.now() };
  vault.rules.push(fullRule);
  logger.log("[RULE]", `Added standard rule ${rule.id}`, {
    persona: rule.persona,
    fields: rule.fields,
    agentId: rule.agentId,
  });
  return fullRule;
}

function addScheduledRuleHelper(
  vault: PersonafyVault,
  logger: SimLogger,
  rule: ReturnType<typeof createHeartbeatRule>,
): void {
  addScheduledRule(vault, rule);
  logger.log("[RULE]", `Added scheduled rule ${rule.id}`, {
    kind: rule.kind,
    sourceId: rule.sourceId,
    persona: rule.persona,
    fields: rule.fields,
  });
}

function resolveApprovalHelper(
  vault: PersonafyVault,
  logger: SimLogger,
  id: string,
  decision: "approved" | "denied",
  resolvedBy?: string,
  createStandingRule?: boolean,
): boolean {
  const ok = resolveApproval(vault, id, decision, resolvedBy, createStandingRule);
  logger.log("[APPROVAL]", `Resolved ${id} -> ${decision}`, {
    ok,
    resolvedBy,
    createStandingRule,
  });
  return ok;
}

/** Deterministic PRNG (mulberry32). */
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// =============================================================================
// Simulation Scenarios
// =============================================================================

describe("Personafy Simulation Harness", () => {
  let logger: SimLogger;
  let config: PersonafyPluginConfig;

  beforeEach(() => {
    logger = new SimLogger();
    config = { ...DEFAULT_PERSONAFY_CONFIG };
  });

  afterEach((ctx) => {
    // Dump logs on test failure
    if (ctx.task.result?.state === "fail") {
      logger.dump();
    }
  });

  // -------------------------------------------------------------------------
  // 1. Multi-persona vault setup and basic context flow
  // -------------------------------------------------------------------------
  it("1. Multi-persona vault setup and basic context flow", () => {
    const vault = buildRealisticVault();
    setActiveVault(vault);
    logger.log("[SIM]", "Built realistic vault with 3 personas");

    // Verify vault structure
    expect(Object.keys(vault.personas)).toHaveLength(3);
    expect(vault.facts).toHaveLength(2);

    // Add rule covering work.tools + communication_style
    addStandardRule(vault, logger, {
      id: "rule-work-basic",
      kind: "standard",
      persona: "work",
      fields: ["tools", "communication_style"],
    });

    // Agent requests covered fields -> approved
    const result1 = simulateAgent("agent-1", vault, config, logger, {
      requestType: "message",
      persona: "work",
      fields: ["tools", "communication_style"],
      purpose: "help with coding",
    });
    expect(result1.decision).toBe("approved");
    expect(result1.approvedFields.tools).toBe("vscode");
    expect(result1.approvedFields.communication_style).toBe("concise");

    // Agent requests uncovered fields -> pending + approval queued
    const result2 = simulateAgent("agent-1", vault, config, logger, {
      requestType: "message",
      persona: "work",
      fields: ["review_preferences", "timezone"],
      purpose: "configure review bot",
    });
    expect(result2.decision).toBe("pending");
    expect(result2.pendingFields).toContain("review_preferences");
    expect(result2.approvalId).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // 2. Concurrent multi-agent context requests
  // -------------------------------------------------------------------------
  it("2. Concurrent multi-agent context requests", () => {
    const vault = buildRealisticVault();
    setActiveVault(vault);

    addStandardRule(vault, logger, {
      id: "rule-work-tools",
      kind: "standard",
      persona: "work",
      fields: ["tools"],
    });

    // 5 agents request the same persona simultaneously
    const agents = ["agent-a", "agent-b", "agent-c", "agent-d", "agent-e"];
    const results: PersonafyContextResult[] = [];

    for (const agentId of agents) {
      const result = simulateAgent(agentId, vault, config, logger, {
        requestType: "message",
        persona: "work",
        fields: ["tools", "communication_style"],
        purpose: "coding assistance",
      });
      results.push(result);
    }

    // All should get tools approved (covered by rule)
    for (const result of results) {
      expect(result.approvedFields.tools).toBe("vscode");
    }

    // communication_style should be pending for all (not covered)
    for (const result of results) {
      expect(result.pendingFields).toContain("communication_style");
    }

    // 5 audit entries should exist
    expect(vault.auditLog).toHaveLength(5);

    // No state corruption: vault personas unchanged
    expect(vault.personas.work.fields.tools).toBe("vscode");
    expect(vault.personas.work.fields.communication_style).toBe("concise");
  });

  // -------------------------------------------------------------------------
  // 3. Three-tier approval cascade
  // -------------------------------------------------------------------------
  it("3. Three-tier approval cascade", () => {
    const vault = buildRealisticVault();
    setActiveVault(vault);

    // Rule covers only "tools"
    addStandardRule(vault, logger, {
      id: "rule-partial",
      kind: "standard",
      persona: "work",
      fields: ["tools"],
    });

    // Tier 1: partial approval
    const result1 = simulateAgent("agent-1", vault, config, logger, {
      requestType: "message",
      persona: "work",
      fields: ["tools", "communication_style", "review_preferences"],
      purpose: "full setup",
    });
    expect(result1.decision).toBe("approved"); // partial: tools approved
    expect(result1.approvedFields.tools).toBe("vscode");
    expect(result1.pendingFields).toContain("communication_style");
    expect(result1.pendingFields).toContain("review_preferences");
    expect(result1.approvalId).toBeTruthy();

    // Tier 2: user resolves pending approval -> marks standing rule
    const resolved = resolveApprovalHelper(
      vault,
      logger,
      result1.approvalId!,
      "approved",
      "user",
      true,
    );
    expect(resolved).toBe(true);

    // Create standing rule based on the approval
    addStandardRule(vault, logger, {
      id: "rule-standing",
      kind: "standard",
      persona: "work",
      fields: ["communication_style", "review_preferences"],
    });

    // Tier 3: re-request -> full approval
    const result2 = simulateAgent("agent-1", vault, config, logger, {
      requestType: "message",
      persona: "work",
      fields: ["tools", "communication_style", "review_preferences"],
      purpose: "full setup",
    });
    expect(result2.decision).toBe("approved");
    expect(Object.keys(result2.approvedFields)).toHaveLength(3);
    expect(result2.pendingFields).toHaveLength(0);
    expect(result2.deniedFields).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // 4. Multi-agent compartmentalization
  // -------------------------------------------------------------------------
  it("4. Multi-agent compartmentalization", () => {
    const vault = buildRealisticVault();
    setActiveVault(vault);

    // Agent-scoped rules
    addStandardRule(vault, logger, {
      id: "rule-personal-assistant",
      kind: "standard",
      persona: "personal",
      fields: ["name", "email", "birthday"],
      agentId: "personal-assistant",
    });

    addStandardRule(vault, logger, {
      id: "rule-shopping-bot",
      kind: "standard",
      persona: "shopping",
      fields: ["clothing_size", "shoe_size", "preferred_brands"],
      agentId: "shopping-bot",
    });

    // personal-assistant can access personal
    const paResult = simulateAgent("personal-assistant", vault, config, logger, {
      requestType: "message",
      persona: "personal",
      fields: ["name", "email"],
      purpose: "greet user",
    });
    expect(paResult.decision).toBe("approved");
    expect(paResult.approvedFields.name).toBe("Alice");
    expect(paResult.approvedFields.email).toBe("alice@example.com");

    // shopping-bot can access shopping
    const sbResult = simulateAgent("shopping-bot", vault, config, logger, {
      requestType: "message",
      persona: "shopping",
      fields: ["clothing_size", "preferred_brands"],
      purpose: "recommend outfit",
    });
    expect(sbResult.decision).toBe("approved");
    expect(sbResult.approvedFields.clothing_size).toBe("M");

    // Cross-agent: personal-assistant tries shopping -> pending (no matching rule)
    const crossResult1 = simulateAgent("personal-assistant", vault, config, logger, {
      requestType: "message",
      persona: "shopping",
      fields: ["clothing_size"],
      purpose: "unknown",
    });
    expect(crossResult1.decision).toBe("pending");
    expect(crossResult1.pendingFields).toContain("clothing_size");

    // Cross-agent: shopping-bot tries personal -> pending
    const crossResult2 = simulateAgent("shopping-bot", vault, config, logger, {
      requestType: "message",
      persona: "personal",
      fields: ["name"],
      purpose: "unknown",
    });
    expect(crossResult2.decision).toBe("pending");
    expect(crossResult2.pendingFields).toContain("name");
  });

  // -------------------------------------------------------------------------
  // 5. Posture transitions under load
  // -------------------------------------------------------------------------
  it("5. Posture transitions under load", () => {
    const vault = buildRealisticVault();
    setActiveVault(vault);

    addStandardRule(vault, logger, {
      id: "rule-tools",
      kind: "standard",
      persona: "work",
      fields: ["tools"],
    });

    const makeReq = (): Omit<PersonafyContextRequest, "agentId"> => ({
      requestType: "message",
      persona: "work",
      fields: ["tools", "communication_style"],
      purpose: "test posture",
    });

    // Guarded (default) — tools approved, communication_style pending
    expect(getPosture(vault)).toBe("guarded");
    const r1 = simulateAgent("agent-1", vault, config, logger, makeReq());
    expect(r1.approvedFields.tools).toBe("vscode");
    expect(r1.pendingFields).toContain("communication_style");
    expect(r1.deniedFields).toHaveLength(0);

    // Open — both approved (auto-approve with matching rule)
    setPosture(vault, "open");
    logger.log("[POSTURE]", "Transition: guarded -> open");
    expect(getPosture(vault)).toBe("open");
    expect(isAutoApproveEnabled(vault)).toBe(true);
    const r2 = simulateAgent("agent-1", vault, config, logger, makeReq());
    expect(r2.decision).toBe("approved");
    expect(Object.keys(r2.approvedFields)).toHaveLength(2);
    expect(r2.pendingFields).toHaveLength(0);

    // Locked — everything denied
    setPosture(vault, "locked");
    logger.log("[POSTURE]", "Transition: open -> locked");
    expect(isVaultLocked(vault)).toBe(true);
    const r3 = simulateAgent("agent-1", vault, config, logger, makeReq());
    expect(r3.decision).toBe("denied");
    expect(r3.deniedFields).toEqual(["tools", "communication_style"]);
    expect(Object.keys(r3.approvedFields)).toHaveLength(0);

    // Back to guarded
    setPosture(vault, "guarded");
    logger.log("[POSTURE]", "Transition: locked -> guarded");
    const r4 = simulateAgent("agent-1", vault, config, logger, makeReq());
    expect(r4.approvedFields.tools).toBe("vscode");
    expect(r4.pendingFields).toContain("communication_style");
  });

  // -------------------------------------------------------------------------
  // 6. Heartbeat scheduled rule lifecycle
  // -------------------------------------------------------------------------
  it("6. Heartbeat scheduled rule lifecycle", () => {
    const vault = buildRealisticVault();
    setActiveVault(vault);

    // Create heartbeat rule
    const hbRule = createHeartbeatRule({
      agentId: "monitor-agent",
      heartbeatId: "hb-health",
      persona: "work",
      fields: ["tools", "role"],
      ttlMs: 60_000,
    });
    addScheduledRuleHelper(vault, logger, hbRule);
    expect(vault.scheduledRules).toHaveLength(1);

    // Agent makes heartbeat request -> approved
    const result1 = simulateAgent("monitor-agent", vault, config, logger, {
      requestType: "heartbeat",
      persona: "work",
      fields: ["tools", "role"],
      purpose: "health check",
      sourceId: "hb-health",
    });
    expect(result1.decision).toBe("approved");
    expect(result1.approvedFields.tools).toBe("vscode");
    expect(result1.approvedFields.role).toBe("senior-engineer");

    // Expire the rule (simulated time advance)
    const expired = expireScheduledRules(vault, Date.now() + 120_000);
    logger.log("[MAINTENANCE]", `Expired ${expired} scheduled rules`);
    expect(expired).toBe(1);
    expect(vault.scheduledRules).toHaveLength(0);

    // Same request -> pending (rule gone)
    const result2 = simulateAgent("monitor-agent", vault, config, logger, {
      requestType: "heartbeat",
      persona: "work",
      fields: ["tools"],
      purpose: "health check",
      sourceId: "hb-health",
    });
    expect(result2.decision).toBe("pending");
  });

  // -------------------------------------------------------------------------
  // 7. Cron scheduled rule with time windows and pre-warming
  // -------------------------------------------------------------------------
  it("7. Cron scheduled rule with time windows and pre-warming", () => {
    const vault = buildRealisticVault();
    setActiveVault(vault);

    // Create cron rule with time window covering current hour
    const now = new Date();
    const fromHour = now.getHours();
    const toHour = (fromHour + 2) % 24;
    const fromStr = `${String(fromHour).padStart(2, "0")}:00`;
    const toStr = `${String(toHour).padStart(2, "0")}:00`;

    const cronRule = createCronRule({
      agentId: "cron-agent",
      cronId: "cron-daily",
      persona: "work",
      fields: ["tools", "communication_style"],
      timeWindow: { from: fromStr, to: toStr },
      expiresInDays: 7,
    });
    addScheduledRuleHelper(vault, logger, cronRule);

    // Verify time window matching
    expect(isScheduledRuleActive(cronRule)).toBe(true);
    logger.log("[RULE]", "Cron rule active within time window");

    // Pre-warm context
    const preWarmed = preWarmContext("cron-daily", vault);
    expect(preWarmed).not.toBeNull();
    expect(preWarmed!.cronId).toBe("cron-daily");
    expect(preWarmed!.fields.tools).toBe("vscode");
    expect(preWarmed!.fields.communication_style).toBe("concise");
    logger.log("[SIM]", "Pre-warmed context", preWarmed);

    // Verify cached values
    const cached = getPreWarmedContext("cron-daily");
    expect(cached).not.toBeNull();
    expect(cached!.fields.tools).toBe("vscode");

    // Agent makes cron request -> approved
    const result = simulateAgent("cron-agent", vault, config, logger, {
      requestType: "cron",
      persona: "work",
      fields: ["tools", "communication_style"],
      purpose: "daily report",
      sourceId: "cron-daily",
    });
    expect(result.decision).toBe("approved");

    // Clear cache
    clearPreWarmedContext("cron-daily");
    expect(getPreWarmedContext("cron-daily")).toBeNull();
    logger.log("[SIM]", "Pre-warmed cache cleared");
  });

  // -------------------------------------------------------------------------
  // 8. Expiry and maintenance sweep
  // -------------------------------------------------------------------------
  it("8. Expiry and maintenance sweep", () => {
    const vault = buildRealisticVault();
    setActiveVault(vault);

    const nowMs = Date.now();

    // Enqueue 3 approvals with 1ms expiry
    for (let i = 0; i < 3; i++) {
      enqueueApproval(
        vault,
        {
          agentId: `agent-${i}`,
          requestType: "message",
          persona: "work",
          fields: ["tools"],
          purpose: "test expiry",
        },
        1, // 1ms expiry
      );
    }
    logger.log("[MAINTENANCE]", "Enqueued 3 approvals with 1ms expiry");

    // Add 2 scheduled rules (1 expired, 1 valid)
    vault.scheduledRules.push({
      id: "srl-expired",
      kind: "heartbeat",
      sourceId: "hb-old",
      persona: "work",
      fields: ["tools"],
      expiresAtMs: nowMs - 1000,
      createdAtMs: nowMs - 10000,
    });
    vault.scheduledRules.push({
      id: "srl-valid",
      kind: "heartbeat",
      sourceId: "hb-new",
      persona: "work",
      fields: ["tools"],
      expiresAtMs: nowMs + 60_000,
      createdAtMs: nowMs,
    });

    // Add 7 audit entries (5 old, 2 recent)
    for (let i = 0; i < 5; i++) {
      logAudit(vault, {
        agentId: "agent-old",
        requestType: "message",
        persona: "work",
        fields: ["tools"],
        purpose: "old entry",
        decision: "approved",
      });
      // Backdate the entry
      vault.auditLog[vault.auditLog.length - 1].timestamp = nowMs - 100 * 24 * 60 * 60 * 1000;
    }
    for (let i = 0; i < 2; i++) {
      logAudit(vault, {
        agentId: "agent-new",
        requestType: "message",
        persona: "work",
        fields: ["tools"],
        purpose: "recent entry",
        decision: "approved",
      });
    }
    logger.log("[MAINTENANCE]", "Set up 7 audit entries (5 old, 2 recent)");

    // Run maintenance: expire approvals
    // Wait a tick for the 1ms approvals to expire
    const expiredApprovals = expireStaleApprovals(vault, nowMs + 10);
    logger.log("[MAINTENANCE]", `Expired ${expiredApprovals} approvals`);
    expect(expiredApprovals).toBe(3);

    // Expire scheduled rules
    const expiredRules = expireScheduledRules(vault, nowMs);
    logger.log("[MAINTENANCE]", `Expired ${expiredRules} scheduled rules`);
    expect(expiredRules).toBe(1);
    expect(vault.scheduledRules).toHaveLength(1);
    expect(vault.scheduledRules[0].id).toBe("srl-valid");

    // Prune audit log (90 day retention)
    const prunedAudit = pruneAuditLog(vault, 90 * 24 * 60 * 60 * 1000);
    logger.log("[MAINTENANCE]", `Pruned ${prunedAudit} audit entries`);
    expect(prunedAudit).toBe(5);
    expect(vault.auditLog).toHaveLength(2);

    // Prune resolved approvals
    const prunedApprovals = pruneResolvedApprovals(vault, 0);
    logger.log("[MAINTENANCE]", `Pruned ${prunedApprovals} resolved approvals`);
    expect(prunedApprovals).toBe(3);
  });

  // -------------------------------------------------------------------------
  // 9. Audit correlation across multi-agent workflows
  // -------------------------------------------------------------------------
  it("9. Audit correlation across multi-agent workflows", () => {
    const vault = buildRealisticVault();
    setActiveVault(vault);

    const correlationId = "workflow-multi-agent-42";

    // 3 agents share a correlationId
    addStandardRule(vault, logger, {
      id: "rule-all-work",
      kind: "standard",
      persona: "work",
      fields: ["tools", "communication_style", "role"],
    });

    const agents = ["agent-alpha", "agent-beta", "agent-gamma"];
    for (const agentId of agents) {
      simulateAgent(agentId, vault, config, logger, {
        requestType: "message",
        persona: "work",
        fields: ["tools"],
        purpose: "workflow step",
        correlationId,
      });
    }

    // Query by correlationId -> 3 entries
    const correlated = correlateAuditEntries(vault, correlationId);
    expect(correlated).toHaveLength(3);

    // Query by agentId -> 1 entry each
    for (const agentId of agents) {
      const agentEntries = getAuditLog(vault, { agentId });
      expect(agentEntries).toHaveLength(1);
      expect(agentEntries[0].correlationId).toBe(correlationId);
    }

    // All entries have distinct IDs
    const ids = new Set(correlated.map((e) => e.id));
    expect(ids.size).toBe(3);
  });

  // -------------------------------------------------------------------------
  // 10. Chaos scenario (deterministic randomized operations)
  // -------------------------------------------------------------------------
  it("10. Chaos scenario (deterministic randomized operations)", () => {
    const vault = buildRealisticVault();
    setActiveVault(vault);
    const rand = mulberry32(42);

    const agents = ["chaos-0", "chaos-1", "chaos-2", "chaos-3", "chaos-4", "chaos-5", "chaos-6", "chaos-7"];
    const personas = ["work", "personal", "shopping"];
    const allFields: Record<string, string[]> = {
      work: ["tools", "communication_style", "review_preferences", "timezone", "role"],
      personal: ["name", "email", "birthday", "hobbies", "dietary_preferences"],
      shopping: ["clothing_size", "shoe_size", "preferred_brands", "shipping_address", "payment_method"],
    };

    // Weighted operation pool
    const ops = [
      ...Array(30).fill("request_context"),
      ...Array(10).fill("add_rule"),
      ...Array(5).fill("remove_rule"),
      ...Array(15).fill("resolve_approval"),
      ...Array(10).fill("change_posture"),
      ...Array(10).fill("add_scheduled_rule"),
      ...Array(5).fill("expire_rules"),
      ...Array(5).fill("expire_approvals"),
      ...Array(5).fill("prune_audit"),
      ...Array(5).fill("pre_warm"),
    ] as string[];

    let ruleCounter = 0;
    let invariantChecks = 0;

    const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];
    const pickFields = (persona: string): string[] => {
      const fields = allFields[persona];
      const count = Math.floor(rand() * fields.length) + 1;
      const shuffled = [...fields].sort(() => rand() - 0.5);
      return shuffled.slice(0, count);
    };

    const checkInvariants = (opIndex: number, opType: string) => {
      // Vault consistency
      expect(vault.version).toBe(1);
      invariantChecks++;

      // Posture is valid
      expect(["open", "guarded", "locked"]).toContain(vault.posture);
      invariantChecks++;

      // No duplicate rule IDs
      const ruleIds = new Set(vault.rules.map((r) => r.id));
      expect(ruleIds.size).toBe(vault.rules.length);
      invariantChecks++;

      // No duplicate scheduled rule IDs
      const srlIds = new Set(vault.scheduledRules.map((r) => r.id));
      expect(srlIds.size).toBe(vault.scheduledRules.length);
      invariantChecks++;

      // All approval statuses are valid
      for (const apv of vault.approvalQueue) {
        expect(["pending", "approved", "denied", "expired"]).toContain(apv.status);
        invariantChecks++;
      }

      // All audit entries have IDs
      for (const aud of vault.auditLog) {
        expect(aud.id).toBeTruthy();
        invariantChecks++;
      }
    };

    for (let i = 0; i < 200; i++) {
      const opType = pick(ops);
      const agent = pick(agents);
      const persona = pick(personas);

      logger.log("[CHAOS]", `Replay: op=${i} type=${opType}`, { agent, persona });

      switch (opType) {
        case "request_context": {
          const fields = pickFields(persona);
          simulateAgent(agent, vault, config, logger, {
            requestType: pick(["message", "heartbeat", "cron"] as const),
            persona,
            fields,
            purpose: `chaos-op-${i}`,
            sourceId: rand() > 0.5 ? `src-${Math.floor(rand() * 10)}` : undefined,
          });
          break;
        }
        case "add_rule": {
          ruleCounter++;
          addStandardRule(vault, logger, {
            id: `chaos-rule-${ruleCounter}`,
            kind: "standard",
            persona,
            fields: pickFields(persona),
            agentId: rand() > 0.5 ? agent : undefined,
          });
          break;
        }
        case "remove_rule": {
          if (vault.rules.length > 0) {
            const rule = pick(vault.rules);
            vault.rules = vault.rules.filter((r) => r.id !== rule.id);
            logger.log("[RULE]", `Removed rule ${rule.id}`);
          }
          break;
        }
        case "resolve_approval": {
          const pending = getPendingApprovals(vault);
          if (pending.length > 0) {
            const apv = pick(pending);
            resolveApprovalHelper(
              vault,
              logger,
              apv.id,
              rand() > 0.3 ? "approved" : "denied",
              "chaos-user",
            );
          }
          break;
        }
        case "change_posture": {
          const postures: PersonafyPosture[] = ["open", "guarded", "locked"];
          const newPosture = pick(postures);
          const oldPosture = vault.posture;
          setPosture(vault, newPosture);
          logger.log("[POSTURE]", `${oldPosture} -> ${newPosture}`);
          break;
        }
        case "add_scheduled_rule": {
          ruleCounter++;
          const kind = rand() > 0.5 ? "heartbeat" : "cron";
          if (kind === "heartbeat") {
            addScheduledRuleHelper(
              vault,
              logger,
              createHeartbeatRule({
                agentId: agent,
                heartbeatId: `hb-chaos-${ruleCounter}`,
                persona,
                fields: pickFields(persona),
                ttlMs: Math.floor(rand() * 120_000) + 1000,
              }),
            );
          } else {
            addScheduledRuleHelper(
              vault,
              logger,
              createCronRule({
                agentId: agent,
                cronId: `cron-chaos-${ruleCounter}`,
                persona,
                fields: pickFields(persona),
                expiresInDays: Math.floor(rand() * 30) + 1,
              }),
            );
          }
          break;
        }
        case "expire_rules": {
          const futureMs = Date.now() + Math.floor(rand() * 200_000);
          const count = expireScheduledRules(vault, futureMs);
          logger.log("[MAINTENANCE]", `Expired ${count} scheduled rules`);
          break;
        }
        case "expire_approvals": {
          const futureMs = Date.now() + Math.floor(rand() * 200_000);
          const count = expireStaleApprovals(vault, futureMs);
          logger.log("[MAINTENANCE]", `Expired ${count} approvals`);
          break;
        }
        case "prune_audit": {
          const count = pruneAuditLog(vault, Math.floor(rand() * 100) * 24 * 60 * 60 * 1000);
          logger.log("[MAINTENANCE]", `Pruned ${count} audit entries`);
          break;
        }
        case "pre_warm": {
          const cronRules = listScheduledRules(vault, { type: "cron" });
          if (cronRules.length > 0) {
            const rule = pick(cronRules);
            const pw = preWarmContext(rule.sourceId, vault);
            logger.log("[SIM]", `Pre-warmed ${rule.sourceId}`, pw ? "ok" : "no match");
          }
          break;
        }
      }

      checkInvariants(i, opType);
    }

    logger.log("[CHAOS]", `Completed 200 operations, ${invariantChecks} invariant checks`);

    // Final assertions
    expect(invariantChecks).toBeGreaterThan(200 * 4); // At least 4 per op (some have more)
    expect(vault.version).toBe(1);
    expect(["open", "guarded", "locked"]).toContain(vault.posture);

    // Audit log should have entries from request_context ops
    expect(vault.auditLog.length).toBeGreaterThan(0);

    // All persona data intact
    expect(vault.personas.work).toBeDefined();
    expect(vault.personas.personal).toBeDefined();
    expect(vault.personas.shopping).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // 11. Multi-cycle iterative stress test
  // -------------------------------------------------------------------------
  it("11. Multi-cycle iterative stress test", () => {
    const vault = buildRealisticVault();
    setActiveVault(vault);
    logger.log("[SIM]", "Starting multi-cycle stress test");

    // ---- Cycle 1: Setup ----
    logger.log("[SIM]", "Cycle 1: Setup");
    addStandardRule(vault, logger, {
      id: "stress-rule-1",
      kind: "standard",
      persona: "work",
      fields: ["tools", "communication_style"],
    });
    addStandardRule(vault, logger, {
      id: "stress-rule-2",
      kind: "standard",
      persona: "personal",
      fields: ["name"],
      agentId: "stress-agent-1",
    });

    const c1r1 = simulateAgent("stress-agent-1", vault, config, logger, {
      requestType: "message",
      persona: "work",
      fields: ["tools", "communication_style", "review_preferences"],
      purpose: "stress cycle 1",
    });
    expect(c1r1.approvedFields.tools).toBe("vscode");
    expect(c1r1.approvedFields.communication_style).toBe("concise");
    expect(c1r1.pendingFields).toContain("review_preferences");

    const c1r2 = simulateAgent("stress-agent-1", vault, config, logger, {
      requestType: "message",
      persona: "personal",
      fields: ["name", "email"],
      purpose: "stress cycle 1",
    });
    expect(c1r2.approvedFields.name).toBe("Alice");
    expect(c1r2.pendingFields).toContain("email");

    // ---- Cycle 2: Approval ----
    logger.log("[SIM]", "Cycle 2: Approval resolution");
    const pending = getPendingApprovals(vault);
    expect(pending.length).toBeGreaterThanOrEqual(2);

    for (const apv of pending) {
      resolveApprovalHelper(vault, logger, apv.id, "approved", "stress-user", true);
    }

    // Create standing rules from approvals
    addStandardRule(vault, logger, {
      id: "stress-standing-1",
      kind: "standard",
      persona: "work",
      fields: ["review_preferences"],
    });
    addStandardRule(vault, logger, {
      id: "stress-standing-2",
      kind: "standard",
      persona: "personal",
      fields: ["email"],
      agentId: "stress-agent-1",
    });

    // Verify all pending resolved
    expect(getPendingApprovals(vault)).toHaveLength(0);

    // ---- Cycle 3: Posture stress ----
    logger.log("[SIM]", "Cycle 3: Posture stress");
    const postureSequence: PersonafyPosture[] = [
      "open",
      "guarded",
      "locked",
      "open",
      "locked",
      "guarded",
    ];

    for (const posture of postureSequence) {
      setPosture(vault, posture);
      logger.log("[POSTURE]", `Stress transition -> ${posture}`);

      const result = simulateAgent("stress-agent-1", vault, config, logger, {
        requestType: "message",
        persona: "work",
        fields: ["tools"],
        purpose: "posture stress",
      });

      if (posture === "locked") {
        expect(result.decision).toBe("denied");
      } else {
        // Both open and guarded should approve tools (rule exists)
        expect(result.approvedFields.tools).toBe("vscode");
      }
    }

    // ---- Cycle 4: Scheduled operations ----
    logger.log("[SIM]", "Cycle 4: Scheduled operations");
    setPosture(vault, "guarded");

    const hbRule = createHeartbeatRule({
      agentId: "stress-agent-2",
      heartbeatId: "hb-stress",
      persona: "work",
      fields: ["tools", "role"],
      ttlMs: 300_000,
    });
    addScheduledRuleHelper(vault, logger, hbRule);

    // Pre-warm
    const cronRule = createCronRule({
      agentId: "stress-agent-2",
      cronId: "cron-stress",
      persona: "work",
      fields: ["communication_style"],
      expiresInDays: 1,
    });
    addScheduledRuleHelper(vault, logger, cronRule);

    const preWarmed = preWarmContext("cron-stress", vault);
    expect(preWarmed).not.toBeNull();
    expect(preWarmed!.fields.communication_style).toBe("concise");

    // Heartbeat request
    const hbResult = simulateAgent("stress-agent-2", vault, config, logger, {
      requestType: "heartbeat",
      persona: "work",
      fields: ["tools", "role"],
      purpose: "stress heartbeat",
      sourceId: "hb-stress",
    });
    expect(hbResult.decision).toBe("approved");

    // ---- Cycle 5: Maintenance ----
    logger.log("[SIM]", "Cycle 5: Maintenance sweep");
    // Expire some things with future time
    const expRules = expireScheduledRules(vault, Date.now() + 400_000);
    logger.log("[MAINTENANCE]", `Expired ${expRules} scheduled rules`);

    const expApprovals = expireStaleApprovals(vault, Date.now() + 100 * 24 * 60 * 60 * 1000);
    logger.log("[MAINTENANCE]", `Expired ${expApprovals} stale approvals`);

    const pruned = pruneAuditLog(vault, 1); // 1ms retention = prune almost everything
    logger.log("[MAINTENANCE]", `Pruned ${pruned} audit entries`);

    // ---- Cycle 6: Regression ----
    logger.log("[SIM]", "Cycle 6: Regression checks");
    setPosture(vault, "guarded");

    // Re-run cycle 1 style requests: should now be fully approved (standing rules exist)
    const c6r1 = simulateAgent("stress-agent-1", vault, config, logger, {
      requestType: "message",
      persona: "work",
      fields: ["tools", "communication_style", "review_preferences"],
      purpose: "regression test",
    });
    expect(c6r1.decision).toBe("approved");
    expect(Object.keys(c6r1.approvedFields)).toHaveLength(3);
    expect(c6r1.pendingFields).toHaveLength(0);

    const c6r2 = simulateAgent("stress-agent-1", vault, config, logger, {
      requestType: "message",
      persona: "personal",
      fields: ["name", "email"],
      purpose: "regression test",
    });
    expect(c6r2.decision).toBe("approved");
    expect(c6r2.approvedFields.name).toBe("Alice");
    expect(c6r2.approvedFields.email).toBe("alice@example.com");

    // Fact fallback still works
    const editorVal = getFieldValue(vault, "work", "editor");
    expect(editorVal).toBe("vim");
    const osVal = getFieldValue(vault, "work", "os");
    expect(osVal).toBe("linux");

    logger.log("[SIM]", "All 6 cycles completed successfully");
  });

  // -------------------------------------------------------------------------
  // 12. Edge case: empty fields, missing personas, fact-only lookups
  // -------------------------------------------------------------------------
  it("12. Edge cases: empty fields, missing personas, fact-only lookups", () => {
    const vault = buildRealisticVault();
    setActiveVault(vault);

    // Request with empty fields array
    const r1 = simulateAgent("edge-agent", vault, config, logger, {
      requestType: "message",
      persona: "work",
      fields: [],
      purpose: "empty fields edge case",
    });
    expect(r1.decision).toBe("approved"); // no fields to approve = approved
    expect(Object.keys(r1.approvedFields)).toHaveLength(0);
    expect(r1.pendingFields).toHaveLength(0);

    // Request non-existent persona (fields won't resolve to values)
    const r2 = simulateAgent("edge-agent", vault, config, logger, {
      requestType: "message",
      persona: "nonexistent",
      fields: ["something"],
      purpose: "missing persona edge case",
    });
    expect(r2.decision).toBe("pending");
    expect(r2.pendingFields).toContain("something");

    // Fact-only field lookup (editor and os are facts, not persona fields)
    addStandardRule(vault, logger, {
      id: "rule-facts",
      kind: "standard",
      persona: "work",
      fields: ["editor", "os"],
    });
    const r3 = simulateAgent("edge-agent", vault, config, logger, {
      requestType: "message",
      persona: "work",
      fields: ["editor", "os"],
      purpose: "fact fallback test",
    });
    expect(r3.decision).toBe("approved");
    expect(r3.approvedFields.editor).toBe("vim");
    expect(r3.approvedFields.os).toBe("linux");

    // Request a field that exists nowhere (not in persona, not in facts)
    addStandardRule(vault, logger, {
      id: "rule-phantom",
      kind: "standard",
      persona: "work",
      fields: ["phantom_field"],
    });
    const r4 = simulateAgent("edge-agent", vault, config, logger, {
      requestType: "message",
      persona: "work",
      fields: ["phantom_field"],
      purpose: "phantom field test",
    });
    expect(r4.decision).toBe("approved");
    // Field is approved by rule but has no value in vault
    expect(r4.approvedFields.phantom_field).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // 13. Double-resolve and stale approval handling
  // -------------------------------------------------------------------------
  it("13. Double-resolve and stale approval handling", () => {
    const vault = buildRealisticVault();
    setActiveVault(vault);

    // Create an approval
    const result = simulateAgent("dbl-agent", vault, config, logger, {
      requestType: "message",
      persona: "work",
      fields: ["tools"],
      purpose: "double resolve test",
    });
    expect(result.approvalId).toBeTruthy();

    // First resolve succeeds
    const ok1 = resolveApprovalHelper(vault, logger, result.approvalId!, "approved", "user");
    expect(ok1).toBe(true);

    // Second resolve fails (already resolved)
    const ok2 = resolveApprovalHelper(vault, logger, result.approvalId!, "denied", "user");
    expect(ok2).toBe(false);

    // Resolve non-existent ID
    const ok3 = resolveApprovalHelper(vault, logger, "apv_nonexistent", "approved", "user");
    expect(ok3).toBe(false);

    // Verify the approval kept its first resolution
    const apv = getApprovalById(vault, result.approvalId!);
    expect(apv).toBeDefined();
    expect(apv!.status).toBe("approved");
  });

  // -------------------------------------------------------------------------
  // 14. Purpose pattern matching edge cases
  // -------------------------------------------------------------------------
  it("14. Purpose pattern matching edge cases", () => {
    const vault = buildRealisticVault();
    setActiveVault(vault);

    // Rule with purpose pattern
    addStandardRule(vault, logger, {
      id: "rule-purpose",
      kind: "standard",
      persona: "work",
      fields: ["tools", "communication_style"],
      purposePattern: "coding",
    });

    // Matching purpose (case-insensitive)
    const r1 = simulateAgent("purpose-agent", vault, config, logger, {
      requestType: "message",
      persona: "work",
      fields: ["tools"],
      purpose: "Help with CODING tasks",
    });
    expect(r1.decision).toBe("approved");

    // Non-matching purpose
    const r2 = simulateAgent("purpose-agent", vault, config, logger, {
      requestType: "message",
      persona: "work",
      fields: ["tools"],
      purpose: "shopping assistance",
    });
    expect(r2.decision).toBe("pending");

    // Partial match
    const r3 = simulateAgent("purpose-agent", vault, config, logger, {
      requestType: "message",
      persona: "work",
      fields: ["tools"],
      purpose: "pair-coding session",
    });
    expect(r3.decision).toBe("approved");
  });

  // -------------------------------------------------------------------------
  // 15. Rapid posture cycling with approval queue integrity
  // -------------------------------------------------------------------------
  it("15. Rapid posture cycling with approval queue integrity", () => {
    const vault = buildRealisticVault();
    setActiveVault(vault);

    // Create some pending approvals in guarded mode
    const results: PersonafyContextResult[] = [];
    for (let i = 0; i < 10; i++) {
      const r = simulateAgent(`rapid-${i}`, vault, config, logger, {
        requestType: "message",
        persona: "work",
        fields: ["tools"],
        purpose: `rapid posture test ${i}`,
      });
      results.push(r);
    }

    const initialPending = getPendingApprovals(vault).length;
    expect(initialPending).toBe(10);

    // Rapid posture cycling should not affect existing approvals
    for (let i = 0; i < 50; i++) {
      const postures: PersonafyPosture[] = ["open", "guarded", "locked"];
      setPosture(vault, postures[i % 3]);
    }

    // Approvals should still be there and still pending
    expect(getPendingApprovals(vault)).toHaveLength(10);

    // Resolve all and verify
    for (const r of results) {
      if (r.approvalId) {
        resolveApprovalHelper(vault, logger, r.approvalId, "approved", "user");
      }
    }
    expect(getPendingApprovals(vault)).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // 16. Scheduled rule time window boundary tests
  // -------------------------------------------------------------------------
  it("16. Scheduled rule time window boundary tests", () => {
    const vault = buildRealisticVault();
    setActiveVault(vault);

    // Rule with narrow time window: 09:00-09:01
    const narrowRule = createCronRule({
      agentId: "time-agent",
      cronId: "cron-narrow",
      persona: "work",
      fields: ["tools"],
      timeWindow: { from: "09:00", to: "09:01" },
      expiresInDays: 30,
    });
    addScheduledRuleHelper(vault, logger, narrowRule);

    // Test at 09:00 -> should be active
    const at0900 = new Date();
    at0900.setHours(9, 0, 0, 0);
    expect(isScheduledRuleActive(narrowRule, at0900.getTime())).toBe(true);

    // Test at 09:01 -> should be active (inclusive)
    const at0901 = new Date();
    at0901.setHours(9, 1, 0, 0);
    expect(isScheduledRuleActive(narrowRule, at0901.getTime())).toBe(true);

    // Test at 09:02 -> should be inactive
    const at0902 = new Date();
    at0902.setHours(9, 2, 0, 0);
    expect(isScheduledRuleActive(narrowRule, at0902.getTime())).toBe(false);

    // Midnight-crossing window: 23:00 to 01:00
    const midnightRule = createCronRule({
      agentId: "time-agent",
      cronId: "cron-midnight",
      persona: "work",
      fields: ["tools"],
      timeWindow: { from: "23:00", to: "01:00" },
      expiresInDays: 30,
    });

    // At 23:30 -> active
    const at2330 = new Date();
    at2330.setHours(23, 30, 0, 0);
    expect(isScheduledRuleActive(midnightRule, at2330.getTime())).toBe(true);

    // At 00:30 -> active (past midnight)
    const at0030 = new Date();
    at0030.setHours(0, 30, 0, 0);
    expect(isScheduledRuleActive(midnightRule, at0030.getTime())).toBe(true);

    // At 02:00 -> inactive
    const at0200 = new Date();
    at0200.setHours(2, 0, 0, 0);
    expect(isScheduledRuleActive(midnightRule, at0200.getTime())).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 17. Heavy chaos: 500 ops, seed 1337, deeper invariants
  // -------------------------------------------------------------------------
  it("17. Heavy chaos: 500 ops with deeper invariants", () => {
    const vault = buildRealisticVault();
    setActiveVault(vault);
    const rand = mulberry32(1337);

    const agents = Array.from({ length: 12 }, (_, i) => `heavy-${i}`);
    const personas = ["work", "personal", "shopping"];
    const allFields: Record<string, string[]> = {
      work: ["tools", "communication_style", "review_preferences", "timezone", "role"],
      personal: ["name", "email", "birthday", "hobbies", "dietary_preferences"],
      shopping: ["clothing_size", "shoe_size", "preferred_brands", "shipping_address", "payment_method"],
    };

    const ops = [
      ...Array(35).fill("request_context"),
      ...Array(12).fill("add_rule"),
      ...Array(8).fill("remove_rule"),
      ...Array(15).fill("resolve_approval"),
      ...Array(8).fill("change_posture"),
      ...Array(8).fill("add_scheduled_rule"),
      ...Array(4).fill("expire_rules"),
      ...Array(4).fill("expire_approvals"),
      ...Array(3).fill("prune_audit"),
      ...Array(3).fill("pre_warm"),
    ] as string[];

    let ruleCounter = 0;
    const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];
    const pickFields = (persona: string): string[] => {
      const fields = allFields[persona];
      const count = Math.floor(rand() * fields.length) + 1;
      return [...fields].sort(() => rand() - 0.5).slice(0, count);
    };

    // Track some metrics for final assertions
    let totalRequests = 0;
    let totalRulesAdded = 0;
    let totalApprovalsResolved = 0;

    for (let i = 0; i < 500; i++) {
      const opType = pick(ops);
      const agent = pick(agents);
      const persona = pick(personas);

      switch (opType) {
        case "request_context": {
          totalRequests++;
          simulateAgent(agent, vault, config, logger, {
            requestType: pick(["message", "heartbeat", "cron"] as const),
            persona,
            fields: pickFields(persona),
            purpose: `heavy-${i}`,
            sourceId: rand() > 0.5 ? `src-${Math.floor(rand() * 5)}` : undefined,
            correlationId: rand() > 0.7 ? `corr-${Math.floor(rand() * 3)}` : undefined,
          });
          break;
        }
        case "add_rule": {
          totalRulesAdded++;
          ruleCounter++;
          vault.rules.push({
            id: `heavy-rule-${ruleCounter}`,
            kind: "standard",
            persona,
            fields: pickFields(persona),
            agentId: rand() > 0.5 ? agent : undefined,
            purposePattern: rand() > 0.7 ? `heavy` : undefined,
            createdAtMs: Date.now(),
          });
          break;
        }
        case "remove_rule": {
          if (vault.rules.length > 0) {
            vault.rules.splice(Math.floor(rand() * vault.rules.length), 1);
          }
          break;
        }
        case "resolve_approval": {
          const pending = getPendingApprovals(vault);
          if (pending.length > 0) {
            totalApprovalsResolved++;
            resolveApproval(vault, pick(pending).id, rand() > 0.3 ? "approved" : "denied");
          }
          break;
        }
        case "change_posture": {
          setPosture(vault, pick(["open", "guarded", "locked"] as PersonafyPosture[]));
          break;
        }
        case "add_scheduled_rule": {
          ruleCounter++;
          const rule =
            rand() > 0.5
              ? createHeartbeatRule({
                  agentId: agent,
                  heartbeatId: `hb-heavy-${ruleCounter}`,
                  persona,
                  fields: pickFields(persona),
                  ttlMs: Math.floor(rand() * 60_000) + 1000,
                })
              : createCronRule({
                  agentId: agent,
                  cronId: `cron-heavy-${ruleCounter}`,
                  persona,
                  fields: pickFields(persona),
                  expiresInDays: Math.floor(rand() * 7) + 1,
                });
          addScheduledRule(vault, rule);
          break;
        }
        case "expire_rules": {
          expireScheduledRules(vault, Date.now() + Math.floor(rand() * 100_000));
          break;
        }
        case "expire_approvals": {
          expireStaleApprovals(vault, Date.now() + Math.floor(rand() * 100_000));
          break;
        }
        case "prune_audit": {
          pruneAuditLog(vault, Math.floor(rand() * 50) * 24 * 60 * 60 * 1000);
          break;
        }
        case "pre_warm": {
          const cronRules = listScheduledRules(vault, { type: "cron" });
          if (cronRules.length > 0) {
            preWarmContext(pick(cronRules).sourceId, vault);
          }
          break;
        }
      }

      // Deep invariants every 50 ops
      if (i % 50 === 0) {
        // All approval queue entries reference valid request shapes
        for (const apv of vault.approvalQueue) {
          expect(apv.request).toBeDefined();
          expect(apv.request.agentId).toBeTruthy();
          expect(apv.request.persona).toBeTruthy();
          expect(Array.isArray(apv.request.fields)).toBe(true);
        }
        // All audit entries have valid decisions
        for (const aud of vault.auditLog) {
          expect(["approved", "denied", "pending"]).toContain(aud.decision);
        }
        // Persona data integrity
        for (const pid of Object.keys(vault.personas)) {
          expect(vault.personas[pid].id).toBe(pid);
          expect(typeof vault.personas[pid].label).toBe("string");
        }
      }
    }

    // Final assertions
    expect(totalRequests).toBeGreaterThan(100);
    expect(vault.version).toBe(1);
    expect(Object.keys(vault.personas)).toHaveLength(3);

    // No duplicate approval IDs
    const apvIds = vault.approvalQueue.map((a) => a.id);
    expect(new Set(apvIds).size).toBe(apvIds.length);

    logger.log("[CHAOS]", "Heavy chaos completed", {
      totalRequests,
      totalRulesAdded,
      totalApprovalsResolved,
      finalRules: vault.rules.length,
      finalScheduledRules: vault.scheduledRules.length,
      finalApprovals: vault.approvalQueue.length,
      finalAuditEntries: vault.auditLog.length,
    });
  });
});
