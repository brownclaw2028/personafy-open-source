import { describe, expect, it, beforeEach } from "vitest";
import {
  createEmptyVault,
  addFact,
  getFact,
  getFactsByPersona,
  deleteFact,
  setPersona,
  getPersona,
  deletePersona,
  getFieldValue,
  getFieldValues,
  getPosture,
  setPosture,
  pruneAuditLog,
} from "./vault.js";
import type { PersonafyVault } from "./types.js";

describe("vault", () => {
  let vault: PersonafyVault;

  beforeEach(() => {
    vault = createEmptyVault("guarded");
  });

  describe("createEmptyVault", () => {
    it("creates vault with correct defaults", () => {
      expect(vault.version).toBe(1);
      expect(vault.posture).toBe("guarded");
      expect(vault.personas).toEqual({});
      expect(vault.facts).toEqual([]);
      expect(vault.rules).toEqual([]);
      expect(vault.scheduledRules).toEqual([]);
      expect(vault.approvalQueue).toEqual([]);
      expect(vault.auditLog).toEqual([]);
    });

    it("accepts custom posture", () => {
      const v = createEmptyVault("open");
      expect(v.posture).toBe("open");
    });
  });

  describe("persona CRUD", () => {
    it("sets and gets persona", () => {
      setPersona(vault, "work", "Work", { tools: "vscode", style: "concise" });
      const p = getPersona(vault, "work");
      expect(p).toBeDefined();
      expect(p!.id).toBe("work");
      expect(p!.label).toBe("Work");
      expect(p!.fields.tools).toBe("vscode");
      expect(p!.fields.style).toBe("concise");
    });

    it("merges fields on update", () => {
      setPersona(vault, "work", "Work", { tools: "vscode" });
      setPersona(vault, "work", "Work Profile", { style: "concise" });
      const p = getPersona(vault, "work")!;
      expect(p.label).toBe("Work Profile");
      expect(p.fields.tools).toBe("vscode");
      expect(p.fields.style).toBe("concise");
    });

    it("deletes persona", () => {
      setPersona(vault, "work", "Work", { tools: "vscode" });
      expect(deletePersona(vault, "work")).toBe(true);
      expect(getPersona(vault, "work")).toBeUndefined();
    });

    it("returns false when deleting non-existent persona", () => {
      expect(deletePersona(vault, "nonexistent")).toBe(false);
    });
  });

  describe("fact CRUD", () => {
    it("adds and retrieves fact", () => {
      const fact = addFact(vault, "work", "editor", "vim");
      expect(fact.id).toBeTruthy();
      expect(fact.persona).toBe("work");
      expect(fact.field).toBe("editor");
      expect(fact.value).toBe("vim");
      expect(getFact(vault, fact.id)).toEqual(fact);
    });

    it("lists facts by persona", () => {
      addFact(vault, "work", "editor", "vim");
      addFact(vault, "work", "os", "linux");
      addFact(vault, "personal", "hobby", "chess");
      expect(getFactsByPersona(vault, "work")).toHaveLength(2);
      expect(getFactsByPersona(vault, "personal")).toHaveLength(1);
    });

    it("deletes fact", () => {
      const fact = addFact(vault, "work", "editor", "vim");
      expect(deleteFact(vault, fact.id)).toBe(true);
      expect(getFact(vault, fact.id)).toBeUndefined();
    });

    it("returns false when deleting non-existent fact", () => {
      expect(deleteFact(vault, "nonexistent")).toBe(false);
    });
  });

  describe("field access", () => {
    it("gets field from persona", () => {
      setPersona(vault, "work", "Work", { tools: "vscode", style: "concise" });
      expect(getFieldValue(vault, "work", "tools")).toBe("vscode");
    });

    it("falls back to facts", () => {
      addFact(vault, "work", "editor", "vim");
      expect(getFieldValue(vault, "work", "editor")).toBe("vim");
    });

    it("prefers persona fields over facts", () => {
      setPersona(vault, "work", "Work", { editor: "vscode" });
      addFact(vault, "work", "editor", "vim");
      expect(getFieldValue(vault, "work", "editor")).toBe("vscode");
    });

    it("returns undefined for missing fields", () => {
      expect(getFieldValue(vault, "work", "missing")).toBeUndefined();
    });

    it("gets multiple field values", () => {
      setPersona(vault, "work", "Work", { tools: "vscode", style: "concise" });
      const values = getFieldValues(vault, "work", ["tools", "style", "missing"]);
      expect(values).toEqual({ tools: "vscode", style: "concise" });
      expect(values.missing).toBeUndefined();
    });
  });

  describe("posture", () => {
    it("gets and sets posture", () => {
      expect(getPosture(vault)).toBe("guarded");
      setPosture(vault, "locked");
      expect(getPosture(vault)).toBe("locked");
    });
  });

  describe("audit pruning", () => {
    it("prunes old audit entries", () => {
      const old = Date.now() - 100 * 24 * 60 * 60 * 1000; // 100 days ago
      vault.auditLog.push({
        id: "old",
        agentId: "a",
        requestType: "message",
        persona: "work",
        fields: [],
        purpose: "test",
        decision: "approved",
        timestamp: old,
      });
      vault.auditLog.push({
        id: "new",
        agentId: "a",
        requestType: "message",
        persona: "work",
        fields: [],
        purpose: "test",
        decision: "approved",
        timestamp: Date.now(),
      });

      const pruned = pruneAuditLog(vault, 90 * 24 * 60 * 60 * 1000);
      expect(pruned).toBe(1);
      expect(vault.auditLog).toHaveLength(1);
      expect(vault.auditLog[0].id).toBe("new");
    });
  });
});
