// Pure logic functions for the Personafy plugin — no side effects, no I/O.
// Extracted so they can be unit-tested independently.

// ---- Types ----

export interface Fact {
  key: string;
  value: string;
  sensitivity: "low" | "medium" | "high";
  confidence: number;
}

export type AutoReleasePolicy = "follow_posture" | "always_ask" | "auto_low";
export type RetentionPeriod = "never" | "30" | "90" | "180" | "365";

export interface PersonaSettings {
  visible: boolean;
  autoRelease: AutoReleasePolicy;
  retention: RetentionPeriod;
}

export interface Persona {
  id: string;
  name: string;
  category: string;
  facts: Fact[];
  personaSettings?: PersonaSettings;
}

export interface PolicyRule {
  id: string;
  recipientDomain: string;
  purposeCategory: string;
  purposeAction: string;
  maxSensitivity: "low" | "medium" | "high";
  allowedFields: string[];
  expiresAt: string;
  enabled: boolean;
}

export interface AuditEvent {
  id: string;
  timestamp: string;
  requestId: string;
  decision: "allow" | "deny" | "ask_approved" | "ask_denied";
  recipientDomain: string;
  purpose: string;
  fieldsReleased: string[];
}

export interface VaultSettings {
  /** Minutes before released context expires. 0 means never expire. */
  contextTtlMinutes?: number;
  hideHighSensitivity?: boolean;
  approvalNotifications?: boolean;
}

export interface VaultDevice {
  id: string;
  name: string;
  type: "agent" | "vault" | "mobile";
  status: "connected" | "disconnected" | "pairing";
  lastSeen: string;
  ip?: string;
  version?: string;
  pairingCode?: string;
  pairingExpiresAt?: string;
}

export interface PendingApproval {
  id: string;
  createdAtMs: number;
  expiresAtMs: number;
  status: 'pending' | 'approved' | 'denied';
  resolvedAtMs?: number;
  request: {
    agentId: string;
    purpose: string;
    persona: string;
    fields: string[];
  };
  /** Facts found for this request (plugin-internal use) */
  matchedFacts?: Fact[];
}

export interface VaultData {
  version: string;
  createdAt?: string;
  privacyPosture: string;
  settings?: VaultSettings;
  devices?: VaultDevice[];
  personas: Persona[];
  rules: PolicyRule[];
  auditLog: AuditEvent[];
  approvalQueue?: PendingApproval[];
}

// ---- Pure functions ----

// Canonical source: apps/web/src/lib/factKeys.ts
// Keep in sync — this is a copy for the plugin package which cannot import from the web app.
const LEGACY_FACT_KEY_MAP: Record<string, string> = {
  // Shopping
  waist_size: "apparel.pants.waist",
  inseam: "apparel.pants.inseam",
  shirt_size: "apparel.shirt.size",
  shoe_size: "apparel.shoe.size",
  fit_preference: "apparel.fit_preference",
  material_likes: "apparel.material_likes",
  material_dislikes: "apparel.material_dislikes",
  preferred_brands: "apparel.preferred_brands",
  clothing_budget: "budget.monthly_clothing",
  brand_loyalty: "shopping.brand_loyalty",
  price_sensitivity: "shopping.price_sensitivity",
  seasonal_patterns: "shopping.seasonal_patterns",
  return_frequency: "shopping.return_frequency",

  // Travel
  travel_frequency: "travel.frequency",
  hotel_preference: "hotel.room_preference",
  hotel_dislikes: "hotel.room_dislikes",
  seat_preference: "flight.seat_preference",
  travel_benefits: "travel.loyalty_programs",
  frequent_destinations: "travel.favorite_destinations",
  hotel_chain: "travel.hotel_chain",
  travel_style: "travel.travel_style",
  trip_frequency: "travel.trip_frequency",

  // Food & Dining
  dietary_restrictions: "dietary.restrictions",
  food_allergies: "dietary.allergies",
  cuisine_preferences: "food.favorite_cuisines",
  coffee_preferences: "food.coffee_preferences",
  cooking_frequency: "food.cooking_frequency",
  meal_prep: "food.meal_prep",
  restaurant_budget: "food.restaurant_budget",
  cuisine_exploration: "food.cuisine_exploration",

  // Work
  work_tools: "work.tools",
  communication_style: "work.communication_style",

  // Fitness
  exercise_frequency: "fitness.frequency",
  fitness_goals: "fitness.goal",
  running_shoes: "fitness.running_shoes",
  fitness_apps: "fitness.apps",
  workout_frequency: "fitness.workout_frequency",
  equipment_owned: "fitness.equipment_owned",
  competition: "fitness.competition",

  // Gift Giving
  partner_interests: "gifts.partner_interests",
  mom_interests: "gifts.mom_interests",
  gift_budget: "budget.gift_range",
  budget_per_occasion: "gifts.budget_per_occasion",
  gift_style: "gifts.style",

  // Entertainment
  streaming_services: "entertainment.streaming_services",
  music_genres: "entertainment.music_genres",
  favorite_shows: "entertainment.favorite_shows",
  favorite_movies: "entertainment.favorite_movies",
  podcast_preferences: "entertainment.podcast_preferences",
  gaming_platforms: "entertainment.gaming_platforms",
  gaming_genres: "entertainment.gaming_genres",

  // Home & Living
  furniture_style: "home.furniture_style",
  home_size: "home.size",
  pets: "home.pets",
  pet_breeds: "home.pet_breeds",
  garden_preferences: "home.garden_preferences",
  smart_devices: "home.smart_devices",

  // Health & Wellness
  health_dietary_restrictions: "health.dietary_restrictions",
  allergies: "health.allergies",
  supplements: "health.supplements",
  sleep_schedule: "health.sleep_schedule",
  medical_preferences: "health.medical_preferences",
  mental_health: "health.mental_health",

  // Legacy dotted variants observed in fixtures/docs
  "apparel.pants.waist_in": "apparel.pants.waist",
  "apparel.pants.inseam_in": "apparel.pants.inseam",
  "apparel.pants.fit_preferences": "apparel.fit_preference",
  "apparel.shirts.size": "apparel.shirt.size",
  "apparel.shoes.size": "apparel.shoe.size",
};

