import crypto from "node:crypto";
import type {
  PersonafyApprovalQueueEntry,
  PersonafyApprovalStatus,
  PersonafyContextRequest,
  PersonafyVault,
} from "./types.js";

export function enqueueApproval(
  vault: PersonafyVault,
  request: PersonafyContextRequest,
  expiresInMs: number,
): string {
  const id = `apv_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const now = Date.now();
  const entry: PersonafyApprovalQueueEntry = {
    id,
    request,
    status: "pending",
    createdAtMs: now,
    expiresAtMs: now + expiresInMs,
  };
  vault.approvalQueue.push(entry);
  return id;
}

export function resolveApproval(
  vault: PersonafyVault,
  id: string,
  decision: "approved" | "denied",
  resolvedBy?: string,
  createStandingRule?: boolean,
): boolean {
  const entry = vault.approvalQueue.find((e) => e.id === id);
  if (!entry || entry.status !== "pending") return false;
  entry.status = decision;
  entry.resolvedAtMs = Date.now();
  entry.resolvedBy = resolvedBy;
  entry.createStandingRule = createStandingRule;
  return true;
}

export function getPendingApprovals(vault: PersonafyVault): PersonafyApprovalQueueEntry[] {
  return vault.approvalQueue.filter((e) => e.status === "pending");
}

export function getApprovalById(
  vault: PersonafyVault,
  id: string,
): PersonafyApprovalQueueEntry | undefined {
  return vault.approvalQueue.find((e) => e.id === id);
}

export function expireStaleApprovals(vault: PersonafyVault, nowMs: number = Date.now()): number {
  let count = 0;
  for (const entry of vault.approvalQueue) {
    if (entry.status === "pending" && nowMs >= entry.expiresAtMs) {
      entry.status = "expired";
      entry.resolvedAtMs = nowMs;
      count++;
    }
  }
  return count;
}

export function pruneResolvedApprovals(vault: PersonafyVault, keepCount: number = 100): number {
  const resolved = vault.approvalQueue.filter(
    (e) => e.status !== "pending",
  );
  if (resolved.length <= keepCount) return 0;
  const toRemove = resolved.length - keepCount;
  // Remove oldest resolved entries
  const idsToRemove = new Set(
    resolved
      .sort((a, b) => a.createdAtMs - b.createdAtMs)
      .slice(0, toRemove)
      .map((e) => e.id),
  );
  const before = vault.approvalQueue.length;
  vault.approvalQueue = vault.approvalQueue.filter((e) => !idsToRemove.has(e.id));
  return before - vault.approvalQueue.length;
}
