import type { PersonafyPosture, PersonafyVault } from "./types.js";

const VALID_POSTURES: ReadonlySet<string> = new Set(["open", "guarded", "locked"]);

export function isValidPosture(value: unknown): value is PersonafyPosture {
  return typeof value === "string" && VALID_POSTURES.has(value);
}

export function getPosture(vault: PersonafyVault): PersonafyPosture {
  return vault.posture;
}

export function setPosture(vault: PersonafyVault, posture: PersonafyPosture): void {
  vault.posture = posture;
}

/** Returns true when the vault posture blocks all context requests outright. */
export function isVaultLocked(vault: PersonafyVault): boolean {
  return vault.posture === "locked";
}

/** Returns true when the vault auto-approves matching rules without prompting. */
export function isAutoApproveEnabled(vault: PersonafyVault): boolean {
  return vault.posture === "open";
}
