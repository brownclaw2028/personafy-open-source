import crypto from "node:crypto";
import type {
  PersonafyVault,
  PersonafyPluginConfig,
  PersonafyContextRequest,
  PersonafyRule,
  PersonafyPosture,
} from "./types.js";
import { resolveApproval, getPendingApprovals } from "./approval-queue.js";
import { requestContext } from "./context-engine.js";
import { setPosture, getPosture } from "./posture.js";
import { createHeartbeatRule, addScheduledRule, expireScheduledRules } from "./scheduled-rules.js";
import { DEFAULT_PERSONAFY_CONFIG } from "./types.js";
import { createEmptyVault, setPersona, addFact, getFieldValues } from "./vault.js";

// =============================================================================
// Types
// =============================================================================

export type DemoStep = {
  stepNumber: number;
  label: string;
  action: string;
  input: Record<string, unknown>;
  result: Record<string, unknown>;
  highlight: string;
};

export type DemoScenarioResult = {
  scenarioId: string;
  title: string;
  description: string;
  steps: DemoStep[];
  summary: { totalSteps: number; approved: number; pending: number; denied: number };
};

export type DemoScenarioInfo = {
  id: string;
  title: string;
  description: string;
  stepCount: number;
};

export type DemoActionResult = {
  ok: boolean;
  action: string;
  result: Record<string, unknown>;
  error?: string;
};

type DemoSession = {
  vault: PersonafyVault;
  config: PersonafyPluginConfig;
  createdAt: number;
};

// =============================================================================
// Session Management
// =============================================================================

const sessions = new Map<string, DemoSession>();
const MAX_SESSIONS = 50;
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

function cleanExpiredSessions(): void {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.createdAt > SESSION_TTL_MS) {
      sessions.delete(id);
    }
  }
}

export function getOrCreateSession(sessionId: string): DemoSession {
  cleanExpiredSessions();

  const existing = sessions.get(sessionId);
  if (existing) {
    return existing;
  }

  if (sessions.size >= MAX_SESSIONS) {
    // Evict oldest session
    let oldestId: string | null = null;
    let oldestTime = Infinity;
    for (const [id, session] of sessions) {
      if (session.createdAt < oldestTime) {
        oldestTime = session.createdAt;
        oldestId = id;
      }
    }
    if (oldestId) sessions.delete(oldestId);
  }

  const session: DemoSession = {
    vault: createDemoVault(),
    config: { ...DEFAULT_PERSONAFY_CONFIG },
    createdAt: Date.now(),
  };
  sessions.set(sessionId, session);
  return session;
}

export function getSessionCount(): number {
  cleanExpiredSessions();
  return sessions.size;
}

/** Exposed for testing only */
export function clearAllSessions(): void {
  sessions.clear();
}

// =============================================================================
// Demo Vault
// =============================================================================

export function createDemoVault(): PersonafyVault {
  const vault = createEmptyVault("guarded");

  // --- Persona: work ---
  setPersona(vault, "work", "Work", {
    tools: "vscode",
    communication_style: "concise",
    review_preferences: "thorough",
    timezone: "America/New_York",
    role: "senior-engineer",
  });
  addFact(vault, "work", "editor", "vim");
  addFact(vault, "work", "os", "linux");

  // --- Persona: personal ---
  setPersona(vault, "personal", "Personal", {
    name: "Alex",
    email: "alex@example.com",
    birthday: "1992-06-15",
    hobbies: "hiking/photography",
    dietary_preferences: "vegetarian",
  });

  // --- Persona: shopping ---
  setPersona(vault, "shopping", "Shopping", {
    clothing_size: "M",
    shoe_size: "10",
    preferred_brands: "Patagonia/Allbirds",
    shipping_address: "742 Evergreen Terrace",
    payment_method: "visa-4242",
  });

  // --- Starter rules ---
  vault.rules.push({
    id: "rule-demo-work",
    kind: "standard",
    persona: "work",
    fields: ["tools", "communication_style"],
    createdAtMs: Date.now(),
  });

  vault.rules.push({
    id: "rule-demo-personal",
    kind: "standard",
    persona: "personal",
    fields: ["name"],
    agentId: "personal-assistant",
    createdAtMs: Date.now(),
  });

  return vault;
}

// =============================================================================
// Scenarios
// =============================================================================

type ScenarioDef = {
  id: string;
  title: string;
  description: string;
  run: (vault: PersonafyVault, config: PersonafyPluginConfig) => DemoStep[];
};

