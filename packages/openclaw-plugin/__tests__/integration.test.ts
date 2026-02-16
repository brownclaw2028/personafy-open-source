import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import register from "../index";
import type { VaultData } from "../lib";

function makeVault(): VaultData {
  return {
    version: "1.0",
    createdAt: new Date().toISOString(),
    privacyPosture: "alarm_system",
    personas: [
      {
        id: "shopping",
        name: "Shopping",
        category: "shopping",
        facts: [
          { key: "apparel.pants.waist", value: "32", sensitivity: "medium", confidence: 0.92 },
          { key: "apparel.pants.inseam", value: "30", sensitivity: "low", confidence: 0.9 },
        ],
        personaSettings: { visible: true, autoRelease: "follow_posture", retention: "never" },
      },
    ],
    rules: [],
    auditLog: [],
  };
}

function parseResponse(result: any) {
  const text = result?.content?.[0]?.text ?? "{}";
  return JSON.parse(text);
}

describe("personafy_request_context integration", () => {
  it("flows ask → approve and writes audit log", async () => {
    const dir = mkdtempSync(join(tmpdir(), "personafy-"));
    const vaultPath = join(dir, "vault-data.json");
    writeFileSync(vaultPath, JSON.stringify(makeVault(), null, 2), "utf-8");

    try {
      const tools: Record<string, any> = {};
      const api = {
        registerTool: (tool: any) => {
          tools[tool.name] = tool;
        },
        config: {
          plugins: {
            entries: {
              personafy: { config: { vaultPath } },
            },
          },
        },
      };

      register(api);

      const tool = tools["personafy_request_context"];
      expect(tool).toBeTruthy();

      const baseParams = {
        purpose: { category: "shopping", action: "find_item", detail: "pants" },
        recipient: { type: "domain", value: "nordstrom.com" },
        fields_requested: ["apparel.pants.*"],
      };

      const askResult = await tool.execute("req-1", baseParams);
      const askPayload = parseResponse(askResult);

      expect(askPayload.decision).toBe("ask");
      expect(askPayload.request_id).toMatch(/^req_/);
      expect(askPayload.challenge?.fields?.length).toBeGreaterThan(0);

      const approveResult = await tool.execute("req-1", {
        ...baseParams,
        approve: true,
        request_id: askPayload.request_id,
      });
      const approvePayload = parseResponse(approveResult);

      expect(approvePayload.decision).toBe("allow");
      expect(approvePayload.package?.facts?.length).toBeGreaterThan(0);
      expect(approvePayload.audit_id).toMatch(/^aud_/);

      const updated = JSON.parse(readFileSync(vaultPath, "utf-8"));
      const auditEvent = updated.auditLog?.find((evt: any) => evt.requestId === askPayload.request_id);

      expect(auditEvent).toBeTruthy();
      expect(auditEvent.decision).toBe("ask_approved");
      expect(auditEvent.recipientDomain).toBe("nordstrom.com");
      expect(auditEvent.fieldsReleased?.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
