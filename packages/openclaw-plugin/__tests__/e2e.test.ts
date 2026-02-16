import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VaultData as WebVaultData } from "../../../apps/web/src/lib/vault";
import register from "../index";

type Tool = {
  name: string;
  execute: (id: string, params: any) => Promise<{ content: Array<{ type: string; text: string }> }>;
};

describe("personafy_request_context e2e", () => {
  let tempDir: string;
  let vaultPath: string;

  beforeEach(() => {
    vi.useFakeTimers();
    tempDir = mkdtempSync(join(tmpdir(), "personafy-e2e-"));
    vaultPath = join(tempDir, "vault-data.json");
    writeFileSync(vaultPath, JSON.stringify(buildVault(), null, 2), "utf-8");
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("handles ask -> approve flow and audits approval", async () => {
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

    register(api);

    const tool = tools.get("personafy_request_context");
    expect(tool).toBeDefined();

    const requestParams = {
      purpose: {
        category: "shopping",
        action: "find_item",
        detail: "denim jeans",
      },
      recipient: {
        type: "domain",
        value: "nordstrom.com",
      },
      persona_hint: "shopping",
      fields_requested: ["apparel.pants.*"],
    };

    const askResponse = await tool!.execute("test", requestParams);
    const askPayload = JSON.parse(askResponse.content[0].text);

    expect(askPayload.type).toBe("context.response");
    expect(askPayload.decision).toBe("ask");
    expect(askPayload.request_id).toMatch(/^req_/);
    expect(askPayload.challenge.purpose).toContain("shopping");
    expect(askPayload.challenge.recipient).toBe("nordstrom.com");

    const approvalResponse = await tool!.execute("test", {
      approve: true,
      request_id: askPayload.request_id,
      purpose: requestParams.purpose,
      recipient: requestParams.recipient,
    });
    const approvalPayload = JSON.parse(approvalResponse.content[0].text);

    expect(approvalPayload.decision).toBe("allow");
    expect(approvalPayload.request_id).toBe(askPayload.request_id);
    expect(approvalPayload.package.ttl_seconds).toBe(300);
    expect(approvalPayload.package.facts.map((fact: { key: string }) => fact.key)).toEqual(
      expect.arrayContaining(["apparel.pants.waist", "apparel.pants.inseam"]),
    );
    expect(approvalPayload.audit_id).toMatch(/^aud_/);

    const updated = JSON.parse(readFileSync(vaultPath, "utf-8")) as WebVaultData;
    expect(updated.auditLog).toHaveLength(1);
    expect(updated.auditLog[0].decision).toBe("ask_approved");
    expect(updated.auditLog[0].requestId).toBe(askPayload.request_id);
    expect(updated.auditLog[0].recipientDomain).toBe("nordstrom.com");
    expect(updated.auditLog[0].purpose).toBe("shopping/find_item");
    expect(updated.auditLog[0].fieldsReleased).toEqual(
      expect.arrayContaining(["apparel.pants.waist", "apparel.pants.inseam"]),
    );
  });
});

function buildVault(): WebVaultData {
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
  };
}
