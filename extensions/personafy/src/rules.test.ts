import { describe, expect, it, beforeEach } from "vitest";
import { evaluateRules, evaluateScheduledRules, isScheduledRuleActive } from "./rules.js";
import { createEmptyVault } from "./vault.js";
import type { PersonafyContextRequest, PersonafyVault } from "./types.js";

describe("rules", () => {
  let vault: PersonafyVault;

  beforeEach(() => {
    vault = createEmptyVault("guarded");
  });

  function makeRequest(overrides?: Partial<PersonafyContextRequest>): PersonafyContextRequest {
    return {
      agentId: "agent-1",
      requestType: "message",
      persona: "work",
      fields: ["tools", "style"],
      purpose: "coding help",
      ...overrides,
    };
  }

  describe("evaluateRules", () => {
    it("approves fields matching a rule", () => {
      vault.rules.push({
        id: "r1",
        kind: "standard",
        persona: "work",
        fields: ["tools", "style"],
        createdAtMs: Date.now(),
      });

      const result = evaluateRules(makeRequest(), vault);
      expect(result.approvedFields).toEqual(["tools", "style"]);
      expect(result.unapprovedFields).toEqual([]);
      expect(result.matchedRules).toHaveLength(1);
    });

    it("partially approves when rule covers some fields", () => {
      vault.rules.push({
        id: "r1",
        kind: "standard",
        persona: "work",
        fields: ["tools"],
        createdAtMs: Date.now(),
      });

      const result = evaluateRules(makeRequest(), vault);
      expect(result.approvedFields).toEqual(["tools"]);
      expect(result.unapprovedFields).toEqual(["style"]);
    });

    it("combines fields from multiple rules", () => {
      vault.rules.push(
        { id: "r1", kind: "standard", persona: "work", fields: ["tools"], createdAtMs: Date.now() },
        { id: "r2", kind: "standard", persona: "work", fields: ["style"], createdAtMs: Date.now() },
      );

      const result = evaluateRules(makeRequest(), vault);
      expect(result.approvedFields).toContain("tools");
      expect(result.approvedFields).toContain("style");
    });

    it("skips rules for different persona", () => {
      vault.rules.push({
        id: "r1",
        kind: "standard",
        persona: "personal",
        fields: ["tools"],
        createdAtMs: Date.now(),
      });

      const result = evaluateRules(makeRequest(), vault);
      expect(result.approvedFields).toEqual([]);
    });

    it("skips rules for different agent", () => {
      vault.rules.push({
        id: "r1",
        kind: "standard",
        persona: "work",
        fields: ["tools"],
        agentId: "other-agent",
        createdAtMs: Date.now(),
      });

      const result = evaluateRules(makeRequest(), vault);
      expect(result.approvedFields).toEqual([]);
    });

    it("matches purpose pattern (case-insensitive)", () => {
      vault.rules.push({
        id: "r1",
        kind: "standard",
        persona: "work",
        fields: ["tools"],
        purposePattern: "CODING",
        createdAtMs: Date.now(),
      });

      const result = evaluateRules(makeRequest({ purpose: "coding help" }), vault);
      expect(result.approvedFields).toContain("tools");
    });
  });

  describe("isScheduledRuleActive", () => {
    it("returns false for expired rule", () => {
      expect(
        isScheduledRuleActive({
          id: "s1",
          kind: "heartbeat",
          sourceId: "hb",
          persona: "work",
          fields: [],
          expiresAtMs: Date.now() - 1000,
          createdAtMs: Date.now() - 10000,
        }),
      ).toBe(false);
    });

    it("returns true for valid rule", () => {
      expect(
        isScheduledRuleActive({
          id: "s1",
          kind: "heartbeat",
          sourceId: "hb",
          persona: "work",
          fields: [],
          expiresAtMs: Date.now() + 60_000,
          createdAtMs: Date.now(),
        }),
      ).toBe(true);
    });

    it("respects time window", () => {
      const now = new Date();
      const currentHour = now.getHours();
      const nextHour = (currentHour + 1) % 24;
      const prevHour = (currentHour - 1 + 24) % 24;

      // Window that includes now
      expect(
        isScheduledRuleActive({
          id: "s1",
          kind: "cron",
          sourceId: "c1",
          persona: "work",
          fields: [],
          timeWindow: {
            from: `${String(prevHour).padStart(2, "0")}:00`,
            to: `${String(nextHour).padStart(2, "0")}:00`,
          },
          expiresAtMs: Date.now() + 60_000,
          createdAtMs: Date.now(),
        }),
      ).toBe(true);

      // Window that excludes now (2 hours ahead)
      const twoAhead = (currentHour + 2) % 24;
      const threeAhead = (currentHour + 3) % 24;
      expect(
        isScheduledRuleActive({
          id: "s2",
          kind: "cron",
          sourceId: "c2",
          persona: "work",
          fields: [],
          timeWindow: {
            from: `${String(twoAhead).padStart(2, "0")}:00`,
            to: `${String(threeAhead).padStart(2, "0")}:00`,
          },
          expiresAtMs: Date.now() + 60_000,
          createdAtMs: Date.now(),
        }),
      ).toBe(false);
    });
  });

  describe("evaluateScheduledRules", () => {
    it("approves fields from active scheduled rules", () => {
      vault.scheduledRules.push({
        id: "s1",
        kind: "heartbeat",
        sourceId: "hb-1",
        agentId: "agent-1",
        persona: "work",
        fields: ["tools"],
        expiresAtMs: Date.now() + 60_000,
        createdAtMs: Date.now(),
      });

      const result = evaluateScheduledRules(
        makeRequest({ requestType: "heartbeat", sourceId: "hb-1" }),
        vault,
      );
      expect(result.approvedFields).toContain("tools");
    });

    it("ignores expired scheduled rules", () => {
      vault.scheduledRules.push({
        id: "s1",
        kind: "heartbeat",
        sourceId: "hb-1",
        agentId: "agent-1",
        persona: "work",
        fields: ["tools"],
        expiresAtMs: Date.now() - 1000,
        createdAtMs: Date.now() - 10000,
      });

      const result = evaluateScheduledRules(
        makeRequest({ requestType: "heartbeat", sourceId: "hb-1" }),
        vault,
      );
      expect(result.approvedFields).toEqual([]);
    });

    it("requires matching request type", () => {
      vault.scheduledRules.push({
        id: "s1",
        kind: "heartbeat",
        sourceId: "hb-1",
        persona: "work",
        fields: ["tools"],
        expiresAtMs: Date.now() + 60_000,
        createdAtMs: Date.now(),
      });

      const result = evaluateScheduledRules(
        makeRequest({ requestType: "cron", sourceId: "hb-1" }),
        vault,
      );
      expect(result.approvedFields).toEqual([]);
    });
  });
});
