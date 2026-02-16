import { describe, expect, it, beforeEach } from "vitest";
import { requestContext } from "./context-engine.js";
import { createEmptyVault, setPersona } from "./vault.js";
import type { PersonafyContextRequest, PersonafyPluginConfig, PersonafyVault } from "./types.js";
import { DEFAULT_PERSONAFY_CONFIG } from "./types.js";

describe("context-engine", () => {
  let vault: PersonafyVault;
  let config: PersonafyPluginConfig;

  beforeEach(() => {
    vault = createEmptyVault("guarded");
    config = { ...DEFAULT_PERSONAFY_CONFIG };
    setPersona(vault, "work", "Work", {
      tools: "vscode",
      communication_style: "concise",
      review_preferences: "thorough",
    });
  });

  function makeRequest(overrides?: Partial<PersonafyContextRequest>): PersonafyContextRequest {
    return {
      agentId: "agent-1",
      requestType: "message",
      persona: "work",
      fields: ["tools", "communication_style"],
      purpose: "help with coding",
      ...overrides,
    };
  }

  describe("locked vault", () => {
    it("denies all requests when vault is locked", () => {
      vault.posture = "locked";
      const result = requestContext(makeRequest(), vault, config);
      expect(result.decision).toBe("denied");
      expect(result.deniedFields).toEqual(["tools", "communication_style"]);
      expect(result.approvedFields).toEqual({});
      expect(result.auditId).toBeTruthy();
    });
  });

  describe("with matching rules", () => {
    it("auto-approves fields covered by rules", () => {
      vault.rules.push({
        id: "rule-1",
        kind: "standard",
        persona: "work",
        fields: ["tools", "communication_style"],
        createdAtMs: Date.now(),
      });

      const result = requestContext(makeRequest(), vault, config);
      expect(result.decision).toBe("approved");
      expect(result.approvedFields.tools).toBe("vscode");
      expect(result.approvedFields.communication_style).toBe("concise");
      expect(result.pendingFields).toEqual([]);
    });

    it("partially approves when rule covers some fields", () => {
      vault.rules.push({
        id: "rule-1",
        kind: "standard",
        persona: "work",
        fields: ["tools"],
        createdAtMs: Date.now(),
      });

      const result = requestContext(
        makeRequest({ fields: ["tools", "review_preferences"] }),
        vault,
        config,
      );
      expect(result.decision).toBe("approved"); // partial approval
      expect(result.approvedFields.tools).toBe("vscode");
      expect(result.pendingFields).toContain("review_preferences");
      expect(result.approvalId).toBeTruthy();
    });

    it("respects agent scoping on rules", () => {
      vault.rules.push({
        id: "rule-1",
        kind: "standard",
        persona: "work",
        fields: ["tools"],
        agentId: "agent-2", // different agent
        createdAtMs: Date.now(),
      });

      const result = requestContext(makeRequest({ agentId: "agent-1" }), vault, config);
      expect(result.pendingFields).toContain("tools");
    });

    it("respects purpose pattern on rules", () => {
      vault.rules.push({
        id: "rule-1",
        kind: "standard",
        persona: "work",
        fields: ["tools"],
        purposePattern: "shopping",
        createdAtMs: Date.now(),
      });

      const result = requestContext(
        makeRequest({ purpose: "help with coding" }),
        vault,
        config,
      );
      expect(result.pendingFields).toContain("tools");
    });
  });

  describe("open posture", () => {
    it("auto-approves all fields when a rule matches in open posture", () => {
      vault.posture = "open";
      vault.rules.push({
        id: "rule-1",
        kind: "standard",
        persona: "work",
        fields: ["tools"], // only covers "tools"
        createdAtMs: Date.now(),
      });

      const result = requestContext(
        makeRequest({ fields: ["tools", "communication_style", "review_preferences"] }),
        vault,
        config,
      );
      expect(result.decision).toBe("approved");
      expect(Object.keys(result.approvedFields)).toHaveLength(3);
    });
  });

  describe("no rules", () => {
    it("queues all fields for approval in guarded posture", () => {
      const result = requestContext(makeRequest(), vault, config);
      expect(result.decision).toBe("pending");
      expect(result.pendingFields).toEqual(["tools", "communication_style"]);
      expect(result.approvalId).toBeTruthy();
    });
  });

  describe("scheduled rules for heartbeats/crons", () => {
    it("evaluates scheduled rules for heartbeat requests", () => {
      vault.scheduledRules.push({
        id: "srl-1",
        kind: "heartbeat",
        sourceId: "hb-1",
        agentId: "agent-1",
        persona: "work",
        fields: ["tools"],
        expiresAtMs: Date.now() + 60_000,
        createdAtMs: Date.now(),
      });

      const result = requestContext(
        makeRequest({
          requestType: "heartbeat",
          sourceId: "hb-1",
          fields: ["tools"],
        }),
        vault,
        config,
      );
      expect(result.decision).toBe("approved");
      expect(result.approvedFields.tools).toBe("vscode");
    });
  });

  describe("audit logging", () => {
    it("creates audit entry for every request", () => {
      const before = vault.auditLog.length;
      requestContext(makeRequest(), vault, config);
      expect(vault.auditLog.length).toBe(before + 1);
      expect(vault.auditLog[0].agentId).toBe("agent-1");
    });

    it("records correlation ID", () => {
      requestContext(makeRequest({ correlationId: "workflow-123" }), vault, config);
      expect(vault.auditLog[0].correlationId).toBe("workflow-123");
    });
  });

  describe("multi-agent compartmentalization", () => {
    it("each agent requests independently", () => {
      vault.rules.push({
        id: "rule-a",
        kind: "standard",
        persona: "work",
        fields: ["tools"],
        agentId: "agent-A",
        createdAtMs: Date.now(),
      });

      const resultA = requestContext(
        makeRequest({ agentId: "agent-A", fields: ["tools"] }),
        vault,
        config,
      );
      const resultB = requestContext(
        makeRequest({ agentId: "agent-B", fields: ["tools"] }),
        vault,
        config,
      );

      expect(resultA.decision).toBe("approved");
      expect(resultB.decision).toBe("pending"); // no rule for agent-B
    });
  });
});
