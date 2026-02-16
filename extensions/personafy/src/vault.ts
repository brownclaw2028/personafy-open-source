import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type {
  PersonafyAuditEntry,
  PersonafyFact,
  PersonafyPersona,
  PersonafyPosture,
  PersonafyVault,
} from "./types.js";

const VAULT_FILENAME = "vault-data.json";
const ENCRYPTION_ALGORITHM = "aes-256-gcm";
const KEY_DERIVATION_ITERATIONS = 600_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

// ---------------------------------------------------------------------------
// In-memory vault singleton (per stateDir)
// ---------------------------------------------------------------------------

let activeVault: PersonafyVault | null = null;
let activeVaultPath: string | null = null;

export function getActiveVault(): PersonafyVault | null {
  return activeVault;
}

export function setActiveVault(vault: PersonafyVault): void {
  activeVault = vault;
}

// ---------------------------------------------------------------------------
// Empty vault
// ---------------------------------------------------------------------------

export function createEmptyVault(posture: PersonafyPosture = "guarded"): PersonafyVault {
  return {
    version: 1,
    posture,
    personas: {},
    facts: [],
    rules: [],
    scheduledRules: [],
    approvalQueue: [],
    auditLog: [],
  };
}

// ---------------------------------------------------------------------------
// Load / Save
// ---------------------------------------------------------------------------

function vaultFilePath(stateDir: string): string {
  return path.join(stateDir, VAULT_FILENAME);
}

function deriveKey(passphrase: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(passphrase, salt, KEY_DERIVATION_ITERATIONS, 32, "sha256", (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

async function encrypt(plaintext: string, passphrase: string): Promise<string> {
  const salt = crypto.randomBytes(SALT_BYTES);
  const key = await deriveKey(passphrase, salt);
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: base64(salt + iv + tag + ciphertext)
  return Buffer.concat([salt, iv, tag, encrypted]).toString("base64");
}

async function decrypt(encoded: string, passphrase: string): Promise<string> {
  const data = Buffer.from(encoded, "base64");
  const salt = data.subarray(0, SALT_BYTES);
  const iv = data.subarray(SALT_BYTES, SALT_BYTES + IV_BYTES);
  const tag = data.subarray(SALT_BYTES + IV_BYTES, SALT_BYTES + IV_BYTES + 16);
  const ciphertext = data.subarray(SALT_BYTES + IV_BYTES + 16);
  const key = await deriveKey(passphrase, salt);
  const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

export async function loadVault(
  stateDir: string,
  passphrase?: string,
  defaultPosture?: PersonafyPosture,
): Promise<PersonafyVault> {
  const filePath = vaultFilePath(stateDir);
  activeVaultPath = filePath;
  try {
    const raw = await fs.readFile(filePath, "utf8");
    let json: string;
    if (passphrase) {
      json = await decrypt(raw, passphrase);
    } else {
      json = raw;
    }
    const parsed = JSON.parse(json) as PersonafyVault;
    activeVault = parsed;
    return parsed;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      const vault = createEmptyVault(defaultPosture);
      activeVault = vault;
      return vault;
    }
    throw err;
  }
}

export async function saveVault(
  stateDir: string,
  vault: PersonafyVault,
  passphrase?: string,
): Promise<void> {
  const filePath = vaultFilePath(stateDir);
  const json = JSON.stringify(vault, null, 2);
  const data = passphrase ? await encrypt(json, passphrase) : json;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, data, "utf8");
  activeVault = vault;
  activeVaultPath = filePath;
}

// ---------------------------------------------------------------------------
// Persona CRUD
// ---------------------------------------------------------------------------

export function getPersona(vault: PersonafyVault, personaId: string): PersonafyPersona | undefined {
  return vault.personas[personaId];
}

export function setPersona(
  vault: PersonafyVault,
  personaId: string,
  label: string,
  fields: Record<string, string>,
): PersonafyPersona {
  const now = Date.now();
  const existing = vault.personas[personaId];
  const persona: PersonafyPersona = {
    id: personaId,
    label,
    fields: { ...(existing?.fields ?? {}), ...fields },
    createdAtMs: existing?.createdAtMs ?? now,
    updatedAtMs: now,
  };
  vault.personas[personaId] = persona;
  return persona;
}

export function deletePersona(vault: PersonafyVault, personaId: string): boolean {
  if (!vault.personas[personaId]) return false;
  delete vault.personas[personaId];
  return true;
}

// ---------------------------------------------------------------------------
// Fact CRUD
// ---------------------------------------------------------------------------

export function addFact(
  vault: PersonafyVault,
  persona: string,
  field: string,
  value: string,
): PersonafyFact {
  const now = Date.now();
  const fact: PersonafyFact = {
    id: crypto.randomUUID(),
    persona,
    field,
    value,
    createdAtMs: now,
    updatedAtMs: now,
  };
  vault.facts.push(fact);
  return fact;
}

export function getFact(vault: PersonafyVault, factId: string): PersonafyFact | undefined {
  return vault.facts.find((f) => f.id === factId);
}

export function getFactsByPersona(vault: PersonafyVault, persona: string): PersonafyFact[] {
  return vault.facts.filter((f) => f.persona === persona);
}

export function deleteFact(vault: PersonafyVault, factId: string): boolean {
  const idx = vault.facts.findIndex((f) => f.id === factId);
  if (idx < 0) return false;
  vault.facts.splice(idx, 1);
  return true;
}

// ---------------------------------------------------------------------------
// Field access (from persona fields + facts)
// ---------------------------------------------------------------------------

export function getFieldValue(
  vault: PersonafyVault,
  persona: string,
  field: string,
): string | undefined {
  // Check persona fields first
  const p = vault.personas[persona];
  if (p?.fields[field]) return p.fields[field];
  // Fall back to facts
  const fact = vault.facts.find((f) => f.persona === persona && f.field === field);
  return fact?.value;
}

export function getFieldValues(
  vault: PersonafyVault,
  persona: string,
  fields: string[],
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const field of fields) {
    const value = getFieldValue(vault, persona, field);
    if (value !== undefined) {
      result[field] = value;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Posture
// ---------------------------------------------------------------------------

export function getPosture(vault: PersonafyVault): PersonafyPosture {
  return vault.posture;
}

export function setPosture(vault: PersonafyVault, posture: PersonafyPosture): void {
  vault.posture = posture;
}

// ---------------------------------------------------------------------------
// Audit helpers
// ---------------------------------------------------------------------------

export function appendAudit(vault: PersonafyVault, entry: PersonafyAuditEntry): void {
  vault.auditLog.push(entry);
}

export function pruneAuditLog(vault: PersonafyVault, retentionMs: number): number {
  const cutoff = Date.now() - retentionMs;
  const before = vault.auditLog.length;
  vault.auditLog = vault.auditLog.filter((e) => e.timestamp >= cutoff);
  return before - vault.auditLog.length;
}
