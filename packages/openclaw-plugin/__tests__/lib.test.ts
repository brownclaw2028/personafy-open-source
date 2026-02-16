import { describe, it, expect } from "vitest";
import {
  fieldMatchesPattern,
  matchFacts,
  checkAutoAllow,
  isPersonaVisible,
  findMatchingPersona,
  findHiddenPersona,
  getContextTtlSeconds,
  type Fact,
  type Persona,
  type VaultData,
  type PolicyRule,
} from "../lib";

// ---- Helpers ----

function makeFact(key: string, sensitivity: "low" | "medium" | "high" = "low"): Fact {
  return { key, value: "test", sensitivity, confidence: 0.9 };
}

function makePersona(overrides: Partial<Persona> = {}): Persona {
  return {
    id: "shopping",
    name: "Shopping",
    category: "shopping",
    facts: [
      makeFact("apparel.pants.waist", "low"),
      makeFact("apparel.pants.inseam", "low"),
      makeFact("apparel.shirt.size", "medium"),
      makeFact("budget.monthly", "high"),
    ],
    ...overrides,
  };
}

function makeVault(overrides: Partial<VaultData> = {}): VaultData {
  return {
    version: "1.0",
    privacyPosture: "alarm_system",
    personas: [makePersona()],
    rules: [],
    auditLog: [],
    ...overrides,
  };
}

function makeRule(overrides: Partial<PolicyRule> = {}): PolicyRule {
  return {
    id: "rule_test",
    recipientDomain: "nordstrom.com",
    purposeCategory: "shopping",
    purposeAction: "find_item",
    maxSensitivity: "medium",
    allowedFields: ["apparel.*"],
    expiresAt: new Date(Date.now() + 86400000).toISOString(), // +1 day
    enabled: true,
    ...overrides,
  };
}

// ---- fieldMatchesPattern ----

describe("fieldMatchesPattern", () => {
  it("matches exact field name", () => {
    expect(fieldMatchesPattern("apparel.pants.waist", "apparel.pants.waist")).toBe(true);
  });

  it("rejects different field name", () => {
    expect(fieldMatchesPattern("apparel.pants.waist", "apparel.shirt.size")).toBe(false);
  });

  it("rejects substring match (no longer allowed)", () => {
    // "id" should NOT match "shipping.address" — this was the data leak bug
    expect(fieldMatchesPattern("shipping.address", "id")).toBe(false);
    expect(fieldMatchesPattern("shipping.address_id", "id")).toBe(false);
    expect(fieldMatchesPattern("budget.monthly", "budget")).toBe(false);
  });

  it("wildcard matches children", () => {
    expect(fieldMatchesPattern("apparel.pants.waist", "apparel.*")).toBe(true);
    expect(fieldMatchesPattern("apparel.pants.inseam", "apparel.*")).toBe(true);
    expect(fieldMatchesPattern("apparel.shirt.size", "apparel.*")).toBe(true);
  });

  it("wildcard matches nested children", () => {
    expect(fieldMatchesPattern("apparel.pants.waist", "apparel.pants.*")).toBe(true);
  });

  it("wildcard matches the prefix itself", () => {
    expect(fieldMatchesPattern("apparel", "apparel.*")).toBe(true);
  });

  it("wildcard does NOT match unrelated prefixes", () => {
    expect(fieldMatchesPattern("budget.monthly", "apparel.*")).toBe(false);
  });

  it("wildcard anchored at boundary — no partial prefix match", () => {
    // "app" should not match "apparel.pants.waist"
    expect(fieldMatchesPattern("apparel.pants.waist", "app.*")).toBe(false);
    // "apparel_extra" should not match "apparel.*"
    expect(fieldMatchesPattern("apparel_extra.size", "apparel.*")).toBe(false);
  });
});

// ---- matchFacts ----

