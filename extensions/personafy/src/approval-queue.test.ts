import { describe, expect, it, beforeEach } from "vitest";
import {
  enqueueApproval,
  resolveApproval,
  getPendingApprovals,
  getApprovalById,
  expireStaleApprovals,
  pruneResolvedApprovals,
} from "./approval-queue.js";
import { createEmptyVault } from "./vault.js";
import type { PersonafyContextRequest, PersonafyVault } from "./types.js";

describe("approval-queue", () => {
  let vault: PersonafyVault;

  beforeEach(() => {
    vault = createEmptyVault("guarded");
  });

  function makeRequest(overrides?: Partial<PersonafyContextRequest>): PersonafyContextRequest {
    return {
      agentId: "agent-1",
      requestType: "message",
      persona: "work",
      fields: ["tools"],
      purpose: "coding",
      ...overrides,
    };
  }

  describe("enqueueApproval", () => {
    it("creates an approval entry", () => {
      const id = enqueueApproval(vault, makeRequest(), 60_000);
      expect(id).toMatch(/^apv_/);
      expect(vault.approvalQueue).toHaveLength(1);
      expect(vault.approvalQueue[0].status).toBe("pending");
    });

    it("sets correct expiry", () => {
      const before = Date.now();
      enqueueApproval(vault, makeRequest(), 60_000);
      const entry = vault.approvalQueue[0];
      expect(entry.expiresAtMs).toBeGreaterThanOrEqual(before + 60_000);
      expect(entry.expiresAtMs).toBeLessThanOrEqual(before + 61_000);
    });
  });

  describe("resolveApproval", () => {
    it("approves a pending entry", () => {
      const id = enqueueApproval(vault, makeRequest(), 60_000);
      const ok = resolveApproval(vault, id, "approved", "user");
      expect(ok).toBe(true);
      const entry = getApprovalById(vault, id)!;
      expect(entry.status).toBe("approved");
      expect(entry.resolvedBy).toBe("user");
      expect(entry.resolvedAtMs).toBeTruthy();
    });

    it("denies a pending entry", () => {
      const id = enqueueApproval(vault, makeRequest(), 60_000);
      resolveApproval(vault, id, "denied");
      expect(getApprovalById(vault, id)!.status).toBe("denied");
    });

    it("returns false for non-existent entry", () => {
      expect(resolveApproval(vault, "nonexistent", "approved")).toBe(false);
    });

    it("returns false for already-resolved entry", () => {
      const id = enqueueApproval(vault, makeRequest(), 60_000);
      resolveApproval(vault, id, "approved");
      expect(resolveApproval(vault, id, "denied")).toBe(false);
    });
  });

  describe("getPendingApprovals", () => {
    it("returns only pending entries", () => {
      enqueueApproval(vault, makeRequest(), 60_000);
      const id2 = enqueueApproval(vault, makeRequest({ agentId: "agent-2" }), 60_000);
      resolveApproval(vault, id2, "approved");

      const pending = getPendingApprovals(vault);
      expect(pending).toHaveLength(1);
      expect(pending[0].request.agentId).toBe("agent-1");
    });
  });

  describe("expireStaleApprovals", () => {
    it("expires old pending entries", () => {
      enqueueApproval(vault, makeRequest(), 1); // 1ms expiry
      // Wait a tick
      const count = expireStaleApprovals(vault, Date.now() + 10);
      expect(count).toBe(1);
      expect(vault.approvalQueue[0].status).toBe("expired");
    });

    it("does not expire non-pending entries", () => {
      const id = enqueueApproval(vault, makeRequest(), 1);
      resolveApproval(vault, id, "approved");
      const count = expireStaleApprovals(vault, Date.now() + 10);
      expect(count).toBe(0);
    });
  });

  describe("pruneResolvedApprovals", () => {
    it("prunes oldest resolved entries over limit", () => {
      for (let i = 0; i < 5; i++) {
        const id = enqueueApproval(vault, makeRequest({ agentId: `agent-${i}` }), 60_000);
        resolveApproval(vault, id, "approved");
      }
      expect(vault.approvalQueue).toHaveLength(5);
      const pruned = pruneResolvedApprovals(vault, 2);
      expect(pruned).toBe(3);
      expect(vault.approvalQueue).toHaveLength(2);
    });
  });
});
