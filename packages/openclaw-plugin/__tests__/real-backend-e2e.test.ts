/**
 * CC-003: Full Plugin↔Vault Approval Flow Against Real Backend
 *
 * End-to-end integration test that runs the OpenClaw plugin against a real
 * vault file (not mocked I/O). Each test creates a temp vault with known
 * personas, facts, and settings, exercises the full ask/approve/deny flows,
 * and verifies audit log persistence by reading the vault file back.
 *
 * Required scenarios:
 *   1. Ask flow returns request_id and approval challenge
 *   2. Approve flow returns allowed facts + audit_id
 *   3. Deny flow returns deny response + audit event
 *   4. Expired request returns clear error
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VaultData } from "../lib";
import register from "../index";

// ---- Helpers ----

type Tool = {
  name: string;
  execute: (id: string, params: any) => Promise<{ content: Array<{ type: string; text: string }> }>;
};

type Command = {
  name: string;
  handler: (ctx: { args?: string }) => Promise<{ text: string }>;
};

function parseResponse(result: { content: Array<{ type: string; text: string }> }) {
  return JSON.parse(result.content[0]?.text ?? "{}");
}

/**
 * Build a vault with multiple personas covering different sensitivity levels
 * and categories, plus configurable rules and settings.
 */
function buildRealVault(overrides: Partial<VaultData> = {}): VaultData {
  return {
    version: "1.0",
    createdAt: new Date().toISOString(),
    privacyPosture: "alarm_system",
    settings: {
      contextTtlMinutes: 10,
      hideHighSensitivity: false,
      approvalNotifications: true,
    },
    personas: [
      {
        id: "shopping",
        name: "Shopping",
        category: "shopping",
        facts: [
          { key: "apparel.pants.waist", value: "32", sensitivity: "low", confidence: 0.92 },
          { key: "apparel.pants.inseam", value: "30", sensitivity: "low", confidence: 0.9 },
          { key: "apparel.shirt.size", value: "M", sensitivity: "medium", confidence: 0.85 },
          { key: "apparel.shoe.size", value: "10", sensitivity: "low", confidence: 0.88 },
          { key: "budget.monthly", value: "$200", sensitivity: "high", confidence: 0.7 },
        ],
        personaSettings: {
          visible: true,
          autoRelease: "follow_posture",
          retention: "never",
        },
      },
      {
        id: "travel",
        name: "Travel",
        category: "travel",
        facts: [
          { key: "flight.seat_preference", value: "aisle", sensitivity: "low", confidence: 0.95 },
          { key: "hotel.room_preference", value: "high floor, quiet", sensitivity: "low", confidence: 0.8 },
          { key: "travel.loyalty_programs", value: "Delta SkyMiles, Marriott Bonvoy", sensitivity: "medium", confidence: 0.75 },
        ],
        personaSettings: {
          visible: true,
          autoRelease: "follow_posture",
          retention: "never",
        },
      },
    ],
    rules: [],
    auditLog: [],
    ...overrides,
  };
}

function setupPlugin(vaultPath: string) {
  const tools = new Map<string, Tool>();
  let command: Command | null = null;

  const api: any = {
    config: {
      plugins: {
        entries: {
          personafy: {
            config: { vaultPath },
          },
        },
      },
    },
    registerTool: (tool: Tool) => {
      tools.set(tool.name, tool);
    },
    registerCommand: (cmd: Command) => {
      command = cmd;
    },
  };

  register(api);
  return { tools, command };
}

function readVaultFromDisk(vaultPath: string): VaultData {
  return JSON.parse(readFileSync(vaultPath, "utf-8"));
}

// ---- Tests ----