describe("matchFacts", () => {
  const persona = makePersona();

  it("returns empty when no fields requested (conservative least-privilege)", () => {
    expect(matchFacts(persona)).toHaveLength(0);
    expect(matchFacts(persona, [])).toHaveLength(0);
  });

  it("matches exact field", () => {
    const result = matchFacts(persona, ["apparel.pants.waist"]);
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe("apparel.pants.waist");
  });

  it("matches wildcard field", () => {
    const result = matchFacts(persona, ["apparel.*"]);
    expect(result).toHaveLength(3); // pants.waist, pants.inseam, shirt.size
  });

  it("does not match unrelated fields", () => {
    const result = matchFacts(persona, ["dietary.*"]);
    expect(result).toHaveLength(0);
  });

  it("combines exact and wildcard", () => {
    const result = matchFacts(persona, ["budget.monthly", "apparel.pants.*"]);
    expect(result).toHaveLength(3); // budget.monthly + pants.waist + pants.inseam
  });

  it("does NOT do substring matching", () => {
    const result = matchFacts(persona, ["waist"]);
    expect(result).toHaveLength(0); // "waist" is not an exact match for "apparel.pants.waist"
  });
});

// ---- isPersonaVisible ----

describe("isPersonaVisible", () => {
  it("returns true when no settings", () => {
    expect(isPersonaVisible(makePersona())).toBe(true);
  });

  it("returns true when visible: true", () => {
    expect(
      isPersonaVisible(
        makePersona({ personaSettings: { visible: true, autoRelease: "follow_posture", retention: "never" } }),
      ),
    ).toBe(true);
  });

  it("returns false when visible: false", () => {
    expect(
      isPersonaVisible(
        makePersona({ personaSettings: { visible: false, autoRelease: "follow_posture", retention: "never" } }),
      ),
    ).toBe(false);
  });
});

// ---- findMatchingPersona / findHiddenPersona ----

describe("findMatchingPersona", () => {
  it("finds by persona hint (id)", () => {
    const vault = makeVault();
    expect(findMatchingPersona(vault, "shopping")).toBeDefined();
  });

  it("finds by persona hint (name, case-insensitive)", () => {
    const vault = makeVault();
    expect(findMatchingPersona(vault, "SHOPPING")).toBeDefined();
  });

  it("finds by purpose category", () => {
    const vault = makeVault();
    expect(findMatchingPersona(vault, undefined, "shopping")).toBeDefined();
  });

  it("returns undefined for unknown category", () => {
    const vault = makeVault();
    expect(findMatchingPersona(vault, undefined, "gaming")).toBeUndefined();
  });

  it("treats empty-string hint as undefined (no false matches)", () => {
    const vault = makeVault();
    expect(findMatchingPersona(vault, "")).toBeUndefined();
    expect(findMatchingPersona(vault, "  ")).toBeUndefined();
  });

  it("matches food-dining category alias", () => {
    const vault = makeVault({
      personas: [makePersona({ id: "food-dining", name: "Food & Dining", category: "food-dining" })],
    });
    expect(findMatchingPersona(vault, undefined, "food-dining")).toBeDefined();
    expect(findMatchingPersona(vault, undefined, "food")).toBeDefined();
    expect(findMatchingPersona(vault, undefined, "dining")).toBeDefined();
  });

  it("skips hidden personas", () => {
    const vault = makeVault({
      personas: [
        makePersona({ personaSettings: { visible: false, autoRelease: "follow_posture", retention: "never" } }),
      ],
    });
    expect(findMatchingPersona(vault, "shopping")).toBeUndefined();
  });
});

describe("findHiddenPersona", () => {
  it("finds hidden persona by hint", () => {
    const vault = makeVault({
      personas: [
        makePersona({ personaSettings: { visible: false, autoRelease: "follow_posture", retention: "never" } }),
      ],
    });
    expect(findHiddenPersona(vault, "shopping")).toBeDefined();
  });

  it("does not find visible persona", () => {
    const vault = makeVault();
    expect(findHiddenPersona(vault, "shopping")).toBeUndefined();
  });
});

// ---- checkAutoAllow ----

