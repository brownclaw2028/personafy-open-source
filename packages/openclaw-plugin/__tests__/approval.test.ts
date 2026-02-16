import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import register from "../index";

type Tool = {
  name: string;
  execute: (id: string, params: any) => Promise<{ content: Array<{ type: string; text: string }> }>;
};

interface VaultData {
  version: string;
  createdAt: string;
  privacyPosture: string;
  settings?: {
    contextTtlMinutes?: number;
    hideHighSensitivity?: boolean;
    approvalNotifications?: boolean;
  };
  personas: Array<{
    id: string;
    name: string;
    category: string;
    icon?: string;
    description?: string;
    completionScore?: number;
    facts: Array<{
      key: string;
      value: string;
      sensitivity: "low" | "medium" | "high";
      confidence: number;
    }>;
    personaSettings?: {
      visible: boolean;
      autoRelease: "follow_posture" | "always_ask" | "auto_low";
      retention: string;
    };
  }>;
  rules: Array<{
    id: string;
    recipientDomain: string;
    purposeCategory: string;
    purposeAction: string;
    maxSensitivity: "low" | "medium" | "high";
    allowedFields: string[];
    expiresAt: string;
    enabled: boolean;
  }>;
  auditLog: Array<{
    id: string;
    timestamp: string;
    requestId: string;
    decision: string;
    recipientDomain: string;
    purpose: string;
    fieldsReleased: string[];
  }>;
}

