import { describe, expect, it, beforeEach } from "vitest";
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
import { createEmptyVault, setPersona } from "./vault.js";
import type { PersonafyVault } from "./types.js";

describe("scheduled-rules", () => {
  let vault: PersonafyVault;

  beforeEach(() => {
    vault = createEmptyVault("guarded");
    setPersona(vault, "work", "Work", { tools: "vscode", style: "concise" });
  });

  describe("createHeartbeatRule", () => {
    it("creates a heartbeat rule with correct fields", () => {
      const rule = createHeartbeatRule({
        agentId: "agent-1",
        heartbeatId: "hb-1",
        persona: "work",
        fields: ["tools"],
        ttlMs: 60_000,
      });
      expect(rule.id).toMatch(/^srl_/);
      expect(rule.kind).toBe("heartbeat");
      expect(rule.sourceId).toBe("hb-1");
      expect(rule.agentId).toBe("agent-1");
      expect(rule.persona).toBe("work");
      expect(rule.fields).toEqual(["tools"]);
      expect(rule.timeWindow).toBeUndefined();
      expect(rule.expiresAtMs).toBeGreaterThan(Date.now());
    });
  });

  describe("createCronRule", () => {
    it("creates a cron rule with time window", () => {
      const rule = createCronRule({
        agentId: "agent-1",
        cronId: "cron-1",
        persona: "work",
        fields: ["tools", "style"],
        timeWindow: { from: "09:00", to: "17:00" },
        expiresInDays: 30,
      });
      expect(rule.kind).toBe("cron");
      expect(rule.sourceId).toBe("cron-1");
      expect(rule.timeWindow).toEqual({ from: "09:00", to: "17:00" });
      expect(rule.expiresAtMs).toBeGreaterThan(Date.now() + 29 * 24 * 60 * 60 * 1000);
    });
  });

  describe("addScheduledRule", () => {
    it("adds rule to vault", () => {
      const rule = createHeartbeatRule({
        agentId: "agent-1",
        heartbeatId: "hb-1",
        persona: "work",
        fields: ["tools"],
        ttlMs: 60_000,
      });
      addScheduledRule(vault, rule);
      expect(vault.scheduledRules).toHaveLength(1);
      expect(vault.scheduledRules[0].id).toBe(rule.id);
    });
  });

  describe("expireScheduledRules", () => {
    it("removes expired rules", () => {
      vault.scheduledRules.push({
        id: "s1",
        kind: "heartbeat",
        sourceId: "hb-1",
        persona: "work",
        fields: ["tools"],
        expiresAtMs: Date.now() - 1000,
        createdAtMs: Date.now() - 10000,
      });
      vault.scheduledRules.push({
        id: "s2",
        kind: "heartbeat",
        sourceId: "hb-2",
        persona: "work",
        fields: ["style"],
        expiresAtMs: Date.now() + 60_000,
        createdAtMs: Date.now(),
      });

      const count = expireScheduledRules(vault);
      expect(count).toBe(1);
      expect(vault.scheduledRules).toHaveLength(1);
      expect(vault.scheduledRules[0].id).toBe("s2");
    });
  });

  describe("listScheduledRules", () => {
    it("lists all rules", () => {
      addScheduledRule(
        vault,
        createHeartbeatRule({
          agentId: "a1",
          heartbeatId: "h1",
          persona: "work",
          fields: [],
          ttlMs: 60000,
        }),
      );
      addScheduledRule(
        vault,
        createCronRule({
          agentId: "a1",
          cronId: "c1",
          persona: "work",
          fields: [],
          expiresInDays: 30,
        }),
      );
      expect(listScheduledRules(vault)).toHaveLength(2);
    });

    it("filters by type", () => {
      addScheduledRule(
        vault,
        createHeartbeatRule({
          agentId: "a1",
          heartbeatId: "h1",
          persona: "work",
          fields: [],
          ttlMs: 60000,
        }),
      );
      addScheduledRule(
        vault,
        createCronRule({
          agentId: "a1",
          cronId: "c1",
          persona: "work",
          fields: [],
          expiresInDays: 30,
        }),
      );
      expect(listScheduledRules(vault, { type: "heartbeat" })).toHaveLength(1);
      expect(listScheduledRules(vault, { type: "cron" })).toHaveLength(1);
    });

    it("filters by agent", () => {
      addScheduledRule(
        vault,
        createHeartbeatRule({
          agentId: "a1",
          heartbeatId: "h1",
          persona: "work",
          fields: [],
          ttlMs: 60000,
        }),
      );
      addScheduledRule(
        vault,
        createHeartbeatRule({
          agentId: "a2",
          heartbeatId: "h2",
          persona: "work",
          fields: [],
          ttlMs: 60000,
        }),
      );
      expect(listScheduledRules(vault, { agentId: "a1" })).toHaveLength(1);
    });
  });

  describe("revokeScheduledRule", () => {
    it("removes rule by ID", () => {
      const rule = createHeartbeatRule({
        agentId: "a1",
        heartbeatId: "h1",
        persona: "work",
        fields: [],
        ttlMs: 60000,
      });
      addScheduledRule(vault, rule);
      expect(revokeScheduledRule(vault, rule.id)).toBe(true);
      expect(vault.scheduledRules).toHaveLength(0);
    });

    it("returns false for non-existent ID", () => {
      expect(revokeScheduledRule(vault, "nonexistent")).toBe(false);
    });
  });

  describe("pre-warming context", () => {
    it("pre-warms context for a cron", () => {
      const rule = createCronRule({
        agentId: "a1",
        cronId: "cron-1",
        persona: "work",
        fields: ["tools", "style"],
        expiresInDays: 30,
      });
      addScheduledRule(vault, rule);

      const preWarmed = preWarmContext("cron-1", vault);
      expect(preWarmed).not.toBeNull();
      expect(preWarmed!.cronId).toBe("cron-1");
      expect(preWarmed!.fields.tools).toBe("vscode");
      expect(preWarmed!.fields.style).toBe("concise");
    });

    it("returns null when no matching rules", () => {
      expect(preWarmContext("nonexistent", vault)).toBeNull();
    });

    it("caches and retrieves pre-warmed context", () => {
      const rule = createCronRule({
        agentId: "a1",
        cronId: "cron-1",
        persona: "work",
        fields: ["tools"],
        expiresInDays: 30,
      });
      addScheduledRule(vault, rule);
      preWarmContext("cron-1", vault);

      const cached = getPreWarmedContext("cron-1");
      expect(cached).not.toBeNull();
      expect(cached!.fields.tools).toBe("vscode");
    });

    it("clears pre-warmed context", () => {
      const rule = createCronRule({
        agentId: "a1",
        cronId: "cron-1",
        persona: "work",
        fields: ["tools"],
        expiresInDays: 30,
      });
      addScheduledRule(vault, rule);
      preWarmContext("cron-1", vault);
      clearPreWarmedContext("cron-1");
      expect(getPreWarmedContext("cron-1")).toBeNull();
    });
  });
});