describe("checkAutoAllow", () => {
  const lowFacts = [makeFact("apparel.pants.waist", "low")];
  const medFacts = [makeFact("apparel.shirt.size", "medium")];
  const highFacts = [makeFact("budget.monthly", "high")];

  describe("posture enforcement", () => {
    it("safe_room always denies", () => {
      const vault = makeVault({
        privacyPosture: "safe_room",
        rules: [makeRule()],
      });
      expect(checkAutoAllow(vault, "nordstrom.com", "shopping", "find_item", lowFacts)).toBe(false);
    });

    it("simple_lock auto-allows low sensitivity", () => {
      const vault = makeVault({ privacyPosture: "simple_lock" });
      expect(checkAutoAllow(vault, "any.com", "shopping", "find_item", lowFacts)).toBe(true);
    });

    it("simple_lock does NOT auto-allow medium sensitivity", () => {
      const vault = makeVault({ privacyPosture: "simple_lock" });
      expect(checkAutoAllow(vault, "any.com", "shopping", "find_item", medFacts)).toBe(false);
    });

    it("alarm_system does NOT auto-allow low without a rule", () => {
      const vault = makeVault({ privacyPosture: "alarm_system" });
      expect(checkAutoAllow(vault, "nordstrom.com", "shopping", "find_item", lowFacts)).toBe(false);
    });

    it("alarm_system allows low via matching rule", () => {
      const vault = makeVault({
        privacyPosture: "alarm_system",
        rules: [makeRule({ maxSensitivity: "medium", allowedFields: ["apparel.*"] })],
      });
      expect(checkAutoAllow(vault, "nordstrom.com", "shopping", "find_item", lowFacts)).toBe(true);
    });

    it("alarm_system REJECTS medium even with matching rule", () => {
      const vault = makeVault({
        privacyPosture: "alarm_system",
        rules: [makeRule({ maxSensitivity: "medium", allowedFields: ["apparel.*"] })],
      });
      expect(checkAutoAllow(vault, "nordstrom.com", "shopping", "find_item", medFacts)).toBe(false);
    });

    it("alarm_system REJECTS high even with matching rule", () => {
      const vault = makeVault({
        privacyPosture: "alarm_system",
        rules: [makeRule({ maxSensitivity: "high", allowedFields: ["budget.*"] })],
      });
      expect(checkAutoAllow(vault, "nordstrom.com", "shopping", "find_item", highFacts)).toBe(false);
    });
  });

  describe("persona settings override", () => {
    it("always_ask overrides rules", () => {
      const vault = makeVault({ rules: [makeRule()] });
      const settings = { visible: true, autoRelease: "always_ask" as const, retention: "never" as const };
      expect(checkAutoAllow(vault, "nordstrom.com", "shopping", "find_item", lowFacts, settings)).toBe(false);
    });

    it("auto_low allows low sensitivity", () => {
      const vault = makeVault();
      const settings = { visible: true, autoRelease: "auto_low" as const, retention: "never" as const };
      expect(checkAutoAllow(vault, "any.com", "shopping", "find_item", lowFacts, settings)).toBe(true);
    });

    it("auto_low does NOT allow medium sensitivity", () => {
      const vault = makeVault();
      const settings = { visible: true, autoRelease: "auto_low" as const, retention: "never" as const };
      expect(checkAutoAllow(vault, "any.com", "shopping", "find_item", medFacts, settings)).toBe(false);
    });
  });

  describe("rule matching", () => {
    it("matches rule by domain + category + action", () => {
      const vault = makeVault({
        rules: [makeRule({ allowedFields: ["apparel.*"] })],
      });
      expect(checkAutoAllow(vault, "nordstrom.com", "shopping", "find_item", lowFacts)).toBe(true);
    });

    it("REJECTS when purposeAction differs (privacy fix)", () => {
      const vault = makeVault({
        rules: [makeRule({ purposeAction: "recommend" })],
      });
      // Rule is for "recommend" but request is "find_item" — must NOT auto-allow
      expect(checkAutoAllow(vault, "nordstrom.com", "shopping", "find_item", lowFacts)).toBe(false);
    });

    it("REJECTS when domain differs", () => {
      const vault = makeVault({ rules: [makeRule()] });
      expect(checkAutoAllow(vault, "evil.com", "shopping", "find_item", lowFacts)).toBe(false);
    });

    it("REJECTS when category differs", () => {
      const vault = makeVault({ rules: [makeRule()] });
      expect(checkAutoAllow(vault, "nordstrom.com", "travel", "find_item", lowFacts)).toBe(false);
    });

    it("REJECTS when sensitivity exceeds rule max", () => {
      const vault = makeVault({
        rules: [makeRule({ maxSensitivity: "low" })],
      });
      expect(checkAutoAllow(vault, "nordstrom.com", "shopping", "find_item", medFacts)).toBe(false);
    });

    it("REJECTS when fields not covered by allowedFields", () => {
      const vault = makeVault({
        rules: [makeRule({ allowedFields: ["apparel.pants.*"] })],
      });
      // budget.monthly is not covered by apparel.pants.*
      expect(checkAutoAllow(vault, "nordstrom.com", "shopping", "find_item", highFacts)).toBe(false);
    });

    it("allows when all fields covered by allowedFields wildcard (simple_lock)", () => {
      const vault = makeVault({
        privacyPosture: "simple_lock",
        rules: [makeRule({ allowedFields: ["apparel.*"], maxSensitivity: "medium" })],
      });
      expect(checkAutoAllow(vault, "nordstrom.com", "shopping", "find_item", medFacts)).toBe(true);
    });

    it("skips disabled rules", () => {
      const vault = makeVault({
        rules: [makeRule({ enabled: false })],
      });
      expect(checkAutoAllow(vault, "nordstrom.com", "shopping", "find_item", lowFacts)).toBe(false);
    });

    it("skips expired rules", () => {
      const vault = makeVault({
        rules: [makeRule({ expiresAt: new Date(Date.now() - 86400000).toISOString() })],
      });
      expect(checkAutoAllow(vault, "nordstrom.com", "shopping", "find_item", lowFacts)).toBe(false);
    });

    it("skips rules with invalid expiresAt (strict parsing)", () => {
      const vault = makeVault({
        privacyPosture: "simple_lock",
        rules: [makeRule({ expiresAt: "not-a-date" })],
      });
      // Rule has invalid date → treated as expired → only posture applies
      expect(checkAutoAllow(vault, "nordstrom.com", "shopping", "find_item", medFacts)).toBe(false);
    });

    it("skips rules with empty expiresAt", () => {
      const vault = makeVault({
        privacyPosture: "simple_lock",
        rules: [makeRule({ expiresAt: "" })],
      });
      expect(checkAutoAllow(vault, "nordstrom.com", "shopping", "find_item", medFacts)).toBe(false);
    });

    it("allows with empty allowedFields (no field restriction, simple_lock)", () => {
      const vault = makeVault({
        privacyPosture: "simple_lock",
        rules: [makeRule({ allowedFields: [], maxSensitivity: "high" })],
      });
      expect(checkAutoAllow(vault, "nordstrom.com", "shopping", "find_item", highFacts)).toBe(true);
    });
  });
});

// ---- getContextTtlSeconds ----

describe("getContextTtlSeconds", () => {
  it("defaults to 10 minutes when settings missing", () => {
    const vault = makeVault({ settings: undefined });
    expect(getContextTtlSeconds(vault)).toBe(600);
  });

  it("uses provided minutes", () => {
    const vault = makeVault({ settings: { contextTtlMinutes: 30 } });
    expect(getContextTtlSeconds(vault)).toBe(1800);
  });

  it("treats 0 minutes as never expire", () => {
    const vault = makeVault({ settings: { contextTtlMinutes: 0 } });
    expect(getContextTtlSeconds(vault)).toBe(0);
  });

  it("defaults to 600 for invalid (NaN/Infinity) values", () => {
    expect(getContextTtlSeconds(makeVault({ settings: { contextTtlMinutes: NaN } }))).toBe(600);
    expect(getContextTtlSeconds(makeVault({ settings: { contextTtlMinutes: Infinity } }))).toBe(600);
    // @ts-expect-error testing runtime handling of bad data
    expect(getContextTtlSeconds(makeVault({ settings: { contextTtlMinutes: "10" } }))).toBe(600);
  });
});