describe("CC-003: Full Plugin↔Vault Approval Flow (Real Backend E2E)", () => {
  let tempDir: string;
  let vaultPath: string;

  beforeEach(() => {
    vi.useFakeTimers();
    tempDir = mkdtempSync(join(tmpdir(), "personafy-real-e2e-"));
    vaultPath = join(tempDir, "vault-data.json");
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(tempDir, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------
  // Scenario 1: Ask flow returns request_id and approval challenge
  // ---------------------------------------------------------------
  describe("Scenario 1: Ask flow returns request_id and approval challenge", () => {
    it("returns ask decision with request_id, challenge summary, fields, and expiry", async () => {
      writeFileSync(vaultPath, JSON.stringify(buildRealVault(), null, 2), "utf-8");
      const { tools } = setupPlugin(vaultPath);
      const tool = tools.get("personafy_request_context")!;

      const result = await tool.execute("e2e-ask-1", {
        purpose: { category: "shopping", action: "find_item", detail: "looking for jeans" },
        recipient: { type: "domain", value: "nordstrom.com" },
        persona_hint: "shopping",
        fields_requested: ["apparel.pants.*"],
      });
      const payload = parseResponse(result);

      expect(payload.type).toBe("context.response");
      expect(payload.decision).toBe("ask");
      expect(payload.request_id).toMatch(/^req_[a-f0-9]+$/);

      // Challenge envelope
      expect(payload.challenge).toBeDefined();
      expect(payload.challenge.recipient).toBe("nordstrom.com");
      expect(payload.challenge.persona).toBe("Shopping");
      expect(payload.challenge.purpose).toContain("shopping");
      expect(payload.challenge.purpose).toContain("find_item");
      expect(payload.challenge.expires_in_seconds).toBe(900);
      expect(payload.challenge.approval_instructions).toContain(payload.request_id);

      // Fields preview
      expect(payload.challenge.fields).toBeInstanceOf(Array);
      expect(payload.challenge.fields.length).toBeGreaterThanOrEqual(2);
      const fieldKeys = payload.challenge.fields.map((f: any) => f.key);
      expect(fieldKeys).toContain("apparel.pants.waist");
      expect(fieldKeys).toContain("apparel.pants.inseam");

      // No audit event written for ask (only after approve/deny)
      const vault = readVaultFromDisk(vaultPath);
      expect(vault.auditLog).toHaveLength(0);
    });

    it("returns ask for medium-sensitivity fields under alarm_system", async () => {
      writeFileSync(vaultPath, JSON.stringify(buildRealVault(), null, 2), "utf-8");
      const { tools } = setupPlugin(vaultPath);
      const tool = tools.get("personafy_request_context")!;

      const result = await tool.execute("e2e-ask-2", {
        purpose: { category: "shopping", action: "checkout" },
        recipient: { type: "domain", value: "amazon.com" },
        fields_requested: ["apparel.shirt.*"],
      });
      const payload = parseResponse(result);

      expect(payload.decision).toBe("ask");
      expect(payload.challenge.fields.some((f: any) => f.key === "apparel.shirt.size")).toBe(true);
    });

    it("returns ask for travel persona fields", async () => {
      writeFileSync(vaultPath, JSON.stringify(buildRealVault(), null, 2), "utf-8");
      const { tools } = setupPlugin(vaultPath);
      const tool = tools.get("personafy_request_context")!;

      const result = await tool.execute("e2e-ask-travel", {
        purpose: { category: "travel", action: "book" },
        recipient: { type: "domain", value: "expedia.com" },
        persona_hint: "travel",
        fields_requested: ["flight.*", "hotel.*"],
      });
      const payload = parseResponse(result);

      expect(payload.decision).toBe("ask");
      const fieldKeys = payload.challenge.fields.map((f: any) => f.key);
      expect(fieldKeys).toContain("flight.seat_preference");
      expect(fieldKeys).toContain("hotel.room_preference");
    });
  });

  // ---------------------------------------------------------------
  // Scenario 2: Approve flow returns allowed facts + audit_id
  // ---------------------------------------------------------------
  describe("Scenario 2: Approve flow returns allowed facts + audit_id", () => {
    it("full ask→approve flow returns facts, ttl, audit_id, and persists audit event", async () => {
      writeFileSync(vaultPath, JSON.stringify(buildRealVault(), null, 2), "utf-8");
      const { tools } = setupPlugin(vaultPath);
      const tool = tools.get("personafy_request_context")!;

      // Step 1: Ask
      const askResult = await tool.execute("e2e-approve-1", {
        purpose: { category: "shopping", action: "find_item", detail: "denim jeans" },
        recipient: { type: "domain", value: "nordstrom.com" },
        persona_hint: "shopping",
        fields_requested: ["apparel.pants.*"],
      });
      const askPayload = parseResponse(askResult);
      expect(askPayload.decision).toBe("ask");
      const requestId = askPayload.request_id;

      // Step 2: Approve
      const approveResult = await tool.execute("e2e-approve-1", {
        approve: true,
        request_id: requestId,
        purpose: { category: "shopping", action: "find_item" },
        recipient: { type: "domain", value: "nordstrom.com" },
      });
      const approvePayload = parseResponse(approveResult);

      expect(approvePayload.type).toBe("context.response");
      expect(approvePayload.decision).toBe("allow");
      expect(approvePayload.request_id).toBe(requestId);

      // Package contents
      expect(approvePayload.package).toBeDefined();
      expect(approvePayload.package.ttl_seconds).toBe(600); // 10 min * 60
      expect(approvePayload.package.facts).toBeInstanceOf(Array);
      const factKeys = approvePayload.package.facts.map((f: any) => f.key);
      expect(factKeys).toContain("apparel.pants.waist");
      expect(factKeys).toContain("apparel.pants.inseam");

      // Each fact has key, value, confidence
      for (const fact of approvePayload.package.facts) {
        expect(fact).toHaveProperty("key");
        expect(fact).toHaveProperty("value");
        expect(fact).toHaveProperty("confidence");
      }

      // Audit ID
      expect(approvePayload.audit_id).toMatch(/^aud_/);

      // Offer rule hint
      expect(approvePayload.offer_rule).toBeDefined();
      expect(approvePayload.offer_rule.suggested_rule).toBeDefined();
      expect(approvePayload.offer_rule.suggested_rule.recipient_domain).toBe("nordstrom.com");

      // Step 3: Verify audit event persisted to vault file
      const vault = readVaultFromDisk(vaultPath);
      expect(vault.auditLog).toHaveLength(1);

      const auditEvent = vault.auditLog[0];
      expect(auditEvent.id).toBe(approvePayload.audit_id);
      expect(auditEvent.requestId).toBe(requestId);
      expect(auditEvent.decision).toBe("ask_approved");
      expect(auditEvent.recipientDomain).toBe("nordstrom.com");
      expect(auditEvent.purpose).toBe("shopping/find_item");
      expect(auditEvent.fieldsReleased).toContain("apparel.pants.waist");
      expect(auditEvent.fieldsReleased).toContain("apparel.pants.inseam");
      expect(auditEvent.timestamp).toBeTruthy();
    });

    it("approve releases correct facts for wide wildcard request", async () => {
      writeFileSync(vaultPath, JSON.stringify(buildRealVault(), null, 2), "utf-8");
      const { tools } = setupPlugin(vaultPath);
      const tool = tools.get("personafy_request_context")!;

      // Request all apparel facts
      const askResult = await tool.execute("e2e-approve-wide", {
        purpose: { category: "shopping", action: "checkout" },
        recipient: { type: "domain", value: "uniqlo.com" },
        fields_requested: ["apparel.*"],
      });
      const askPayload = parseResponse(askResult);
      expect(askPayload.decision).toBe("ask");

      const approveResult = await tool.execute("e2e-approve-wide", {
        approve: true,
        request_id: askPayload.request_id,
        purpose: { category: "shopping", action: "checkout" },
        recipient: { type: "domain", value: "uniqlo.com" },
      });
      const approvePayload = parseResponse(approveResult);

      expect(approvePayload.decision).toBe("allow");

      // Should include pants, shirt, and shoe facts
      const factKeys = approvePayload.package.facts.map((f: any) => f.key);
      expect(factKeys).toContain("apparel.pants.waist");
      expect(factKeys).toContain("apparel.pants.inseam");
      expect(factKeys).toContain("apparel.shirt.size");
      expect(factKeys).toContain("apparel.shoe.size");

      // Verify audit persists with all released fields
      const vault = readVaultFromDisk(vaultPath);
      expect(vault.auditLog).toHaveLength(1);
      expect(vault.auditLog[0].fieldsReleased.length).toBe(4);
    });
  });

  // ---------------------------------------------------------------
  // Scenario 3: Deny flow returns deny response + audit event
  // ---------------------------------------------------------------
  describe("Scenario 3: Deny flow returns deny response + audit event", () => {
    it("full ask→deny flow returns deny decision and persists audit event", async () => {
      writeFileSync(vaultPath, JSON.stringify(buildRealVault(), null, 2), "utf-8");
      const { tools } = setupPlugin(vaultPath);
      const tool = tools.get("personafy_request_context")!;

      // Step 1: Ask
      const askResult = await tool.execute("e2e-deny-1", {
        purpose: { category: "shopping", action: "sync_data" },
        recipient: { type: "domain", value: "suspicious-tracker.com" },
        persona_hint: "shopping",
        fields_requested: ["budget.*"],
      });
      const askPayload = parseResponse(askResult);
      expect(askPayload.decision).toBe("ask");
      const requestId = askPayload.request_id;

      // Step 2: Deny
      const denyResult = await tool.execute("e2e-deny-1", {
        approve: false,
        request_id: requestId,
        purpose: { category: "shopping", action: "sync_data" },
        recipient: { type: "domain", value: "suspicious-tracker.com" },
      });
      const denyPayload = parseResponse(denyResult);

      expect(denyPayload.type).toBe("context.response");
      expect(denyPayload.decision).toBe("deny");
      expect(denyPayload.request_id).toBe(requestId);
      expect(denyPayload.message).toContain("denied");

      // No facts should be released
      expect(denyPayload.package).toBeUndefined();

      // Step 3: Verify audit event persisted
      const vault = readVaultFromDisk(vaultPath);
      expect(vault.auditLog).toHaveLength(1);

      const auditEvent = vault.auditLog[0];
      expect(auditEvent.requestId).toBe(requestId);
      expect(auditEvent.decision).toBe("ask_denied");
      expect(auditEvent.recipientDomain).toBe("suspicious-tracker.com");
      expect(auditEvent.purpose).toBe("shopping/sync_data");
      expect(auditEvent.fieldsReleased).toEqual([]);
      expect(auditEvent.timestamp).toBeTruthy();
    });

    it("denied request cannot be re-approved", async () => {
      writeFileSync(vaultPath, JSON.stringify(buildRealVault(), null, 2), "utf-8");
      const { tools } = setupPlugin(vaultPath);
      const tool = tools.get("personafy_request_context")!;

      const askResult = await tool.execute("e2e-deny-reuse", {
        purpose: { category: "shopping", action: "find_item" },
        recipient: { type: "domain", value: "example.com" },
        fields_requested: ["apparel.*"],
      });
      const askPayload = parseResponse(askResult);

      // Deny it
      await tool.execute("e2e-deny-reuse", {
        approve: false,
        request_id: askPayload.request_id,
        purpose: { category: "shopping", action: "find_item" },
        recipient: { type: "domain", value: "example.com" },
      });

      // Try to approve the same request — should fail
      const retryResult = await tool.execute("e2e-deny-reuse", {
        approve: true,
        request_id: askPayload.request_id,
        purpose: { category: "shopping", action: "find_item" },
        recipient: { type: "domain", value: "example.com" },
      });
      const retryPayload = parseResponse(retryResult);

      expect(retryPayload.decision).toBe("error");
      expect(retryPayload.error).toContain("expired");
    });
  });

  // ---------------------------------------------------------------
  // Scenario 4: Expired request returns clear error
  // ---------------------------------------------------------------
  describe("Scenario 4: Expired request returns clear error", () => {
    it("returns error for completely non-existent request_id", async () => {
      writeFileSync(vaultPath, JSON.stringify(buildRealVault(), null, 2), "utf-8");
      const { tools } = setupPlugin(vaultPath);
      const tool = tools.get("personafy_request_context")!;

      const result = await tool.execute("e2e-expired-bogus", {
        approve: true,
        request_id: "req_does_not_exist",
        purpose: { category: "shopping", action: "find_item" },
        recipient: { type: "domain", value: "example.com" },
      });
      const payload = parseResponse(result);

      expect(payload.type).toBe("context.response");
      expect(payload.decision).toBe("error");
      expect(payload.error).toContain("expired");
      expect(payload.error).toContain("not found");
    });

    it("returns error when request has timed out after 15 minutes", async () => {
      writeFileSync(vaultPath, JSON.stringify(buildRealVault(), null, 2), "utf-8");
      const { tools } = setupPlugin(vaultPath);
      const tool = tools.get("personafy_request_context")!;

      // Create a request
      const askResult = await tool.execute("e2e-expired-timeout", {
        purpose: { category: "shopping", action: "find_item" },
        recipient: { type: "domain", value: "nordstrom.com" },
        persona_hint: "shopping",
        fields_requested: ["apparel.pants.*"],
      });
      const askPayload = parseResponse(askResult);
      expect(askPayload.decision).toBe("ask");

      // Advance time past the 15-minute timeout
      vi.advanceTimersByTime(16 * 60 * 1000);

      // Try to approve — should fail
      const approveResult = await tool.execute("e2e-expired-timeout", {
        approve: true,
        request_id: askPayload.request_id,
        purpose: { category: "shopping", action: "find_item" },
        recipient: { type: "domain", value: "nordstrom.com" },
      });
      const approvePayload = parseResponse(approveResult);

      expect(approvePayload.decision).toBe("error");
      expect(approvePayload.error).toContain("expired");

      // No audit event should be written for timed-out request
      const vault = readVaultFromDisk(vaultPath);
      expect(vault.auditLog).toHaveLength(0);
    });

    it("request is still valid just before the 15-minute timeout", async () => {
      writeFileSync(vaultPath, JSON.stringify(buildRealVault(), null, 2), "utf-8");
      const { tools } = setupPlugin(vaultPath);
      const tool = tools.get("personafy_request_context")!;

      const askResult = await tool.execute("e2e-expired-before", {
        purpose: { category: "shopping", action: "find_item" },
        recipient: { type: "domain", value: "nordstrom.com" },
        fields_requested: ["apparel.pants.*"],
      });
      const askPayload = parseResponse(askResult);

      // Advance time to just before timeout (14 minutes)
      vi.advanceTimersByTime(14 * 60 * 1000);

      // Approve should still work
      const approveResult = await tool.execute("e2e-expired-before", {
        approve: true,
        request_id: askPayload.request_id,
        purpose: { category: "shopping", action: "find_item" },
        recipient: { type: "domain", value: "nordstrom.com" },
      });
      const approvePayload = parseResponse(approveResult);

      expect(approvePayload.decision).toBe("allow");
      expect(approvePayload.package.facts.length).toBeGreaterThan(0);
    });

    it("deny on expired request also returns error", async () => {
      writeFileSync(vaultPath, JSON.stringify(buildRealVault(), null, 2), "utf-8");
      const { tools } = setupPlugin(vaultPath);
      const tool = tools.get("personafy_request_context")!;

      const askResult = await tool.execute("e2e-deny-expired", {
        purpose: { category: "travel", action: "book" },
        recipient: { type: "domain", value: "expedia.com" },
        persona_hint: "travel",
        fields_requested: ["flight.*"],
      });
      const askPayload = parseResponse(askResult);
      expect(askPayload.decision).toBe("ask");

      // Advance past timeout
      vi.advanceTimersByTime(16 * 60 * 1000);

      // Deny should also fail
      const denyResult = await tool.execute("e2e-deny-expired", {
        approve: false,
        request_id: askPayload.request_id,
        purpose: { category: "travel", action: "book" },
        recipient: { type: "domain", value: "expedia.com" },
      });
      const denyPayload = parseResponse(denyResult);

      expect(denyPayload.decision).toBe("error");
      expect(denyPayload.error).toContain("expired");
    });
  });

  // ---------------------------------------------------------------
  // Cross-cutting: Multi-step flows and audit accumulation
  // ---------------------------------------------------------------
  describe("Cross-cutting: Multi-step audit accumulation", () => {
    it("multiple ask→approve and ask→deny flows accumulate audit events on disk", async () => {
      writeFileSync(vaultPath, JSON.stringify(buildRealVault(), null, 2), "utf-8");
      const { tools } = setupPlugin(vaultPath);
      const tool = tools.get("personafy_request_context")!;

      // Flow 1: Ask → Approve (shopping)
      const ask1 = parseResponse(await tool.execute("e2e-multi-1", {
        purpose: { category: "shopping", action: "find_item" },
        recipient: { type: "domain", value: "nordstrom.com" },
        fields_requested: ["apparel.pants.*"],
      }));
      expect(ask1.decision).toBe("ask");

      const approve1 = parseResponse(await tool.execute("e2e-multi-1", {
        approve: true,
        request_id: ask1.request_id,
        purpose: { category: "shopping", action: "find_item" },
        recipient: { type: "domain", value: "nordstrom.com" },
      }));
      expect(approve1.decision).toBe("allow");

      // Flow 2: Ask → Deny (travel)
      const ask2 = parseResponse(await tool.execute("e2e-multi-2", {
        purpose: { category: "travel", action: "book" },
        recipient: { type: "domain", value: "sketchy-travel.com" },
        persona_hint: "travel",
        fields_requested: ["flight.*"],
      }));
      expect(ask2.decision).toBe("ask");

      const deny2 = parseResponse(await tool.execute("e2e-multi-2", {
        approve: false,
        request_id: ask2.request_id,
        purpose: { category: "travel", action: "book" },
        recipient: { type: "domain", value: "sketchy-travel.com" },
      }));
      expect(deny2.decision).toBe("deny");

      // Flow 3: Ask → Approve (shopping, different domain)
      const ask3 = parseResponse(await tool.execute("e2e-multi-3", {
        purpose: { category: "shopping", action: "checkout" },
        recipient: { type: "domain", value: "uniqlo.com" },
        fields_requested: ["apparel.shirt.*"],
      }));
      expect(ask3.decision).toBe("ask");

      const approve3 = parseResponse(await tool.execute("e2e-multi-3", {
        approve: true,
        request_id: ask3.request_id,
        purpose: { category: "shopping", action: "checkout" },
        recipient: { type: "domain", value: "uniqlo.com" },
      }));
      expect(approve3.decision).toBe("allow");

      // Verify all 3 audit events accumulated on disk
      const vault = readVaultFromDisk(vaultPath);
      expect(vault.auditLog).toHaveLength(3);

      // Event 1: approved shopping
      expect(vault.auditLog[0].decision).toBe("ask_approved");
      expect(vault.auditLog[0].recipientDomain).toBe("nordstrom.com");

      // Event 2: denied travel
      expect(vault.auditLog[1].decision).toBe("ask_denied");
      expect(vault.auditLog[1].recipientDomain).toBe("sketchy-travel.com");
      expect(vault.auditLog[1].fieldsReleased).toEqual([]);

      // Event 3: approved shopping different domain
      expect(vault.auditLog[2].decision).toBe("ask_approved");
      expect(vault.auditLog[2].recipientDomain).toBe("uniqlo.com");
    });
  });

  // ---------------------------------------------------------------
  // Auto-allow under simple_lock (complements ask-only scenarios)
  // ---------------------------------------------------------------
  describe("Auto-allow: simple_lock posture bypasses ask for low-sensitivity", () => {
    it("auto-allows low-sensitivity facts and writes audit directly", async () => {
      const vault = buildRealVault({ privacyPosture: "simple_lock" });
      writeFileSync(vaultPath, JSON.stringify(vault, null, 2), "utf-8");
      const { tools } = setupPlugin(vaultPath);
      const tool = tools.get("personafy_request_context")!;

      const result = await tool.execute("e2e-autoallow", {
        purpose: { category: "shopping", action: "find_item" },
        recipient: { type: "domain", value: "nordstrom.com" },
        fields_requested: ["apparel.pants.*"],
      });
      const payload = parseResponse(result);

      // Should be auto-allowed (no ask step needed)
      expect(payload.decision).toBe("allow");
      expect(payload.package.facts.length).toBeGreaterThan(0);
      expect(payload.audit_id).toMatch(/^aud_/);

      // Verify audit written to disk
      const updated = readVaultFromDisk(vaultPath);
      expect(updated.auditLog).toHaveLength(1);
      expect(updated.auditLog[0].decision).toBe("allow");
      expect(updated.auditLog[0].recipientDomain).toBe("nordstrom.com");
    });
  });

  // ---------------------------------------------------------------
  // Rule creation and subsequent auto-allow via rule
  // ---------------------------------------------------------------
  describe("Rule creation flow: create_rule → auto-allow on subsequent request", () => {
    it("personafy_create_rule persists rule and subsequent matching request auto-allows", async () => {
      const vault = buildRealVault({ privacyPosture: "simple_lock" });
      writeFileSync(vaultPath, JSON.stringify(vault, null, 2), "utf-8");
      const { tools } = setupPlugin(vaultPath);
      const createRuleTool = tools.get("personafy_create_rule")!;
      const requestTool = tools.get("personafy_request_context")!;

      // Create a rule
      const ruleResult = await createRuleTool.execute("e2e-rule", {
        recipient_domain: "marinelayer.com",
        purpose_category: "shopping",
        purpose_action: "find_item",
        allowed_fields: ["apparel.*"],
        max_sensitivity: "low",
        duration_days: 90,
      });
      const rulePayload = parseResponse(ruleResult);

      expect(rulePayload.type).toBe("rule.created");
      expect(rulePayload.rule_id).toMatch(/^rule_/);
      expect(rulePayload.duration_days).toBe(90);

      // Verify rule persisted on disk
      const vaultAfterRule = readVaultFromDisk(vaultPath);
      expect(vaultAfterRule.rules).toHaveLength(1);
      expect(vaultAfterRule.rules[0].recipientDomain).toBe("marinelayer.com");
      expect(vaultAfterRule.rules[0].enabled).toBe(true);

      // Now make a matching request — should auto-allow without ask
      const requestResult = await requestTool.execute("e2e-rule-request", {
        purpose: { category: "shopping", action: "find_item" },
        recipient: { type: "domain", value: "marinelayer.com" },
        fields_requested: ["apparel.pants.*"],
      });
      const requestPayload = parseResponse(requestResult);

      expect(requestPayload.decision).toBe("allow");
      expect(requestPayload.package.facts.length).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------
  // /personafy command audit subcommand reflects E2E state
  // ---------------------------------------------------------------
  describe("/personafy command: audit reflects real E2E state", () => {
    it("audit subcommand shows events from ask→approve flow", async () => {
      writeFileSync(vaultPath, JSON.stringify(buildRealVault(), null, 2), "utf-8");
      const { tools, command } = setupPlugin(vaultPath);
      const tool = tools.get("personafy_request_context")!;

      // Perform an ask→approve
      const ask = parseResponse(await tool.execute("e2e-cmd-audit", {
        purpose: { category: "shopping", action: "find_item" },
        recipient: { type: "domain", value: "nordstrom.com" },
        fields_requested: ["apparel.pants.*"],
      }));
      await tool.execute("e2e-cmd-audit", {
        approve: true,
        request_id: ask.request_id,
        purpose: { category: "shopping", action: "find_item" },
        recipient: { type: "domain", value: "nordstrom.com" },
      });

      // Query audit via command
      expect(command).toBeTruthy();
      const auditOutput = await command!.handler({ args: "audit" });
      expect(auditOutput.text).toContain("nordstrom.com");
      expect(auditOutput.text).toContain("shopping/find_item");
    });
  });
});