export function normalizeFactKey(key: string): string {
  return LEGACY_FACT_KEY_MAP[key] ?? key;
}

function normalizeFieldPattern(pattern: string): string {
  if (pattern.endsWith(".*")) {
    const prefix = pattern.slice(0, -2);
    const normalizedPrefix = normalizeFactKey(prefix);
    return normalizedPrefix === prefix ? pattern : `${normalizedPrefix}.*`;
  }
  return normalizeFactKey(pattern);
}

export function isPersonaVisible(p: Persona): boolean {
  return p.personaSettings?.visible !== false;
}

const categoryMap: Record<string, string[]> = {
  shopping: ["shopping"],
  travel: ["travel"],
  food: ["food-dining", "food & dining"],
  dining: ["food-dining", "food & dining"],
  "food-dining": ["food-dining", "food & dining"],
  "food & dining": ["food-dining", "food & dining"],
  fitness: ["fitness"],
  gifts: ["gift-giving", "gift giving"],
  "gift-giving": ["gift-giving", "gift giving"],
  "gift giving": ["gift-giving", "gift giving"],
};

export function findMatchingPersona(
  vault: VaultData,
  personaHint?: string,
  purposeCategory?: string,
): Persona | undefined {
  const hint = personaHint?.trim() || undefined;
  const category = purposeCategory?.trim().toLowerCase() || undefined;

  if (hint) {
    const hintLower = hint.toLowerCase();
    return vault.personas.find(
      (p) =>
        isPersonaVisible(p) &&
        (p.id === hint ||
          p.id.toLowerCase() === hintLower ||
          p.name.toLowerCase().includes(hintLower) ||
          p.category.toLowerCase().includes(hintLower)),
    );
  }

  if (category) {
    const matchIds = categoryMap[category] || [];
    return vault.personas.find(
      (p) =>
        isPersonaVisible(p) &&
        (matchIds.some((id) => p.id === id || p.category.toLowerCase() === id) ||
          p.category.toLowerCase() === category ||
          p.id.toLowerCase() === category),
    );
  }

  return undefined;
}

export function findHiddenPersona(
  vault: VaultData,
  personaHint?: string,
  purposeCategory?: string,
): Persona | undefined {
  const hint = personaHint?.trim() || undefined;
  const category = purposeCategory?.trim().toLowerCase() || undefined;

  if (hint) {
    const hintLower = hint.toLowerCase();
    return vault.personas.find(
      (p) =>
        !isPersonaVisible(p) &&
        (p.id === hint ||
          p.id.toLowerCase() === hintLower ||
          p.name.toLowerCase().includes(hintLower) ||
          p.category.toLowerCase().includes(hintLower)),
    );
  }

  if (category) {
    const matchIds = categoryMap[category] || [];
    return vault.personas.find(
      (p) =>
        !isPersonaVisible(p) &&
        (matchIds.some((id) => p.id === id || p.category.toLowerCase() === id) ||
          p.category.toLowerCase() === category ||
          p.id.toLowerCase() === category),
    );
  }

  return undefined;
}

