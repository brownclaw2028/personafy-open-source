import { readFileSync, writeFileSync, existsSync, renameSync } from "fs";
import { resolve } from "path";
import { createCipheriv, createDecipheriv, randomBytes, randomUUID, scryptSync } from "crypto";

// Re-export types and pure logic from lib (testable without mocking I/O)
import {
  type Fact,
  type Persona,
  type PersonaSettings,
  type PolicyRule,
  type AuditEvent,
  type VaultData,
  type VaultDevice,
  type PendingApproval,
  isPersonaVisible,
  findMatchingPersona,
  findHiddenPersona,
  matchFacts,
  fieldMatchesPattern,
  checkAutoAllow,
  getContextTtlSeconds,
} from "./lib.js";

// Pending requests store (in-memory cache, will be synced with vault file)
const pendingRequests: Map<string, PendingApproval> = new Map();

const SCRYPT_PARAMS = { N: 32768, r: 8, p: 1 };
const SALT_BYTES = 16;
const IV_BYTES = 12;
const KEY_BYTES = 32;

interface EncryptedVaultEnvelope {
  version: 1;
  encrypted: true;
  kdf: "scrypt";
  kdfParams: { N: number; r: number; p: number; dkLen: number };
  cipher: "aes-256-gcm";
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
}

function isEncryptedEnvelope(value: unknown): value is EncryptedVaultEnvelope {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return (
    obj.encrypted === true &&
    obj.cipher === "aes-256-gcm" &&
    typeof obj.salt === "string" &&
    typeof obj.iv === "string" &&
    typeof obj.tag === "string" &&
    typeof obj.ciphertext === "string"
  );
}