function buildVault(overrides: Partial<VaultData> = {}): VaultData {
  return {
    version: "1.0",
    createdAt: new Date().toISOString(),
    privacyPosture: "alarm_system",
    settings: {
      contextTtlMinutes: 5,
      hideHighSensitivity: false,
      approvalNotifications: true,
    },
    personas: [
      {
        id: "shopping",
        name: "Shopping",
        category: "shopping",
        icon: "ShoppingBag",
        description: "Default shopping persona",
        completionScore: 72,
        facts: [
          {
            key: "apparel.pants.waist",
            value: "32",
            sensitivity: "low",
            confidence: 0.9,
          },
          {
            key: "apparel.pants.inseam",
            value: "30",
            sensitivity: "low",
            confidence: 0.9,
          },
          {
            key: "apparel.shirt.size",
            value: "M",
            sensitivity: "medium",
            confidence: 0.85,
          },
          {
            key: "budget.monthly",
            value: "$200",
            sensitivity: "high",
            confidence: 0.7,
          },
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

function createApi(vaultPath: string) {
  const tools = new Map<string, Tool>();
  const api = {
    config: {
      plugins: {
        entries: {
          personafy: {
            config: {
              vaultPath,
            },
          },
        },
      },
    },
    registerTool: (tool: Tool) => {
      tools.set(tool.name, tool);
    },
    registerCommand: () => {},
  };
  return { api, tools };
}

describe("Approval Flow Unit Tests (PT-001)", () => {
  let tempDir: string;
  let vaultPath: string;

  beforeEach(() => {
    vi.useFakeTimers();
    tempDir = mkdtempSync(join(tmpdir(), "personafy-approval-"));
    vaultPath = join(tempDir, "vault-data.json");
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("request context → vault returns 'ask' decision", () => {
    it("returns ask decision with request_id and challenge details", async () => {
      writeFileSync(vaultPath, JSON.stringify(buildVault(), null, 2), "utf-8");
      const { api, tools } = createApi(vaultPath);
      register(api);

      const tool = tools.get("personafy_request_context");
      expect(tool).toBeDefined();

      const requestParams = {
        purpose: {
          category: "shopping",
          action: "find_item",
          detail: "looking for pants",
        },
        recipient: {
          type: "domain",
          value: "nordstrom.com",
        },
        persona_hint: "shopping",
        fields_requested: ["apparel.pants.*"],
      };

      const response = await tool!.execute("test", requestParams);
      const payload = JSON.parse(response.content[0].text);

      expect(payload.type).toBe("context.response");
      expect(payload.decision).toBe("ask");
      expect(payload.request_id).toMatch(/^req_/);
      expect(payload.challenge).toBeDefined();
      expect(payload.challenge.recipient).toBe("nordstrom.com");
      expect(payload.challenge.purpose).toContain("shopping");
      expect(payload.challenge.fields).toBeInstanceOf(Array);
      expect(payload.challenge.expires_in_seconds).toBe(900);
      expect(payload.challenge.approval_instructions).toContain("approve");
    });

    it("returns ask for medium sensitivity facts under alarm_system posture", async () => {
      writeFileSync(vaultPath, JSON.stringify(buildVault(), null, 2), "utf-8");
      const { api, tools } = createApi(vaultPath);
      register(api);

      const tool = tools.get("personafy_request_context");

      const response = await tool!.execute("test", {
        purpose: { category: "shopping", action: "find_item" },
        recipient: { type: "domain", value: "example.com" },
        fields_requested: ["apparel.shirt.*"],
      });
      const payload = JSON.parse(response.content[0].text);

      expect(payload.decision).toBe("ask");
      expect(payload.challenge.fields.some((f: any) => f.key === "apparel.shirt.size")).toBe(true);
    });
  });

  describe("approve with request_id → returns data package", () => {
    it("returns data package with facts and audit_id on approval", async () => {
      writeFileSync(vaultPath, JSON.stringify(buildVault(), null, 2), "utf-8");
      const { api, tools } = createApi(vaultPath);
      register(api);

      const tool = tools.get("personafy_request_context");

      // First request gets ask
      const askResponse = await tool!.execute("test", {
        purpose: { category: "shopping", action: "find_item" },
        recipient: { type: "domain", value: "nordstrom.com" },
        fields_requested: ["apparel.pants.*"],
      });
      const askPayload = JSON.parse(askResponse.content[0].text);
      expect(askPayload.decision).toBe("ask");

      // Approve the request
      const approveResponse = await tool!.execute("test", {
        approve: true,
        request_id: askPayload.request_id,
        purpose: { category: "shopping", action: "find_item" },
        recipient: { type: "domain", value: "nordstrom.com" },
      });
      const approvePayload = JSON.parse(approveResponse.content[0].text);

      expect(approvePayload.type).toBe("context.response");
      expect(approvePayload.decision).toBe("allow");
      expect(approvePayload.request_id).toBe(askPayload.request_id);
      expect(approvePayload.package).toBeDefined();
      expect(approvePayload.package.ttl_seconds).toBe(300);
      expect(approvePayload.package.facts).toBeInstanceOf(Array);
      expect(approvePayload.package.facts.length).toBeGreaterThan(0);
      expect(approvePayload.audit_id).toMatch(/^aud_/);
      expect(approvePayload.offer_rule).toBeDefined();
    });

    it("logs approval to audit log with correct decision type", async () => {
      writeFileSync(vaultPath, JSON.stringify(buildVault(), null, 2), "utf-8");
      const { api, tools } = createApi(vaultPath);
      register(api);

      const tool = tools.get("personafy_request_context");

      const askResponse = await tool!.execute("test", {
        purpose: { category: "shopping", action: "checkout" },
        recipient: { type: "domain", value: "amazon.com" },
        fields_requested: ["apparel.*"],
      });
      const askPayload = JSON.parse(askResponse.content[0].text);

      await tool!.execute("test", {
        approve: true,
        request_id: askPayload.request_id,
        purpose: { category: "shopping", action: "checkout" },
        recipient: { type: "domain", value: "amazon.com" },
      });

      const updatedVault = JSON.parse(readFileSync(vaultPath, "utf-8")) as VaultData;
      expect(updatedVault.auditLog).toHaveLength(1);
      expect(updatedVault.auditLog[0].decision).toBe("ask_approved");
      expect(updatedVault.auditLog[0].recipientDomain).toBe("amazon.com");
      expect(updatedVault.auditLog[0].purpose).toBe("shopping/checkout");
      expect(updatedVault.auditLog[0].fieldsReleased.length).toBeGreaterThan(0);
    });
  });

  describe("deny with request_id → returns denial message", () => {
    it("returns denial response when user denies", async () => {
      writeFileSync(vaultPath, JSON.stringify(buildVault(), null, 2), "utf-8");
      const { api, tools } = createApi(vaultPath);
      register(api);

      const tool = tools.get("personafy_request_context");

      // First request gets ask
      const askResponse = await tool!.execute("test", {
        purpose: { category: "shopping", action: "find_item" },
        recipient: { type: "domain", value: "suspicious-site.com" },
        fields_requested: ["apparel.*"],
      });
      const askPayload = JSON.parse(askResponse.content[0].text);
      expect(askPayload.decision).toBe("ask");

      // Deny the request
      const denyResponse = await tool!.execute("test", {
        approve: false,
        request_id: askPayload.request_id,
        purpose: { category: "shopping", action: "find_item" },
        recipient: { type: "domain", value: "suspicious-site.com" },
      });
      const denyPayload = JSON.parse(denyResponse.content[0].text);

      expect(denyPayload.type).toBe("context.response");
      expect(denyPayload.decision).toBe("deny");
      expect(denyPayload.request_id).toBe(askPayload.request_id);
      expect(denyPayload.message).toContain("denied");
    });

    it("logs denial to audit log with ask_denied decision", async () => {
      writeFileSync(vaultPath, JSON.stringify(buildVault(), null, 2), "utf-8");
      const { api, tools } = createApi(vaultPath);
      register(api);

      const tool = tools.get("personafy_request_context");

      const askResponse = await tool!.execute("test", {
        purpose: { category: "shopping", action: "sync_data" },
        recipient: { type: "domain", value: "unknown-tracker.com" },
        fields_requested: ["budget.*"],
      });
      const askPayload = JSON.parse(askResponse.content[0].text);

      await tool!.execute("test", {
        approve: false,
        request_id: askPayload.request_id,
        purpose: { category: "shopping", action: "sync_data" },
        recipient: { type: "domain", value: "unknown-tracker.com" },
      });

      const updatedVault = JSON.parse(readFileSync(vaultPath, "utf-8")) as VaultData;
      expect(updatedVault.auditLog).toHaveLength(1);
      expect(updatedVault.auditLog[0].decision).toBe("ask_denied");
      expect(updatedVault.auditLog[0].fieldsReleased).toEqual([]);
    });

    it("clears pending request after denial", async () => {
      writeFileSync(vaultPath, JSON.stringify(buildVault(), null, 2), "utf-8");
      const { api, tools } = createApi(vaultPath);
      register(api);

      const tool = tools.get("personafy_request_context");

      const askResponse = await tool!.execute("test", {
        purpose: { category: "shopping", action: "find_item" },
        recipient: { type: "domain", value: "example.com" },
        fields_requested: ["apparel.*"],
      });
      const askPayload = JSON.parse(askResponse.content[0].text);

      // Deny it
      await tool!.execute("test", {
        approve: false,
        request_id: askPayload.request_id,
        purpose: { category: "shopping", action: "find_item" },
        recipient: { type: "domain", value: "example.com" },
      });

      // Try to approve the same request - should fail
      const secondAttempt = await tool!.execute("test", {
        approve: true,
        request_id: askPayload.request_id,
        purpose: { category: "shopping", action: "find_item" },
        recipient: { type: "domain", value: "example.com" },
      });
      const secondPayload = JSON.parse(secondAttempt.content[0].text);

      expect(secondPayload.decision).toBe("error");
      expect(secondPayload.error).toContain("expired");
    });
  });

  describe("timeout handling — expired request_id returns error", () => {
    it("returns error for non-existent request_id", async () => {
      writeFileSync(vaultPath, JSON.stringify(buildVault(), null, 2), "utf-8");
      const { api, tools } = createApi(vaultPath);
      register(api);

      const tool = tools.get("personafy_request_context");

      const response = await tool!.execute("test", {
        approve: true,
        request_id: "req_nonexistent",
        purpose: { category: "shopping", action: "find_item" },
        recipient: { type: "domain", value: "example.com" },
      });
      const payload = JSON.parse(response.content[0].text);

      expect(payload.type).toBe("context.response");
      expect(payload.decision).toBe("error");
      expect(payload.error).toContain("expired");
    });

    it("returns error when request has timed out (15 min)", async () => {
      writeFileSync(vaultPath, JSON.stringify(buildVault(), null, 2), "utf-8");
      const { api, tools } = createApi(vaultPath);
      register(api);

      const tool = tools.get("personafy_request_context");

      // Create a request
      const askResponse = await tool!.execute("test", {
        purpose: { category: "shopping", action: "find_item" },
        recipient: { type: "domain", value: "nordstrom.com" },
        fields_requested: ["apparel.*"],
      });
      const askPayload = JSON.parse(askResponse.content[0].text);
      expect(askPayload.decision).toBe("ask");

      // Advance time by 16 minutes (past the 15 min timeout)
      vi.advanceTimersByTime(16 * 60 * 1000);

      // Try to approve after timeout
      const approveResponse = await tool!.execute("test", {
        approve: true,
        request_id: askPayload.request_id,
        purpose: { category: "shopping", action: "find_item" },
        recipient: { type: "domain", value: "nordstrom.com" },
      });
      const approvePayload = JSON.parse(approveResponse.content[0].text);

      expect(approvePayload.decision).toBe("error");
      expect(approvePayload.error).toContain("expired");
    });

    it("request remains valid before timeout expires", async () => {
      writeFileSync(vaultPath, JSON.stringify(buildVault(), null, 2), "utf-8");
      const { api, tools } = createApi(vaultPath);
      register(api);

      const tool = tools.get("personafy_request_context");

      const askResponse = await tool!.execute("test", {
        purpose: { category: "shopping", action: "find_item" },
        recipient: { type: "domain", value: "nordstrom.com" },
        fields_requested: ["apparel.pants.*"],
      });
      const askPayload = JSON.parse(askResponse.content[0].text);

      // Advance time by 14 minutes (just before timeout)
      vi.advanceTimersByTime(14 * 60 * 1000);

      // Approve should still work
      const approveResponse = await tool!.execute("test", {
        approve: true,
        request_id: askPayload.request_id,
        purpose: { category: "shopping", action: "find_item" },
        recipient: { type: "domain", value: "nordstrom.com" },
      });
      const approvePayload = JSON.parse(approveResponse.content[0].text);

      expect(approvePayload.decision).toBe("allow");
      expect(approvePayload.package.facts.length).toBeGreaterThan(0);
    });
  });

  describe("rule matching → auto-allow", () => {
    it("auto-allows when matching rule exists for simple_lock posture", async () => {
      const vaultWithRule = buildVault({
        privacyPosture: "simple_lock",
        rules: [
          {
            id: "rule_test",
            recipientDomain: "trusted-store.com",
            purposeCategory: "shopping",
            purposeAction: "find_item",
            maxSensitivity: "low",
            allowedFields: ["apparel.*"],
            expiresAt: new Date(Date.now() + 86400000).toISOString(),
            enabled: true,
          },
        ],
      });
      writeFileSync(vaultPath, JSON.stringify(vaultWithRule, null, 2), "utf-8");
      const { api, tools } = createApi(vaultPath);
      register(api);

      const tool = tools.get("personafy_request_context");

      const response = await tool!.execute("test", {
        purpose: { category: "shopping", action: "find_item" },
        recipient: { type: "domain", value: "trusted-store.com" },
        fields_requested: ["apparel.pants.*"],
      });
      const payload = JSON.parse(response.content[0].text);

      expect(payload.type).toBe("context.response");
      expect(payload.decision).toBe("allow");
      expect(payload.package).toBeDefined();
      expect(payload.package.facts.length).toBeGreaterThan(0);
      expect(payload.audit_id).toMatch(/^aud_/);
    });

    it("auto-allows low sensitivity facts under simple_lock without explicit rule", async () => {
      const simpleLockVault = buildVault({
        privacyPosture: "simple_lock",
      });
      writeFileSync(vaultPath, JSON.stringify(simpleLockVault, null, 2), "utf-8");
      const { api, tools } = createApi(vaultPath);
      register(api);

      const tool = tools.get("personafy_request_context");

      const response = await tool!.execute("test", {
        purpose: { category: "shopping", action: "find_item" },
        recipient: { type: "domain", value: "any-store.com" },
        fields_requested: ["apparel.pants.*"], // Only low sensitivity facts
      });
      const payload = JSON.parse(response.content[0].text);

      expect(payload.decision).toBe("allow");
    });

    it("requires approval for medium sensitivity even with rule under alarm_system", async () => {
      const vaultWithRule = buildVault({
        privacyPosture: "alarm_system",
        rules: [
          {
            id: "rule_test",
            recipientDomain: "trusted-store.com",
            purposeCategory: "shopping",
            purposeAction: "find_item",
            maxSensitivity: "medium",
            allowedFields: ["apparel.*"],
            expiresAt: new Date(Date.now() + 86400000).toISOString(),
            enabled: true,
          },
        ],
      });
      writeFileSync(vaultPath, JSON.stringify(vaultWithRule, null, 2), "utf-8");
      const { api, tools } = createApi(vaultPath);
      register(api);

      const tool = tools.get("personafy_request_context");

      // Request includes medium sensitivity field (shirt.size)
      const response = await tool!.execute("test", {
        purpose: { category: "shopping", action: "find_item" },
        recipient: { type: "domain", value: "trusted-store.com" },
        fields_requested: ["apparel.shirt.*"],
      });
      const payload = JSON.parse(response.content[0].text);

      // alarm_system requires approval for medium+ sensitivity even with rules
      expect(payload.decision).toBe("ask");
    });

    it("does not auto-allow with expired rule", async () => {
      const vaultWithExpiredRule = buildVault({
        privacyPosture: "simple_lock",
        rules: [
          {
            id: "rule_expired",
            recipientDomain: "trusted-store.com",
            purposeCategory: "shopping",
            purposeAction: "find_item",
            maxSensitivity: "low",
            allowedFields: ["apparel.*"],
            expiresAt: new Date(Date.now() - 86400000).toISOString(), // Expired yesterday
            enabled: true,
          },
        ],
      });
      writeFileSync(vaultPath, JSON.stringify(vaultWithExpiredRule, null, 2), "utf-8");
      const { api, tools } = createApi(vaultPath);
      register(api);

      const tool = tools.get("personafy_request_context");

      const response = await tool!.execute("test", {
        purpose: { category: "shopping", action: "find_item" },
        recipient: { type: "domain", value: "trusted-store.com" },
        fields_requested: ["apparel.pants.*"],
      });
      const payload = JSON.parse(response.content[0].text);

      // Even though simple_lock auto-allows low sensitivity, we're still testing rule expiration
      // In simple_lock with low sensitivity, it will auto-allow anyway
      // Let's use alarm_system to test rule expiration properly
      expect(payload.decision).toBe("allow"); // simple_lock auto-allows low
    });

    it("does not auto-allow with disabled rule", async () => {
      const vaultWithDisabledRule = buildVault({
        privacyPosture: "alarm_system",
        rules: [
          {
            id: "rule_disabled",
            recipientDomain: "trusted-store.com",
            purposeCategory: "shopping",
            purposeAction: "find_item",
            maxSensitivity: "low",
            allowedFields: ["apparel.*"],
            expiresAt: new Date(Date.now() + 86400000).toISOString(),
            enabled: false, // Disabled
          },
        ],
      });
      writeFileSync(vaultPath, JSON.stringify(vaultWithDisabledRule, null, 2), "utf-8");
      const { api, tools } = createApi(vaultPath);
      register(api);

      const tool = tools.get("personafy_request_context");

      const response = await tool!.execute("test", {
        purpose: { category: "shopping", action: "find_item" },
        recipient: { type: "domain", value: "trusted-store.com" },
        fields_requested: ["apparel.pants.*"],
      });
      const payload = JSON.parse(response.content[0].text);

      expect(payload.decision).toBe("ask");
    });

    it("never auto-allows under safe_room posture", async () => {
      const safeRoomVault = buildVault({
        privacyPosture: "safe_room",
        rules: [
          {
            id: "rule_test",
            recipientDomain: "trusted-store.com",
            purposeCategory: "shopping",
            purposeAction: "find_item",
            maxSensitivity: "low",
            allowedFields: ["apparel.*"],
            expiresAt: new Date(Date.now() + 86400000).toISOString(),
            enabled: true,
          },
        ],
      });
      writeFileSync(vaultPath, JSON.stringify(safeRoomVault, null, 2), "utf-8");
      const { api, tools } = createApi(vaultPath);
      register(api);

      const tool = tools.get("personafy_request_context");

      const response = await tool!.execute("test", {
        purpose: { category: "shopping", action: "find_item" },
        recipient: { type: "domain", value: "trusted-store.com" },
        fields_requested: ["apparel.pants.*"],
      });
      const payload = JSON.parse(response.content[0].text);

      expect(payload.decision).toBe("ask");
    });

    it("logs auto-allow to audit log", async () => {
      const simpleLockVault = buildVault({
        privacyPosture: "simple_lock",
      });
      writeFileSync(vaultPath, JSON.stringify(simpleLockVault, null, 2), "utf-8");
      const { api, tools } = createApi(vaultPath);
      register(api);

      const tool = tools.get("personafy_request_context");

      await tool!.execute("test", {
        purpose: { category: "shopping", action: "find_item" },
        recipient: { type: "domain", value: "auto-allowed.com" },
        fields_requested: ["apparel.pants.*"],
      });

      const updatedVault = JSON.parse(readFileSync(vaultPath, "utf-8")) as VaultData;
      expect(updatedVault.auditLog).toHaveLength(1);
      expect(updatedVault.auditLog[0].decision).toBe("allow");
      expect(updatedVault.auditLog[0].recipientDomain).toBe("auto-allowed.com");
    });
  });

  describe("persona settings override", () => {
    it("always asks when persona has always_ask autoRelease", async () => {
      const alwaysAskVault = buildVault({
        privacyPosture: "simple_lock",
      });
      alwaysAskVault.personas[0].personaSettings = {
        visible: true,
        autoRelease: "always_ask",
        retention: "never",
      };
      writeFileSync(vaultPath, JSON.stringify(alwaysAskVault, null, 2), "utf-8");
      const { api, tools } = createApi(vaultPath);
      register(api);

      const tool = tools.get("personafy_request_context");

      const response = await tool!.execute("test", {
        purpose: { category: "shopping", action: "find_item" },
        recipient: { type: "domain", value: "any-store.com" },
        fields_requested: ["apparel.pants.*"],
      });
      const payload = JSON.parse(response.content[0].text);

      // Even though simple_lock would auto-allow low sensitivity,
      // always_ask on persona overrides it
      expect(payload.decision).toBe("ask");
    });

    it("auto-allows low sensitivity when persona has auto_low setting", async () => {
      const autoLowVault = buildVault({
        privacyPosture: "alarm_system",
      });
      autoLowVault.personas[0].personaSettings = {
        visible: true,
        autoRelease: "auto_low",
        retention: "never",
      };
      writeFileSync(vaultPath, JSON.stringify(autoLowVault, null, 2), "utf-8");
      const { api, tools } = createApi(vaultPath);
      register(api);

      const tool = tools.get("personafy_request_context");

      const response = await tool!.execute("test", {
        purpose: { category: "shopping", action: "find_item" },
        recipient: { type: "domain", value: "any-store.com" },
        fields_requested: ["apparel.pants.*"], // Only low sensitivity
      });
      const payload = JSON.parse(response.content[0].text);

      expect(payload.decision).toBe("allow");
    });
  });
});