function buildSummary(steps: DemoStep[]): DemoScenarioResult["summary"] {
  let approved = 0;
  let pending = 0;
  let denied = 0;
  for (const step of steps) {
    const d = step.result.decision as string | undefined;
    if (d === "approved") approved++;
    else if (d === "pending") pending++;
    else if (d === "denied") denied++;
  }
  return { totalSteps: steps.length, approved, pending, denied };
}

// ── Scenario 1: basic-approval ──────────────────────────────────────────

function runBasicApproval(vault: PersonafyVault, config: PersonafyPluginConfig): DemoStep[] {
  const steps: DemoStep[] = [];
  let stepNum = 0;

  // Step 1: Request covered fields (approved)
  const req1: PersonafyContextRequest = {
    agentId: "coder",
    requestType: "message",
    persona: "work",
    fields: ["tools", "communication_style"],
    purpose: "help with coding",
  };
  const res1 = requestContext(req1, vault, config);
  steps.push({
    stepNumber: ++stepNum,
    label: "Agent 'coder' requests work.tools + communication_style",
    action: "request_context",
    input: req1 as unknown as Record<string, unknown>,
    result: res1 as unknown as Record<string, unknown>,
    highlight: "Approved! Rule matched tools + communication_style",
  });

  // Step 2: Request uncovered field (pending)
  const req2: PersonafyContextRequest = {
    agentId: "coder",
    requestType: "message",
    persona: "work",
    fields: ["review_preferences"],
    purpose: "check code review style",
  };
  const res2 = requestContext(req2, vault, config);
  steps.push({
    stepNumber: ++stepNum,
    label: "Agent 'coder' requests work.review_preferences",
    action: "request_context",
    input: req2 as unknown as Record<string, unknown>,
    result: res2 as unknown as Record<string, unknown>,
    highlight: "Pending! No rule covers review_preferences — queued for approval",
  });

  // Step 3: User approves with standing rule
  const approvalId = res2.approvalId!;
  resolveApproval(vault, approvalId, "approved", "demo-user", true);
  // Add a standing rule for the newly approved field
  vault.rules.push({
    id: `rule-standing-${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`,
    kind: "standard",
    persona: "work",
    fields: ["review_preferences"],
    createdAtMs: Date.now(),
  });
  steps.push({
    stepNumber: ++stepNum,
    label: "User approves pending request + creates standing rule",
    action: "resolve_approval",
    input: { approvalId, decision: "approved", createStandingRule: true },
    result: { resolved: true },
    highlight: "Approved with standing rule — future requests auto-approved",
  });

  // Step 4: Re-request succeeds immediately
  const req4: PersonafyContextRequest = {
    agentId: "coder",
    requestType: "message",
    persona: "work",
    fields: ["review_preferences"],
    purpose: "check code review style",
  };
  const res4 = requestContext(req4, vault, config);
  steps.push({
    stepNumber: ++stepNum,
    label: "Agent 'coder' re-requests work.review_preferences",
    action: "request_context",
    input: req4 as unknown as Record<string, unknown>,
    result: res4 as unknown as Record<string, unknown>,
    highlight: "Approved instantly! Standing rule now covers this field",
  });

  return steps;
}

// ── Scenario 2: posture-showcase ────────────────────────────────────────

function runPostureShowcase(vault: PersonafyVault, config: PersonafyPluginConfig): DemoStep[] {
  const steps: DemoStep[] = [];
  let stepNum = 0;

  const baseReq: PersonafyContextRequest = {
    agentId: "demo-agent",
    requestType: "message",
    persona: "work",
    fields: ["tools", "communication_style", "timezone"],
    purpose: "workspace setup",
  };

  // Step 1: Guarded (default) — partial approval
  const res1 = requestContext({ ...baseReq }, vault, config);
  steps.push({
    stepNumber: ++stepNum,
    label: "Request at GUARDED posture",
    action: "request_context",
    input: { ...baseReq, posture: "guarded" },
    result: res1 as unknown as Record<string, unknown>,
    highlight: "Guarded: tools+communication_style approved (rule match), timezone pending",
  });

  // Step 2: Switch to open
  setPosture(vault, "open");
  const res2 = requestContext({ ...baseReq }, vault, config);
  steps.push({
    stepNumber: ++stepNum,
    label: "Request at OPEN posture",
    action: "request_context",
    input: { ...baseReq, posture: "open" },
    result: res2 as unknown as Record<string, unknown>,
    highlight: "Open: ALL fields auto-approved since a rule matched",
  });

  // Step 3: Switch to locked
  setPosture(vault, "locked");
  const res3 = requestContext({ ...baseReq }, vault, config);
  steps.push({
    stepNumber: ++stepNum,
    label: "Request at LOCKED posture",
    action: "request_context",
    input: { ...baseReq, posture: "locked" },
    result: res3 as unknown as Record<string, unknown>,
    highlight: "Locked: ALL fields denied — vault is sealed",
  });

  // Reset to guarded
  setPosture(vault, "guarded");

  return steps;
}