function encryptVaultData(data: VaultData, passphrase: string): EncryptedVaultEnvelope {
  const salt = randomBytes(SALT_BYTES);
  const key = scryptSync(passphrase, salt, KEY_BYTES, SCRYPT_PARAMS);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = JSON.stringify(data);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    version: 1,
    encrypted: true,
    kdf: "scrypt",
    kdfParams: { ...SCRYPT_PARAMS, dkLen: KEY_BYTES },
    cipher: "aes-256-gcm",
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

function decryptVaultData(envelope: EncryptedVaultEnvelope, passphrase: string): VaultData {
  const salt = Buffer.from(envelope.salt, "base64");
  const iv = Buffer.from(envelope.iv, "base64");
  const tag = Buffer.from(envelope.tag, "base64");
  const ciphertext = Buffer.from(envelope.ciphertext, "base64");
  const params = envelope.kdfParams || { ...SCRYPT_PARAMS, dkLen: KEY_BYTES };
  const key = scryptSync(passphrase, salt, params.dkLen || KEY_BYTES, params);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf-8");
  return JSON.parse(plaintext) as VaultData;
}

function loadVault(
  vaultPath: string,
  passphrase?: string,
): { vault: VaultData | null; encrypted: boolean; error?: string; locked?: boolean } {
  try {
    if (!existsSync(vaultPath)) {
      return { vault: null, encrypted: false, error: "Vault not found." };
    }
    const parsed = JSON.parse(readFileSync(vaultPath, "utf-8"));
    if (isEncryptedEnvelope(parsed)) {
      if (!passphrase) {
        return {
          vault: null,
          encrypted: true,
          locked: true,
          error: "Vault is locked. Set PERSONAFY_VAULT_PASSPHRASE to unlock.",
        };
      }
      try {
        return { vault: decryptVaultData(parsed, passphrase), encrypted: true };
      } catch {
        return {
          vault: null,
          encrypted: true,
          locked: true,
          error: "Invalid vault passphrase. Check PERSONAFY_VAULT_PASSPHRASE.",
        };
      }
    }
    return { vault: parsed as VaultData, encrypted: false };
  } catch {
    return { vault: null, encrypted: false, error: "Failed to load vault." };
  }
}

function saveVault(vaultPath: string, data: VaultData, passphrase?: string, encrypt?: boolean) {
  const tmpPath = vaultPath + ".tmp." + randomUUID().slice(0, 8);
  const payload = encrypt && passphrase ? encryptVaultData(data, passphrase) : data;
  writeFileSync(tmpPath, JSON.stringify(payload, null, 2), "utf-8");
  renameSync(tmpPath, vaultPath);
}

function generateId(prefix: string): string {
  return prefix + randomUUID().slice(0, 8);
}

function generateRequestId(): string {
  return generateId("req_");
}

export default function register(api: any) {
  const defaultVaultPath = resolve(
    process.env.HOME || "~",
    ".openclaw/workspace/Personafy/vault-data.json"
  );

  // Register the main context request tool
  api.registerTool(
    {
      name: "personafy_request_context",
      description: `Request personal context (preferences, sizes, dietary needs, etc.) from the user's Personafy privacy vault. 

USE THIS TOOL when you need the user's personal preferences to complete a task (shopping, travel booking, restaurant recommendations, gift ideas, etc.).

The tool returns either:
1. The requested data directly (if auto-approved by a saved rule)
2. An approval challenge with a request_id — you must then ASK THE USER for approval in the chat, showing them what would be shared. When they approve, call this tool again with approve=true and the request_id.

IMPORTANT: When you get an "ask" decision back, format a clear approval message showing:
- Who is requesting (recipient)
- Why (purpose)  
- What would be shared (the fields listed)
- Ask the user to APPROVE or DENY

When the user approves, call this tool again with: approve=true, request_id=<the id from the challenge>

Available persona categories: Shopping, Travel, Food & Dining, Fitness, Gift Giving`,
      parameters: {
        type: "object",
        properties: {
          purpose: {
            type: "object",
            properties: {
              category: { type: "string", description: "Task category: shopping, travel, food, fitness, gifts" },
              action: { type: "string", description: "Specific action: find_item, checkout, book, recommend, etc." },
              detail: { type: "string", description: "Additional detail about what you need" }
            },
            required: ["category", "action"]
          },
          recipient: {
            type: "object",
            properties: {
              type: { type: "string", description: "Recipient type: domain, tool, api" },
              value: { type: "string", description: "Recipient identifier (e.g., nordstrom.com)" }
            },
            required: ["type", "value"]
          },
          persona_hint: { 
            type: "string", 
            description: "Which persona to pull from: shopping, travel, food-dining, fitness, gift-giving" 
          },
          fields_requested: { 
            type: "array", 
            items: { type: "string" },
            description: "Specific fields needed (e.g., apparel.pants.*, budget.*, dietary.*). Use .* wildcards for categories." 
          },
          approve: { 
            type: "boolean", 
            description: "Set to true when the user has approved a pending request" 
          },
          request_id: { 
            type: "string", 
            description: "The request_id from a previous 'ask' challenge, used with approve=true" 
          }
        },
        required: ["purpose", "recipient"]
      },
      async execute(_id: string, params: any) {
        const config = api.config?.plugins?.entries?.personafy?.config || {};
        const vaultPath = config.vaultPath || defaultVaultPath;
        const passphrase = config.passphrase || process.env.PERSONAFY_VAULT_PASSPHRASE;
        
        const loaded = loadVault(vaultPath, passphrase);
        if (!loaded.vault) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                type: "context.response",
                decision: "error",
                error: loaded.error || "Vault not found. The user needs to set up their Personafy vault first."
              })
            }]
          };
        }
        const vault = loaded.vault;
        const encryptOnSave = loaded.encrypted;

        // Sync in-memory Map with vault file (one-way sync: file is source of truth)
        pendingRequests.clear();
        if (vault.approvalQueue) {
          const now = Date.now();
          vault.approvalQueue = vault.approvalQueue.filter(a => {
            if (a.status !== 'pending') return true; // Keep resolved ones for history (though they should ideally be in auditLog)
            if (a.expiresAtMs > now) {
              pendingRequests.set(a.id, a);
              return true;
            }
            return false;
          });
        } else {
          vault.approvalQueue = [];
        }

        const ttlSeconds = getContextTtlSeconds(vault);

        // Handle approval resolution
        if (params.approve && params.request_id) {
          const pending = pendingRequests.get(params.request_id);
          if (!pending || !pending.matchedFacts) {
            return {
              content: [{
                type: "text",
                text: JSON.stringify({
                  type: "context.response",
                  decision: "error",
                  error: "Request expired or not found. Please make a new request."
                })
              }]
            };
          }

          // Release the data
          pendingRequests.delete(params.request_id);
          vault.approvalQueue = vault.approvalQueue.map(a => 
            a.id === params.request_id ? { ...a, status: 'approved', resolvedAtMs: Date.now() } : a
          );
          
          // Log to audit
          const auditEvent: AuditEvent = {
            id: generateId("aud_"),
            timestamp: new Date().toISOString(),
            requestId: params.request_id,
            decision: "ask_approved",
            recipientDomain: pending.request.agentId,
            purpose: pending.request.purpose,
            fieldsReleased: pending.matchedFacts.map(f => f.key)
          };
          vault.auditLog.push(auditEvent);
          saveVault(vaultPath, vault, passphrase, encryptOnSave);

          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                type: "context.response",
                request_id: params.request_id,
                decision: "allow",
                package: {
                  ttl_seconds: ttlSeconds,
                  facts: pending.matchedFacts.map(f => ({
                    key: f.key,
                    value: f.value,
                    confidence: f.confidence
                  }))
                },
                audit_id: auditEvent.id,
                offer_rule: {
                  hint: "After using this data, ask the user: 'Want me to remember this? I can auto-allow " + pending.request.agentId + " to see these fields next time without asking.' If they agree, call personafy_create_rule.",
                  suggested_rule: {
                    recipient_domain: pending.request.agentId,
                    purpose_category: pending.request.persona,
                    purpose_action: pending.request.purpose,
                    allowed_fields: pending.matchedFacts.map(f => f.key),
                    max_sensitivity: pending.matchedFacts.reduce((max: string, f: Fact) => {
                      const levels: Record<string, number> = { low: 1, medium: 2, high: 3 };
                      return levels[f.sensitivity] > levels[max] ? f.sensitivity : max;
                    }, "low")
                  }
                }
              })
            }]
          };
        }

        // Handle denial
        if (params.approve === false && params.request_id) {
          const pending = pendingRequests.get(params.request_id);
          if (!pending) {
            return {
              content: [{
                type: "text",
                text: JSON.stringify({
                  type: "context.response",
                  decision: "error",
                  error: "Request expired or not found. Please make a new request."
                })
              }]
            };
          }

          pendingRequests.delete(params.request_id);
          vault.approvalQueue = vault.approvalQueue.map(a => 
            a.id === params.request_id ? { ...a, status: 'denied', resolvedAtMs: Date.now() } : a
          );

          const auditEvent: AuditEvent = {
            id: generateId("aud_"),
            timestamp: new Date().toISOString(),
            requestId: params.request_id,
            decision: "ask_denied",
            recipientDomain: pending.request.agentId,
            purpose: pending.request.purpose,
            fieldsReleased: [],
          };
          vault.auditLog.push(auditEvent);
          saveVault(vaultPath, vault, passphrase, encryptOnSave);

          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                type: "context.response",
                request_id: params.request_id,
                decision: "deny",
                message: "User denied the context request. Proceed without personal preferences."
              })
            }]
          };
        }

        // New context request
        const persona = findMatchingPersona(vault, params.persona_hint, params.purpose.category);

        if (!persona) {
          const hidden = findHiddenPersona(vault, params.persona_hint, params.purpose.category);
          if (hidden) {
            return {
              content: [{
                type: "text",
                text: JSON.stringify({
                  type: "context.response",
                  decision: "no_data",
                  message: `Persona "${hidden.name}" is hidden from agents. Enable it in Personafy → Personas → ${hidden.name} → Settings.`
                })
              }]
            };
          }

          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                type: "context.response",
                decision: "no_data",
                message: `No persona found for category "${params.purpose.category}". Available personas: ${vault.personas.map(p => p.name).join(", ")}`
              })
            }]
          };
        }

        const matchedFacts = matchFacts(persona, params.fields_requested);
        
        if (matchedFacts.length === 0) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                type: "context.response",
                decision: "no_data",
                message: `No matching facts found in "${persona.name}" persona for the requested fields.`
              })
            }]
          };
        }

        // Check auto-allow
        const autoAllow = checkAutoAllow(
          vault,
          params.recipient.value,
          params.purpose.category,
          params.purpose.action,
          matchedFacts,
          persona.personaSettings
        );

        if (autoAllow) {
          // Auto-allow: return data immediately
          const auditEvent: AuditEvent = {
            id: generateId("aud_"),
            timestamp: new Date().toISOString(),
            requestId: generateRequestId(),
            decision: "allow",
            recipientDomain: params.recipient.value,
            purpose: `${params.purpose.category}/${params.purpose.action}`,
            fieldsReleased: matchedFacts.map(f => f.key)
          };
          vault.auditLog.push(auditEvent);
          saveVault(vaultPath, vault, passphrase, encryptOnSave);

          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                type: "context.response",
                decision: "allow",
                package: {
                  ttl_seconds: ttlSeconds,
                  facts: matchedFacts.map(f => ({
                    key: f.key,
                    value: f.value,
                    confidence: f.confidence
                  }))
                },
                audit_id: auditEvent.id
              })
            }]
          };
        }

        // Need approval
        const requestId = generateRequestId();
        const pending: PendingApproval = {
          id: requestId,
          createdAtMs: Date.now(),
          expiresAtMs: Date.now() + 15 * 60 * 1000,
          status: 'pending',
          request: {
            agentId: params.recipient.value,
            purpose: `${params.purpose.category}/${params.purpose.action}`,
            persona: persona.name,
            fields: matchedFacts.map(f => f.key),
          },
          matchedFacts,
        };

        pendingRequests.set(requestId, pending);
        vault.approvalQueue = vault.approvalQueue || [];
        vault.approvalQueue.push(pending);

        saveVault(vaultPath, vault, passphrase, encryptOnSave);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              type: "context.response",
              request_id: requestId,
              decision: "ask",
              challenge: {
                summary: `Share ${matchedFacts.length} preference fields with ${params.recipient.value} for ${params.purpose.category}/${params.purpose.action}?`,
                persona: persona.name,
                recipient: params.recipient.value,
                purpose: `${params.purpose.category} → ${params.purpose.action}${params.purpose.detail ? ` (${params.purpose.detail})` : ""}`,
                fields: matchedFacts.map(f => ({
                  key: f.key,
                  sensitivity: f.sensitivity,
                  preview: f.sensitivity === "high" ? "[hidden]" : f.value
                })),
                expires_in_seconds: 900,
                approval_instructions: "Show the user what would be shared and ask them to APPROVE or DENY. If they approve, call this tool again with approve=true and request_id='" + requestId + "'"
              }
            })
          }]
        };
      },
    },
    { optional: true }
  );

  // Register rule creation tool
  api.registerTool(
    {
      name: "personafy_create_rule",
      description: `Create an auto-allow rule in the Personafy vault. Use this AFTER a user approves a context request and you want to offer "Remember this? Always allow [domain] to see [fields]?"

Only call this when the user explicitly agrees to save a rule. The rule will auto-allow future requests from the same domain/purpose without asking.`,
      parameters: {
        type: "object",
        properties: {
          recipient_domain: {
            type: "string",
            description: "Domain to auto-allow (e.g., marinelayer.com)"
          },
          purpose_category: {
            type: "string",
            description: "Category: shopping, travel, food, fitness, gifts"
          },
          purpose_action: {
            type: "string",
            description: "Action: find_item, checkout, book, recommend, sync_data"
          },
          max_sensitivity: {
            type: "string",
            enum: ["low", "medium", "high"],
            description: "Maximum sensitivity level to auto-allow"
          },
          allowed_fields: {
            type: "array",
            items: { type: "string" },
            description: "Field patterns to allow (e.g., apparel.pants.*, budget.*)"
          },
          duration_days: {
            type: "number",
            description: "How many days the rule should last (default: 180)"
          }
        },
        required: ["recipient_domain", "purpose_category", "purpose_action", "allowed_fields"]
      },
      async execute(_id: string, params: any) {
        const config = api.config?.plugins?.entries?.personafy?.config || {};
        const vaultPath = config.vaultPath || defaultVaultPath;
        const passphrase = config.passphrase || process.env.PERSONAFY_VAULT_PASSPHRASE;

        const loaded = loadVault(vaultPath, passphrase);
        if (!loaded.vault) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({ error: loaded.error || "Vault not found." })
            }]
          };
        }
        const vault = loaded.vault;
        const encryptOnSave = loaded.encrypted;

        // Check for duplicate rules
        const existing = vault.rules.find(
          (r: PolicyRule) =>
            r.recipientDomain === params.recipient_domain &&
            r.purposeCategory === params.purpose_category &&
            r.purposeAction === params.purpose_action &&
            r.enabled
        );
        if (existing) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                type: "rule.exists",
                rule_id: existing.id,
                message: `A rule already exists for ${params.recipient_domain} (${params.purpose_category}/${params.purpose_action}). Rule ID: ${existing.id}`
              })
            }]
          };
        }

        const durationDays = params.duration_days || 180;
        const expiresAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();

        const rule: PolicyRule = {
          id: generateId("rule_"),
          recipientDomain: params.recipient_domain,
          purposeCategory: params.purpose_category,
          purposeAction: params.purpose_action,
          maxSensitivity: params.max_sensitivity || "medium",
          allowedFields: params.allowed_fields,
          expiresAt,
          enabled: true,
        };

        vault.rules.push(rule);

        // Also log to audit
        const auditEvent: AuditEvent = {
          id: generateId("aud_"),
          timestamp: new Date().toISOString(),
          requestId: rule.id,
          decision: "allow",
          recipientDomain: params.recipient_domain,
          purpose: `rule_created/${params.purpose_category}/${params.purpose_action}`,
          fieldsReleased: params.allowed_fields,
        };
        vault.auditLog.push(auditEvent);
        saveVault(vaultPath, vault, passphrase, encryptOnSave);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              type: "rule.created",
              rule_id: rule.id,
              domain: params.recipient_domain,
              category: params.purpose_category,
              action: params.purpose_action,
              max_sensitivity: rule.maxSensitivity,
              fields: params.allowed_fields,
              expires_at: expiresAt,
              duration_days: durationDays,
              message: `Auto-allow rule created for ${params.recipient_domain}. Future ${params.purpose_category}/${params.purpose_action} requests matching these fields will be auto-approved for ${durationDays} days.`
            })
          }]
        };
      }
    },
    { optional: true }
  );

  // Register /personafy command
  if (typeof api.registerCommand === "function") {
    api.registerCommand({
      name: "personafy",
      description: "Personafy vault status, device pairing, personas, and audit log",
      acceptsArgs: true,
      requireAuth: true,
      handler: async (ctx: any) => {
        const config = api.config?.plugins?.entries?.personafy?.config || {};
        const vaultPath = config.vaultPath || defaultVaultPath;
        const passphrase = config.passphrase || process.env.PERSONAFY_VAULT_PASSPHRASE;
        const loaded = loadVault(vaultPath, passphrase);
        
        if (!loaded.vault) {
          return { text: `🔐 Personafy: ${loaded.error || "No vault found. Set up your vault first."}` };
        }
        const vault = loaded.vault;
        const encryptOnSave = loaded.encrypted;

        const raw = (ctx.args ?? "").trim();
        const parts = raw ? raw.split(/\s+/) : [];
        const subcommand = parts[0] || "status";
        const rest = parts.slice(1);

        switch (subcommand) {
          case "status": {
            const totalFacts = vault.personas.reduce((sum: number, p: Persona) => sum + p.facts.length, 0);
            const devices = vault.devices ?? [];
            const connected = devices.filter((d: VaultDevice) => d.status === "connected").length;
            return {
              text: `🔐 *Personafy Vault Status*\n\n` +
                `Privacy Posture: ${vault.privacyPosture}\n` +
                `Personas: ${vault.personas.length}\n` +
                `Total Facts: ${totalFacts}\n` +
                `Devices: ${connected}/${devices.length} connected\n` +
                `Active Rules: ${vault.rules.filter((r: PolicyRule) => r.enabled).length}\n` +
                `Audit Events: ${vault.auditLog.length}\n` +
                `Pending Requests: ${pendingRequests.size}`
            };
          }

          case "pair": {
            if (vault.privacyPosture === "safe_room") {
              return { text: "🔐 Pairing is disabled in Safe Room mode." };
            }

            const code = rest[0];
            const deviceName = rest.slice(1).join(" ").trim();
            if (!code) {
              return {
                text:
                  "Usage: /personafy pair PFY-ABCD-EFGH [device name]\n\n" +
                  "Start pairing from the web UI: Devices → Pair Device, then copy the pairing code." 
              };
            }

            // Ensure devices list exists
            if (!vault.devices) vault.devices = [];

            const device = vault.devices.find((d: VaultDevice) => d.pairingCode === code);
            if (!device) {
              return {
                text:
                  `No pending pairing request found for code ${code}.\n\n` +
                  "Start pairing from the web UI: Devices → Pair Device, then use the displayed code."
              };
            }

            if (device.status !== "pairing") {
              return { text: `Device ${device.name} is not in pairing mode (status: ${device.status}).` };
            }

            if (device.pairingExpiresAt) {
              const expMs = Date.parse(device.pairingExpiresAt);
              if (!Number.isFinite(expMs) || expMs < Date.now()) {
                return { text: `Pairing code ${code} has expired. Start again from Devices → Pair Device.` };
              }
            }

            const nowIso = new Date().toISOString();
            const updated: VaultDevice = {
              ...device,
              name: deviceName || device.name,
              status: "connected",
              lastSeen: nowIso,
              pairingCode: undefined,
              pairingExpiresAt: undefined,
              version: device.version ?? "openclaw",
            };

            vault.devices = vault.devices.map((d: VaultDevice) => (d.id === device.id ? updated : d));
            saveVault(vaultPath, vault, passphrase, encryptOnSave);

            return {
              text:
                `✅ Paired: *${updated.name}*\n` +
                `Device ID: ${updated.id}\n\n` +
                "You can verify from the web UI: Devices → Connected."
            };
          }

          case "personas": {
            const lines = vault.personas.map((p: Persona) => 
              `• *${p.name}* — ${p.facts.length} facts`
            ).join("\n");
            return { text: `🔐 *Personafy Personas*\n\n${lines}` };
          }

          case "audit": {
            const recent = vault.auditLog.slice(-5).reverse();
            if (recent.length === 0) {
              return { text: "🔐 *Personafy Audit Log*\n\nNo events yet." };
            }
            const lines = recent.map((e: AuditEvent) => {
              const emoji = e.decision.includes("allow") || e.decision === "allow" ? "✅" : "⛔";
              return `${emoji} ${e.recipientDomain} — ${e.purpose} (${e.fieldsReleased.length} fields) — ${new Date(e.timestamp).toLocaleString()}`;
            }).join("\n");
            return { text: `🔐 *Personafy Audit Log* (last 5)\n\n${lines}` };
          }

          default:
            return { text: "Usage: /personafy [status|pair|personas|audit]" };
        }
      }
    });
  }
}
