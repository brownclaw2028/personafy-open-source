import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import register from "../index";

type Tool = {
  name: string;
  execute: (id: string, params: any) => Promise<{ content: Array<{ type: string; text: string }> }>;
};

type Command = {
  name: string;
  handler: (ctx: { args?: string }) => Promise<{ text: string }>;
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
  devices?: Array<{
    id: string;
    name: string;
    status: "pairing" | "connected" | "offline";
    lastSeen?: string;
    version?: string;
    pairingCode?: string;
    pairingExpiresAt?: string;
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
        facts: [
          { key: "apparel.pants.waist", value: "32", sensitivity: "low", confidence: 0.9 },
          { key: "apparel.pants.inseam", value: "30", sensitivity: "low", confidence: 0.9 },
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
    devices: [],
    ...overrides,
  };
}

function parseToolResponse(result: { content: Array<{ type: string; text: string }> }) {
  return JSON.parse(result.content[0]?.text ?? "{}");
}

function setupPlugin(vaultPath: string, withCommand = true) {
  const tools = new Map<string, Tool>();
  let command: Command | null = null;

  const api: any = {
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
  };

  if (withCommand) {
    api.registerCommand = (cmd: Command) => {
      command = cmd;
    };
  }

  register(api);
  return { tools, command };
}

describe("personafy_create_rule", () => {
  it("creates a rule and writes audit log", async () => {
    const dir = mkdtempSync(join(tmpdir(), "personafy-rule-"));
    const vaultPath = join(dir, "vault-data.json");
    writeFileSync(vaultPath, JSON.stringify(buildVault(), null, 2), "utf-8");

    try {
      const { tools } = setupPlugin(vaultPath);
      const tool = tools.get("personafy_create_rule");
      expect(tool).toBeDefined();

      const response = await tool!.execute("test", {
        recipient_domain: "nordstrom.com",
        purpose_category: "shopping",
        purpose_action: "find_item",
        allowed_fields: ["apparel.pants.*"],
        max_sensitivity: "medium",
        duration_days: 45,
      });
      const payload = parseToolResponse(response);

      expect(payload.type).toBe("rule.created");
      expect(payload.rule_id).toMatch(/^rule_/);
      expect(payload.duration_days).toBe(45);
      expect(payload.fields).toEqual(["apparel.pants.*"]);

      const updated = JSON.parse(readFileSync(vaultPath, "utf-8")) as VaultData;
      expect(updated.rules).toHaveLength(1);
      expect(updated.rules[0].recipientDomain).toBe("nordstrom.com");
      expect(updated.rules[0].enabled).toBe(true);
      expect(updated.auditLog).toHaveLength(1);
      expect(updated.auditLog[0].purpose).toContain("rule_created");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns rule.exists when duplicate enabled rule already exists", async () => {
    const dir = mkdtempSync(join(tmpdir(), "personafy-rule-dup-"));
    const vaultPath = join(dir, "vault-data.json");
    writeFileSync(vaultPath, JSON.stringify(buildVault(), null, 2), "utf-8");

    try {
      const { tools } = setupPlugin(vaultPath);
      const tool = tools.get("personafy_create_rule");
      expect(tool).toBeDefined();

      await tool!.execute("test", {
        recipient_domain: "nordstrom.com",
        purpose_category: "shopping",
        purpose_action: "find_item",
        allowed_fields: ["apparel.pants.*"],
      });

      const duplicate = await tool!.execute("test", {
        recipient_domain: "nordstrom.com",
        purpose_category: "shopping",
        purpose_action: "find_item",
        allowed_fields: ["apparel.pants.*"],
      });
      const payload = parseToolResponse(duplicate);

      expect(payload.type).toBe("rule.exists");
      expect(payload.message).toContain("already exists");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns error JSON when vault does not exist", async () => {
    const dir = mkdtempSync(join(tmpdir(), "personafy-rule-missing-"));
    const vaultPath = join(dir, "missing-vault-data.json");

    try {
      const { tools } = setupPlugin(vaultPath);
      const tool = tools.get("personafy_create_rule");
      expect(tool).toBeDefined();

      const response = await tool!.execute("test", {
        recipient_domain: "nordstrom.com",
        purpose_category: "shopping",
        purpose_action: "find_item",
        allowed_fields: ["apparel.pants.*"],
      });
      const payload = parseToolResponse(response);

      expect(payload.error).toBeTypeOf("string");
      expect(payload.error.toLowerCase()).toContain("vault");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("/personafy command handler", () => {
  it("registers command when API exposes registerCommand", () => {
    const dir = mkdtempSync(join(tmpdir(), "personafy-cmd-reg-"));
    const vaultPath = join(dir, "vault-data.json");
    writeFileSync(vaultPath, JSON.stringify(buildVault(), null, 2), "utf-8");

    try {
      const { command } = setupPlugin(vaultPath, true);
      expect(command).toBeTruthy();
      expect(command?.name).toBe("personafy");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not throw when registerCommand is unavailable", () => {
    const dir = mkdtempSync(join(tmpdir(), "personafy-cmd-noapi-"));
    const vaultPath = join(dir, "vault-data.json");
    writeFileSync(vaultPath, JSON.stringify(buildVault(), null, 2), "utf-8");

    try {
      expect(() => setupPlugin(vaultPath, false)).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("supports status/personas/audit/default subcommands", async () => {
    const dir = mkdtempSync(join(tmpdir(), "personafy-cmd-basic-"));
    const vaultPath = join(dir, "vault-data.json");
    writeFileSync(vaultPath, JSON.stringify(buildVault(), null, 2), "utf-8");

    try {
      const { command } = setupPlugin(vaultPath, true);
      expect(command).toBeTruthy();

      const status = await command!.handler({ args: "status" });
      expect(status.text).toContain("Personafy Vault Status");
      expect(status.text).toContain("Personas:");

      const personas = await command!.handler({ args: "personas" });
      expect(personas.text).toContain("Personafy Personas");
      expect(personas.text).toContain("Shopping");

      const audit = await command!.handler({ args: "audit" });
      expect(audit.text).toContain("No events yet");

      const unknown = await command!.handler({ args: "wat" });
      expect(unknown.text).toContain("Usage: /personafy");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("handles pair subcommand: usage, safe-room, invalid, expired, and success paths", async () => {
    const dir = mkdtempSync(join(tmpdir(), "personafy-cmd-pair-"));
    const vaultPath = join(dir, "vault-data.json");
    const now = Date.now();
    const vault = buildVault({
      devices: [
        {
          id: "dev_expired",
          name: "Old Device",
          status: "pairing",
          pairingCode: "PFY-OLD-0000",
          pairingExpiresAt: new Date(now - 60_000).toISOString(),
          version: "1.0.0",
        },
        {
          id: "dev_ready",
          name: "New Device",
          status: "pairing",
          pairingCode: "PFY-NEW-0001",
          pairingExpiresAt: new Date(now + 60_000).toISOString(),
          version: "1.0.0",
        },
      ],
    });
    writeFileSync(vaultPath, JSON.stringify(vault, null, 2), "utf-8");

    try {
      const { command } = setupPlugin(vaultPath, true);
      expect(command).toBeTruthy();

      const usage = await command!.handler({ args: "pair" });
      expect(usage.text).toContain("Usage: /personafy pair");

      const invalid = await command!.handler({ args: "pair PFY-NOPE-9999" });
      expect(invalid.text).toContain("No pending pairing request found");

      const expired = await command!.handler({ args: "pair PFY-OLD-0000" });
      expect(expired.text).toContain("has expired");

      const success = await command!.handler({ args: "pair PFY-NEW-0001 My-Laptop" });
      expect(success.text).toContain("Paired");
      expect(success.text).toContain("My-Laptop");

      const updated = JSON.parse(readFileSync(vaultPath, "utf-8")) as VaultData;
      const device = updated.devices?.find((d) => d.id === "dev_ready");
      expect(device?.status).toBe("connected");
      expect(device?.name).toBe("My-Laptop");
      expect(device?.pairingCode).toBeUndefined();
      expect(device?.pairingExpiresAt).toBeUndefined();

      writeFileSync(
        vaultPath,
        JSON.stringify(
          buildVault({
            privacyPosture: "safe_room",
          }),
          null,
          2
        ),
        "utf-8"
      );
      const safeRoom = await command!.handler({ args: "pair PFY-NEW-0001" });
      expect(safeRoom.text).toContain("Pairing is disabled in Safe Room mode");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