// ── Scenario 3: multi-agent ─────────────────────────────────────────────

function runMultiAgent(vault: PersonafyVault, config: PersonafyPluginConfig): DemoStep[] {
  const steps: DemoStep[] = [];
  let stepNum = 0;

  // Step 1: personal-assistant requests personal.name (rule matches agentId)
  const req1: PersonafyContextRequest = {
    agentId: "personal-assistant",
    requestType: "message",
    persona: "personal",
    fields: ["name"],
    purpose: "greet user",
  };
  const res1 = requestContext(req1, vault, config);
  steps.push({
    stepNumber: ++stepNum,
    label: "personal-assistant requests personal.name",
    action: "request_context",
    input: req1 as unknown as Record<string, unknown>,
    result: res1 as unknown as Record<string, unknown>,
    highlight: "Approved! Agent-scoped rule matches personal-assistant",
  });

  // Step 2: Add a shopping rule for shopping-bot
  vault.rules.push({
    id: "rule-demo-shopping",
    kind: "standard",
    persona: "shopping",
    fields: ["clothing_size", "shoe_size", "preferred_brands"],
    agentId: "shopping-bot",
    createdAtMs: Date.now(),
  });
  steps.push({
    stepNumber: ++stepNum,
    label: "Add shopping rule for shopping-bot",
    action: "add_rule",
    input: {
      persona: "shopping",
      fields: ["clothing_size", "shoe_size", "preferred_brands"],
      agentId: "shopping-bot",
    },
    result: { ruleId: "rule-demo-shopping" },
    highlight: "Rule created: shopping-bot can access shopping data",
  });

  // Step 3: shopping-bot gets shopping data
  const req3: PersonafyContextRequest = {
    agentId: "shopping-bot",
    requestType: "message",
    persona: "shopping",
    fields: ["clothing_size", "shoe_size", "preferred_brands"],
    purpose: "find matching products",
  };
  const res3 = requestContext(req3, vault, config);
  steps.push({
    stepNumber: ++stepNum,
    label: "shopping-bot requests shopping data",
    action: "request_context",
    input: req3 as unknown as Record<string, unknown>,
    result: res3 as unknown as Record<string, unknown>,
    highlight: "Approved! shopping-bot gets clothing_size, shoe_size, preferred_brands",
  });

  // Step 4: shopping-bot tries personal data (denied/pending)
  const req4: PersonafyContextRequest = {
    agentId: "shopping-bot",
    requestType: "message",
    persona: "personal",
    fields: ["email", "birthday"],
    purpose: "send birthday discount",
  };
  const res4 = requestContext(req4, vault, config);
  steps.push({
    stepNumber: ++stepNum,
    label: "shopping-bot requests personal.email + birthday",
    action: "request_context",
    input: req4 as unknown as Record<string, unknown>,
    result: res4 as unknown as Record<string, unknown>,
    highlight: "Pending! shopping-bot has no rules for personal data — compartmentalized",
  });

  // Step 5: personal-assistant tries shopping data (denied/pending)
  const req5: PersonafyContextRequest = {
    agentId: "personal-assistant",
    requestType: "message",
    persona: "shopping",
    fields: ["payment_method"],
    purpose: "process payment",
  };
  const res5 = requestContext(req5, vault, config);
  steps.push({
    stepNumber: ++stepNum,
    label: "personal-assistant requests shopping.payment_method",
    action: "request_context",
    input: req5 as unknown as Record<string, unknown>,
    result: res5 as unknown as Record<string, unknown>,
    highlight: "Pending! personal-assistant has no access to shopping data",
  });

  return steps;
}

// ── Scenario 4: scheduled-rules ─────────────────────────────────────────

