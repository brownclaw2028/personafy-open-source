import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type { PersonafyPluginConfig, PersonafyVault } from "./types.js";
import {
  createDemoVault,
  listDemoScenarios,
  runDemoScenario,
  executeDemoAction,
  getOrCreateSession,
  getSessionCount,
  clearAllSessions,
} from "./demo.js";
import { DEFAULT_PERSONAFY_CONFIG } from "./types.js";

describe("demo", () => {
  let vault: PersonafyVault;
  let config: PersonafyPluginConfig;

  beforeEach(() => {
    vault = createDemoVault();
    config = { ...DEFAULT_PERSONAFY_CONFIG };
  });

  afterEach(() => {
    clearAllSessions();
  });

  // ── createDemoVault ─────────────────────────────────────────────────

  describe("createDemoVault", () => {
    it("creates 3 personas with correct fields", () => {
      expect(Object.keys(vault.personas)).toHaveLength(3);
      expect(vault.personas.work).toBeDefined();
      expect(vault.personas.personal).toBeDefined();
      expect(vault.personas.shopping).toBeDefined();

      expect(vault.personas.work.fields.tools).toBe("vscode");
      expect(vault.personas.work.fields.communication_style).toBe("concise");
      expect(vault.personas.work.fields.review_preferences).toBe("thorough");
      expect(vault.personas.work.fields.timezone).toBe("America/New_York");
      expect(vault.personas.work.fields.role).toBe("senior-engineer");

      expect(vault.personas.personal.fields.name).toBe("Alex");
      expect(vault.personas.personal.fields.email).toBe("alex@example.com");
      expect(vault.personas.personal.fields.birthday).toBe("1992-06-15");

      expect(vault.personas.shopping.fields.clothing_size).toBe("M");
      expect(vault.personas.shopping.fields.shoe_size).toBe("10");
      expect(vault.personas.shopping.fields.preferred_brands).toBe("Patagonia/Allbirds");
    });

    it("creates facts for work persona", () => {
      const workFacts = vault.facts.filter((f) => f.persona === "work");
      expect(workFacts).toHaveLength(2);
      const factFields = workFacts.map((f) => f.field).sort();
      expect(factFields).toEqual(["editor", "os"]);
    });

    it("creates 2 starter rules", () => {
      expect(vault.rules).toHaveLength(2);
      const workRule = vault.rules.find((r) => r.id === "rule-demo-work");
      expect(workRule).toBeDefined();
      expect(workRule!.persona).toBe("work");
      expect(workRule!.fields).toEqual(["tools", "communication_style"]);
      expect(workRule!.agentId).toBeUndefined();

      const personalRule = vault.rules.find((r) => r.id === "rule-demo-personal");
      expect(personalRule).toBeDefined();
      expect(personalRule!.persona).toBe("personal");
      expect(personalRule!.fields).toEqual(["name"]);
      expect(personalRule!.agentId).toBe("personal-assistant");
    });

    it("sets posture to guarded", () => {
      expect(vault.posture).toBe("guarded");
    });
  });

  // ── listDemoScenarios ───────────────────────────────────────────────

  describe("listDemoScenarios", () => {
    it("returns all 5 scenarios with metadata", () => {
      const scenarios = listDemoScenarios();
      expect(scenarios).toHaveLength(5);
      const ids = scenarios.map((s) => s.id);
      expect(ids).toContain("basic-approval");
      expect(ids).toContain("posture-showcase");
      expect(ids).toContain("multi-agent");
      expect(ids).toContain("scheduled-rules");
      expect(ids).toContain("full-lifecycle");

      for (const s of scenarios) {
        expect(s.title).toBeTruthy();
        expect(s.description).toBeTruthy();
      }
    });
  });

  // ── runDemoScenario ─────────────────────────────────────────────────

  describe("runDemoScenario", () => {
    it("returns null for invalid scenario", () => {
      const result = runDemoScenario("nonexistent", vault, config);
      expect(result).toBeNull();
    });

    it("basic-approval runs with valid steps and summary", () => {
      const result = runDemoScenario("basic-approval", vault, config);
      expect(result).not.toBeNull();
      expect(result!.scenarioId).toBe("basic-approval");
      expect(result!.steps.length).toBeGreaterThanOrEqual(4);

      // Verify step structure
      for (const step of result!.steps) {
        expect(step.stepNumber).toBeGreaterThan(0);
        expect(step.label).toBeTruthy();
        expect(step.action).toBeTruthy();
        expect(step.highlight).toBeTruthy();
      }

      // Verify summary
      expect(result!.summary.totalSteps).toBe(result!.steps.length);
      expect(result!.summary.approved).toBeGreaterThanOrEqual(1);
    });

    it("posture-showcase runs with 3 steps", () => {
      const result = runDemoScenario("posture-showcase", vault, config);
      expect(result).not.toBeNull();
      expect(result!.steps).toHaveLength(3);
      // Step 1 should have partial approval (guarded)
      expect(result!.steps[0].result.decision).toBeDefined();
      // Step 2 open = all approved
      expect(result!.steps[1].result.decision).toBe("approved");
      // Step 3 locked = denied
      expect(result!.steps[2].result.decision).toBe("denied");
    });

    it("multi-agent runs with compartmentalization checks", () => {
      const result = runDemoScenario("multi-agent", vault, config);
      expect(result).not.toBeNull();
      expect(result!.steps.length).toBeGreaterThanOrEqual(5);
      // Step 1: personal-assistant gets name approved
      expect(result!.steps[0].result.decision).toBe("approved");
    });

    it("scheduled-rules runs with heartbeat flow", () => {
      const result = runDemoScenario("scheduled-rules", vault, config);
      expect(result).not.toBeNull();
      expect(result!.steps.length).toBeGreaterThanOrEqual(4);
    });

    it("full-lifecycle runs with complete trace", () => {
      const result = runDemoScenario("full-lifecycle", vault, config);
      expect(result).not.toBeNull();
      expect(result!.steps.length).toBeGreaterThanOrEqual(7);
      expect(result!.summary.totalSteps).toBe(result!.steps.length);
    });

    it("does not mutate the original vault", () => {
      const originalRulesCount = vault.rules.length;
      const originalAuditCount = vault.auditLog.length;
      runDemoScenario("basic-approval", vault, config);
      expect(vault.rules.length).toBe(originalRulesCount);
      expect(vault.auditLog.length).toBe(originalAuditCount);
    });
  });

  // ── executeDemoAction ───────────────────────────────────────────────

  describe("executeDemoAction", () => {
    it("request_context returns approved for covered fields", () => {
      const result = executeDemoAction(
        "request_context",
        {
          agentId: "coder",
          persona: "work",
          fields: ["tools", "communication_style"],
          purpose: "coding",
        },
        vault,
        config,
      );
      expect(result.ok).toBe(true);
      expect(result.result.decision).toBe("approved");
      expect((result.result.approvedFields as Record<string, string>).tools).toBe("vscode");
    });

    it("request_context returns error for missing fields", () => {
      const result = executeDemoAction(
        "request_context",
        { agentId: "coder", persona: "work", fields: [], purpose: "coding" },
        vault,
        config,
      );
      expect(result.ok).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it("set_posture changes the vault posture", () => {
      const result = executeDemoAction("set_posture", { posture: "locked" }, vault, config);
      expect(result.ok).toBe(true);
      expect(vault.posture).toBe("locked");
    });

    it("set_posture rejects invalid posture", () => {
      const result = executeDemoAction("set_posture", { posture: "invalid" }, vault, config);
      expect(result.ok).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it("add_rule adds a new rule", () => {
      const before = vault.rules.length;
      const result = executeDemoAction(
        "add_rule",
        { persona: "personal", fields: ["email", "birthday"], agentId: "mailer" },
        vault,
        config,
      );
      expect(result.ok).toBe(true);
      expect(vault.rules.length).toBe(before + 1);
    });

    it("remove_rule removes an existing rule", () => {
      const result = executeDemoAction("remove_rule", { ruleId: "rule-demo-work" }, vault, config);
      expect(result.ok).toBe(true);
      expect(vault.rules.find((r) => r.id === "rule-demo-work")).toBeUndefined();
    });

    it("remove_rule returns error for missing rule", () => {
      const result = executeDemoAction("remove_rule", { ruleId: "nonexistent" }, vault, config);
      expect(result.ok).toBe(false);
    });

    it("resolve_approval approves a pending request", () => {
      // First create a pending request
      executeDemoAction(
        "request_context",
        { agentId: "bot", persona: "work", fields: ["review_preferences"], purpose: "review" },
        vault,
        config,
      );
      const pending = vault.approvalQueue.filter((e) => e.status === "pending");
      expect(pending.length).toBeGreaterThanOrEqual(1);

      const result = executeDemoAction(
        "resolve_approval",
        { approvalId: pending[0].id, decision: "approved" },
        vault,
        config,
      );
      expect(result.ok).toBe(true);
    });

    it("get_state returns full vault state", () => {
      const result = executeDemoAction("get_state", {}, vault, config);
      expect(result.ok).toBe(true);
      expect(result.result.posture).toBe("guarded");
      expect(Array.isArray(result.result.personas)).toBe(true);
      expect(Array.isArray(result.result.rules)).toBe(true);
      expect(Array.isArray(result.result.pendingApprovals)).toBe(true);
    });

    it("returns error for unknown action", () => {
      const result = executeDemoAction("unknown_action", {}, vault, config);
      expect(result.ok).toBe(false);
      expect(result.error).toContain("Unknown action");
    });
  });

  // ── Session management ──────────────────────────────────────────────

  describe("session management", () => {
    it("creates a new session and retrieves it", () => {
      const s1 = getOrCreateSession("test-1");
      expect(s1.vault).toBeDefined();
      expect(s1.config).toBeDefined();

      const s2 = getOrCreateSession("test-1");
      expect(s2).toBe(s1); // Same reference
    });

    it("creates separate sessions for different IDs", () => {
      const s1 = getOrCreateSession("a");
      const s2 = getOrCreateSession("b");
      expect(s1).not.toBe(s2);
      expect(getSessionCount()).toBe(2);
    });

    it("enforces max capacity by evicting oldest", () => {
      for (let i = 0; i < 50; i++) {
        const s = getOrCreateSession(`cap-${i}`);
        // Stagger creation times
        (s as any).createdAt = Date.now() - (50 - i) * 1000;
      }
      expect(getSessionCount()).toBe(50);

      // Adding one more should evict the oldest
      getOrCreateSession("cap-overflow");
      expect(getSessionCount()).toBe(50);
    });
  });
});
