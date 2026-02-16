import type {
  PersonafyContextRequest,
  PersonafyRule,
  PersonafyScheduledRule,
  PersonafyVault,
} from "./types.js";

export type RuleDecision = {
  /** Fields approved by matching rules. */
  approvedFields: string[];
  /** Fields not covered by any rule. */
  unapprovedFields: string[];
  /** The rules that matched. */
  matchedRules: Array<PersonafyRule | PersonafyScheduledRule>;
};

// ---------------------------------------------------------------------------
// Standard rule evaluation
// ---------------------------------------------------------------------------

function matchesStandardRule(rule: PersonafyRule, request: PersonafyContextRequest): boolean {
  if (rule.persona !== request.persona) return false;
  if (rule.agentId && rule.agentId !== request.agentId) return false;
  if (rule.purposePattern) {
    if (!request.purpose.toLowerCase().includes(rule.purposePattern.toLowerCase())) {
      return false;
    }
  }
  return true;
}

export function evaluateRules(
  request: PersonafyContextRequest,
  vault: PersonafyVault,
): RuleDecision {
  const approvedFieldSet = new Set<string>();
  const matchedRules: PersonafyRule[] = [];

  for (const rule of vault.rules) {
    if (!matchesStandardRule(rule, request)) continue;
    matchedRules.push(rule);
    for (const field of rule.fields) {
      if (request.fields.includes(field)) {
        approvedFieldSet.add(field);
      }
    }
  }

  const approvedFields = [...approvedFieldSet];
  const unapprovedFields = request.fields.filter((f) => !approvedFieldSet.has(f));
  return { approvedFields, unapprovedFields, matchedRules };
}

// ---------------------------------------------------------------------------
// Scheduled rule evaluation
// ---------------------------------------------------------------------------

function parseTimeHHMM(time: string): { hours: number; minutes: number } | null {
  const match = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  return { hours: Number(match[1]), minutes: Number(match[2]) };
}

function isWithinTimeWindow(
  window: { from: string; to: string },
  nowMs: number = Date.now(),
): boolean {
  const from = parseTimeHHMM(window.from);
  const to = parseTimeHHMM(window.to);
  if (!from || !to) return false;

  const now = new Date(nowMs);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const fromMinutes = from.hours * 60 + from.minutes;
  const toMinutes = to.hours * 60 + to.minutes;

  if (fromMinutes <= toMinutes) {
    return nowMinutes >= fromMinutes && nowMinutes <= toMinutes;
  }
  // Wraps midnight
  return nowMinutes >= fromMinutes || nowMinutes <= toMinutes;
}

export function isScheduledRuleActive(
  rule: PersonafyScheduledRule,
  nowMs: number = Date.now(),
): boolean {
  if (nowMs > rule.expiresAtMs) return false;
  if (rule.timeWindow && !isWithinTimeWindow(rule.timeWindow, nowMs)) return false;
  return true;
}

export function evaluateScheduledRules(
  request: PersonafyContextRequest,
  vault: PersonafyVault,
  nowMs: number = Date.now(),
): RuleDecision {
  const approvedFieldSet = new Set<string>();
  const matchedRules: PersonafyScheduledRule[] = [];

  for (const rule of vault.scheduledRules) {
    if (!isScheduledRuleActive(rule, nowMs)) continue;
    if (rule.persona !== request.persona) continue;
    if (rule.agentId && rule.agentId !== request.agentId) continue;
    if (request.sourceId && rule.sourceId !== request.sourceId) continue;
    if (rule.kind !== request.requestType) continue;

    matchedRules.push(rule);
    for (const field of rule.fields) {
      if (request.fields.includes(field)) {
        approvedFieldSet.add(field);
      }
    }
  }

  const approvedFields = [...approvedFieldSet];
  const unapprovedFields = request.fields.filter((f) => !approvedFieldSet.has(f));
  return { approvedFields, unapprovedFields, matchedRules };
}