function runScheduledRules(vault: PersonafyVault, config: PersonafyPluginConfig): DemoStep[] {
  const steps: DemoStep[] = [];
  let stepNum = 0;

  // Step 1: Create a heartbeat rule (1 hour TTL)
  const heartbeatRule = createHeartbeatRule({
    agentId: "monitor-bot",
    heartbeatId: "hb-status",
    persona: "work",
    fields: ["tools", "role"],
    ttlMs: 60 * 60 * 1000, // 1 hour
  });
  addScheduledRule(vault, heartbeatRule);
  steps.push({
    stepNumber: ++stepNum,
    label: "Create heartbeat rule for monitor-bot (1hr TTL)",
    action: "add_scheduled_rule",
    input: {
      agentId: "monitor-bot",
      heartbeatId: "hb-status",
      persona: "work",
      fields: ["tools", "role"],
      ttlMs: 3600000,
    },
    result: { ruleId: heartbeatRule.id, expiresAtMs: heartbeatRule.expiresAtMs },
    highlight: "Heartbeat rule created — monitor-bot can access work.tools + role for 1 hour",
  });

  // Step 2: Heartbeat request succeeds
  const req2: PersonafyContextRequest = {
    agentId: "monitor-bot",
    requestType: "heartbeat",
    persona: "work",
    fields: ["tools", "role"],
    purpose: "status check",
    sourceId: "hb-status",
  };
  const res2 = requestContext(req2, vault, config);
  steps.push({
    stepNumber: ++stepNum,
    label: "monitor-bot heartbeat requests work.tools + role",
    action: "request_context",
    input: req2 as unknown as Record<string, unknown>,
    result: res2 as unknown as Record<string, unknown>,
    highlight: "Approved! Heartbeat rule matched",
  });

  // Step 3: Expire the rule (simulate time passing)
  heartbeatRule.expiresAtMs = Date.now() - 1000; // expired
  expireScheduledRules(vault);
  steps.push({
    stepNumber: ++stepNum,
    label: "Heartbeat rule expires (time passes)",
    action: "expire_rule",
    input: { ruleId: heartbeatRule.id },
    result: { expired: true, remainingScheduledRules: vault.scheduledRules.length },
    highlight: "Rule expired — scheduled access revoked",
  });

  // Step 4: Re-request is now pending (no scheduled rule)
  const req4: PersonafyContextRequest = {
    agentId: "monitor-bot",
    requestType: "heartbeat",
    persona: "work",
    fields: ["tools", "role"],
    purpose: "status check",
    sourceId: "hb-status",
  };
  const res4 = requestContext(req4, vault, config);
  steps.push({
    stepNumber: ++stepNum,
    label: "monitor-bot re-requests after rule expiry",
    action: "request_context",
    input: req4 as unknown as Record<string, unknown>,
    result: res4 as unknown as Record<string, unknown>,
    highlight:
      res4.decision === "approved"
        ? "Partially approved: standard rule covers tools but not role"
        : "Pending! Heartbeat rule expired — no automatic access",
  });

  return steps;
}

// ── Scenario 5: full-lifecycle ──────────────────────────────────────────