export function fieldMatchesPattern(factKey: string, pattern: string): boolean {
  const normalizedKey = normalizeFactKey(factKey);
  const normalizedPattern = normalizeFieldPattern(pattern);
  if (normalizedPattern.endsWith(".*")) {
    const prefix = normalizedPattern.slice(0, -2);
    return normalizedKey === prefix || normalizedKey.startsWith(prefix + ".");
  }
  return normalizedKey === normalizedPattern;
}

export function matchFacts(persona: Persona, fieldsRequested?: string[]): Fact[] {
  // Conservative default: no fields requested → no data released (least privilege).
  // Callers must specify explicit field patterns (e.g. "apparel.*") to receive data.
  if (!fieldsRequested || fieldsRequested.length === 0) {
    return [];
  }

  const normalizedPatterns = fieldsRequested.map(normalizeFieldPattern);

  const normalized = persona.facts.map((fact) => ({
    ...fact,
    key: normalizeFactKey(fact.key),
  }));

  const matched = normalized.filter((fact) =>
    normalizedPatterns.some((field) => fieldMatchesPattern(fact.key, field)),
  );

  // Dedupe after normalization (legacy keys can collapse to the same canonical key)
  const seen = new Set<string>();
  const deduped: Fact[] = [];
  for (const fact of matched) {
    const id = `${fact.key}::${fact.value.toLowerCase()}`;
    if (seen.has(id)) continue;
    seen.add(id);
    deduped.push(fact);
  }
  return deduped;
}

export function checkAutoAllow(
  vault: VaultData,
  recipientDomain: string,
  purposeCategory: string,
  purposeAction: string,
  facts: Fact[],
  personaSettings?: PersonaSettings,
): boolean {
  // Safe Room posture: never auto-allow
  if (vault.privacyPosture === "safe_room") {
    return false;
  }

  // Persona override: always require approval
  if (personaSettings?.autoRelease === "always_ask") {
    return false;
  }

  if (facts.length === 0) return false;

  const maxSensitivity = Math.max(
    ...facts.map((f) => {
      const levels: Record<string, number> = { low: 1, medium: 2, high: 3 };
      return levels[f.sensitivity] || 2;
    }),
  );

  // Persona override: auto-allow low sensitivity
  if (personaSettings?.autoRelease === "auto_low" && maxSensitivity <= 1) {
    return true;
  }

  // Simple Lock posture: auto-allow low sensitivity
  if (vault.privacyPosture === "simple_lock" && maxSensitivity <= 1) {
    return true;
  }

  // alarm_system posture: medium+ always requires approval, even with rules
  if (vault.privacyPosture === "alarm_system" && maxSensitivity >= 2) {
    return false;
  }

  // Check explicit rules
  const now = Date.now();
  for (const rule of vault.rules) {
    if (!rule.enabled) continue;
    // Strict expiration: invalid/empty dates treated as expired
    const expMs = Date.parse(rule.expiresAt);
    if (!Number.isFinite(expMs) || expMs < now) continue;

    if (
      rule.recipientDomain === recipientDomain &&
      rule.purposeCategory === purposeCategory &&
      rule.purposeAction === purposeAction
    ) {
      const ruleSensitivityLevel =
        { low: 1, medium: 2, high: 3 }[rule.maxSensitivity] || 2;
      if (maxSensitivity <= ruleSensitivityLevel) {
        if (rule.allowedFields && rule.allowedFields.length > 0) {
          const allCovered = facts.every((f) =>
            rule.allowedFields.some((pattern) => fieldMatchesPattern(f.key, pattern)),
          );
          if (!allCovered) continue;
        }
        return true;
      }
    }
  }

  return false;
}

export function getContextTtlSeconds(vault: VaultData): number {
  const raw = vault.settings?.contextTtlMinutes;

  // Default to 10 minutes if unspecified or invalid.
  if (raw == null) return 10 * 60;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 10 * 60;

  // 0 (or negative) means never expire.
  if (raw <= 0) return 0;

  return Math.round(raw * 60);
}