function runFullLifecycle(vault: PersonafyVault, config: PersonafyPluginConfig): DemoStep[] {
  const steps: DemoStep[] = [];
  let stepNum = 0;

  // Step 1: Show initial state
  steps.push({
    stepNumber: ++stepNum,
    label: "Inspect initial vault state",
    action: "get_state",
    input: {},
    result: {
      posture: vault.posture,
      personaCount: Object.keys(vault.personas).length,
      ruleCount: vault.rules.length,
      personas: Object.keys(vault.personas),
    },
    highlight: "3 personas, 2 rules, guarded posture — ready to go",
  });

  // Step 2: Agent requests with existing rule
  const req2: PersonafyContextRequest = {
    agentId: "coder",
    requestType: "message",
    persona: "work",
    fields: ["tools"],
    purpose: "ide setup",
  };
  const res2 = requestContext(req2, vault, config);
  steps.push({
    stepNumber: ++stepNum,
    label: "coder requests work.tools",
    action: "request_context",
    input: req2 as unknown as Record<string, unknown>,
    result: res2 as unknown as Record<string, unknown>,
    highlight: "Approved! Existing rule covers tools",
  });

  // Step 3: Request uncovered fields
  const req3: PersonafyContextRequest = {
    agentId: "coder",
    requestType: "message",
    persona: "work",
    fields: ["timezone", "role"],
    purpose: "schedule meeting",
  };
  const res3 = requestContext(req3, vault, config);
  steps.push({
    stepNumber: ++stepNum,
    label: "coder requests work.timezone + role",
    action: "request_context",
    input: req3 as unknown as Record<string, unknown>,
    result: res3 as unknown as Record<string, unknown>,
    highlight: "Pending! timezone + role need approval",
  });

  // Step 4: Approve and add rule
  const approvalId = res3.approvalId!;
  resolveApproval(vault, approvalId, "approved", "demo-user");
  vault.rules.push({
    id: "rule-lifecycle-tz",
    kind: "standard",
    persona: "work",
    fields: ["timezone", "role"],
    createdAtMs: Date.now(),
  });
  steps.push({
    stepNumber: ++stepNum,
    label: "User approves + adds standing rule for timezone + role",
    action: "resolve_approval",
    input: { approvalId, decision: "approved" },
    result: { resolved: true, newRule: "rule-lifecycle-tz" },
    highlight: "Approved — new standing rule created",
  });

  // Step 5: Switch to open posture
  setPosture(vault, "open");
  const req5: PersonafyContextRequest = {
    agentId: "coder",
    requestType: "message",
    persona: "work",
    fields: ["tools", "communication_style", "timezone", "role", "review_preferences"],
    purpose: "full profile",
  };
  const res5 = requestContext(req5, vault, config);
  steps.push({
    stepNumber: ++stepNum,
    label: "Switch to OPEN posture — request all work fields",
    action: "request_context",
    input: { ...req5, postureChange: "open" },
    result: res5 as unknown as Record<string, unknown>,
    highlight: "Open posture: ALL fields auto-approved (rule match triggers full access)",
  });

  // Step 6: Create scheduled rule
  setPosture(vault, "guarded");
  const hbRule = createHeartbeatRule({
    agentId: "coder",
    heartbeatId: "hb-coding",
    persona: "work",
    fields: ["tools", "role"],
    ttlMs: 30 * 60 * 1000,
  });
  addScheduledRule(vault, hbRule);
  steps.push({
    stepNumber: ++stepNum,
    label: "Create heartbeat rule + reset to guarded",
    action: "add_scheduled_rule",
    input: { heartbeatId: "hb-coding", fields: ["tools", "role"], ttlMs: 1800000 },
    result: { ruleId: hbRule.id },
    highlight: "Heartbeat rule active — time-scoped access for 30 minutes",
  });

  // Step 7: Show audit trail
  steps.push({
    stepNumber: ++stepNum,
    label: "Review audit trail",
    action: "get_state",
    input: { focus: "audit" },
    result: {
      auditEntries: vault.auditLog.length,
      decisions: vault.auditLog.map((e) => ({
        agent: e.agentId,
        decision: e.decision,
        persona: e.persona,
      })),
    },
    highlight: `Full audit trail: ${vault.auditLog.length} entries logged — every access tracked`,
  });

  return steps;
}

// =============================================================================
// Scenario Registry
// =============================================================================

const scenarios: ScenarioDef[] = [
  {
    id: "basic-approval",
    title: "Basic Approval Flow",
    description:
      "Request covered fields, hit uncovered ones, approve with standing rule, re-request succeeds.",
    run: runBasicApproval,
  },
  {
    id: "posture-showcase",
    title: "Posture Showcase",
    description:
      "Same request at guarded, open, and locked postures — see how behavior changes dramatically.",
    run: runPostureShowcase,
  },
  {
    id: "multi-agent",
    title: "Multi-Agent Compartmentalization",
    description:
      "personal-assistant gets personal data, shopping-bot gets shopping data, cross-requests denied.",
    run: runMultiAgent,
  },
  {
    id: "scheduled-rules",
    title: "Scheduled Rules",
    description: "Create a heartbeat rule, use it, let it expire, watch re-request get queued.",
    run: runScheduledRules,
  },
  {
    id: "full-lifecycle",
    title: "Full Lifecycle",
    description:
      "End-to-end: rules, requests, approvals, posture change, scheduled rules, audit trail.",
    run: runFullLifecycle,
  },
];

// =============================================================================
// Public API
// =============================================================================

export function listDemoScenarios(): DemoScenarioInfo[] {
  return scenarios.map((s) => ({
    id: s.id,
    title: s.title,
    description: s.description,
    stepCount: 0, // Not known until run
  }));
}

export function runDemoScenario(
  id: string,
  vault: PersonafyVault,
  config: PersonafyPluginConfig,
): DemoScenarioResult | null {
  const scenario = scenarios.find((s) => s.id === id);
  if (!scenario) return null;

  // Run on a fresh copy of the vault to avoid cross-scenario contamination
  const sandboxVault = JSON.parse(JSON.stringify(vault)) as PersonafyVault;
  const steps = scenario.run(sandboxVault, config);

  return {
    scenarioId: scenario.id,
    title: scenario.title,
    description: scenario.description,
    steps,
    summary: buildSummary(steps),
  };
}

export function executeDemoAction(
  action: string,
  params: Record<string, unknown>,
  vault: PersonafyVault,
  config: PersonafyPluginConfig,
): DemoActionResult {
  switch (action) {
    case "request_context": {
      const req: PersonafyContextRequest = {
        agentId: (params.agentId as string) || "demo-agent",
        requestType: (params.requestType as PersonafyContextRequest["requestType"]) || "message",
        persona: (params.persona as string) || "work",
        fields: (params.fields as string[]) || [],
        purpose: (params.purpose as string) || "demo request",
      };
      if (!req.persona || req.fields.length === 0) {
        return { ok: false, action, result: {}, error: "Missing persona or fields" };
      }
      const result = requestContext(req, vault, config);
      return { ok: true, action, result: result as unknown as Record<string, unknown> };
    }

    case "set_posture": {
      const posture = params.posture as PersonafyPosture;
      if (!["open", "guarded", "locked"].includes(posture)) {
        return { ok: false, action, result: {}, error: "Invalid posture" };
      }
      setPosture(vault, posture);
      return { ok: true, action, result: { posture: getPosture(vault) } };
    }

    case "add_rule": {
      const persona = params.persona as string;
      const fields = params.fields as string[];
      if (!persona || !fields || fields.length === 0) {
        return { ok: false, action, result: {}, error: "Missing persona or fields" };
      }
      const rule: PersonafyRule = {
        id: `rule-demo-${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`,
        kind: "standard",
        persona,
        fields,
        agentId: params.agentId as string | undefined,
        purposePattern: params.purposePattern as string | undefined,
        createdAtMs: Date.now(),
      };
      vault.rules.push(rule);
      return {
        ok: true,
        action,
        result: { ruleId: rule.id, rule: rule as unknown as Record<string, unknown> },
      };
    }

    case "remove_rule": {
      const ruleId = params.ruleId as string;
      if (!ruleId) {
        return { ok: false, action, result: {}, error: "Missing ruleId" };
      }
      const idx = vault.rules.findIndex((r) => r.id === ruleId);
      if (idx < 0) {
        return { ok: false, action, result: {}, error: "Rule not found" };
      }
      vault.rules.splice(idx, 1);
      return { ok: true, action, result: { removed: ruleId } };
    }

    case "resolve_approval": {
      const approvalId = params.approvalId as string;
      const decision = params.decision as "approved" | "denied";
      if (!approvalId || !decision) {
        return { ok: false, action, result: {}, error: "Missing approvalId or decision" };
      }
      const resolved = resolveApproval(vault, approvalId, decision, "demo-user");
      if (!resolved) {
        return { ok: false, action, result: {}, error: "Approval not found or already resolved" };
      }
      // If approved with createStandingRule, add a rule
      if (decision === "approved" && params.createStandingRule) {
        const approval = vault.approvalQueue.find((e) => e.id === approvalId);
        if (approval) {
          const newRule: PersonafyRule = {
            id: `rule-standing-${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`,
            kind: "standard",
            persona: approval.request.persona,
            fields: approval.request.fields,
            createdAtMs: Date.now(),
          };
          vault.rules.push(newRule);
        }
      }
      return { ok: true, action, result: { resolved: true, approvalId } };
    }

    case "get_state": {
      const pending = getPendingApprovals(vault);
      return {
        ok: true,
        action,
        result: {
          posture: vault.posture,
          personas: Object.entries(vault.personas).map(([id, p]) => ({
            id,
            label: p.label,
            fields: p.fields,
          })),
          facts: vault.facts.map((f) => ({ persona: f.persona, field: f.field, value: f.value })),
          rules: vault.rules.map((r) => ({
            id: r.id,
            persona: r.persona,
            fields: r.fields,
            agentId: r.agentId,
          })),
          scheduledRules: vault.scheduledRules.map((r) => ({
            id: r.id,
            kind: r.kind,
            persona: r.persona,
            fields: r.fields,
            expiresAtMs: r.expiresAtMs,
          })),
          pendingApprovals: pending.map((a) => ({
            id: a.id,
            agentId: a.request.agentId,
            persona: a.request.persona,
            fields: a.request.fields,
            purpose: a.request.purpose,
          })),
          auditLogCount: vault.auditLog.length,
        },
      };
    }

    default:
      return { ok: false, action, result: {}, error: `Unknown action: ${action}` };
  }
}
