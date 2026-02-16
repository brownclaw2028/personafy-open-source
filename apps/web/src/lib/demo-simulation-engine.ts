// Demo simulation engine — generates timed SimulationEvent[] for the interactive demo.
// Contains local copies of pure functions from packages/openclaw-plugin/lib.ts.

import type { SimulationEvent } from '../hooks/useSimulation';
import type { DemoScenario } from '../data/demo-scenarios';

// ---- Types ----

type SimEventType =
  | 'agent_message'
  | 'vault_receive'
  | 'fact_match'
  | 'sensitivity_check'
  | 'posture_check'
  | 'deidentify_field'
  | 'deidentify_complete'
  | 'approval_check'
  | 'data_release'
  | 'agent_processing'
  | 'agent_response'
  | 'audit_log';

// ---- Copied pure functions ----
// TODO: These are local copies of matchFacts, checkAutoAllow, fieldMatchesPattern
// from packages/openclaw-plugin/lib.ts and should be imported from the shared module.
// Canonical: packages/openclaw-plugin/lib.ts

interface Fact {
  key: string;
  value: string;
  sensitivity: 'low' | 'medium' | 'high';
  confidence: number;
}

function fieldMatchesPattern(factKey: string, pattern: string): boolean {
  if (pattern.endsWith('.*')) {
    const prefix = pattern.slice(0, -2);
    return factKey === prefix || factKey.startsWith(prefix + '.');
  }
  return factKey === pattern;
}

function matchFacts(facts: Fact[], fieldsRequested: string[]): Fact[] {
  if (!fieldsRequested || fieldsRequested.length === 0) return [];
  return facts.filter((fact) =>
    fieldsRequested.some((field) => fieldMatchesPattern(fact.key, field)),
  );
}

function checkAutoAllow(
  posture: string,
  facts: Fact[],
): { allowed: boolean; reason: string } {
  const maxSensitivity = Math.max(
    ...facts.map((f) => {
      const levels: Record<string, number> = { low: 1, medium: 2, high: 3 };
      return levels[f.sensitivity] || 2;
    }),
  );

  if (posture === 'safe_room') {
    return { allowed: false, reason: 'Strict: all requests require approval' };
  }

  if (posture === 'simple_lock' && maxSensitivity <= 1) {
    return { allowed: true, reason: 'Relaxed: low sensitivity auto-allowed' };
  }

  if (posture === 'alarm_system') {
    if (maxSensitivity >= 2) {
      return { allowed: false, reason: 'Balanced: medium+ requires approval' };
    }
    return { allowed: true, reason: 'Balanced: low sensitivity auto-allowed' };
  }

  return { allowed: false, reason: 'Requires approval' };
}

// ---- Simulation generator ----

function makeEvent(
  type: SimEventType,
  timestamp: number,
  duration: number,
  data: Record<string, unknown>,
  eventCounter: { value: number },
  educationNote?: string,
): SimulationEvent {
  return {
    id: `sim-${++eventCounter.value}`,
    type,
    timestamp,
    duration,
    data,
    educationNote,
  };
}

export function generateSimulation(
  scenario: DemoScenario,
  posture = 'alarm_system',
): SimulationEvent[] {
  const counter = { value: 0 };
  const events: SimulationEvent[] = [];
  const matched = matchFacts(scenario.facts, scenario.fieldsRequested);

  // 0-2s: Agent sends request
  events.push(
    makeEvent('agent_message', 0, 2000, {
      message: scenario.agentQuery,
      fields: scenario.fieldsRequested,
    }, counter, 'The AI agent tells Personafy exactly which data fields it needs — nothing more.'),
  );

  // 2-3s: Vault receives
  events.push(
    makeEvent('vault_receive', 2000, 1000, {
      domain: scenario.agentDomain,
      fieldsRequested: scenario.fieldsRequested,
    }, counter, 'Your vault receives the request and begins processing. No data has been shared yet.'),
  );

  // 3-6s: Facts matched (one per ~300ms)
  matched.forEach((fact, i) => {
    events.push(
      makeEvent('fact_match', 3000 + i * 400, 400, {
        key: fact.key,
        value: fact.value,
        sensitivity: fact.sensitivity,
        confidence: fact.confidence,
        category: fact.key.split('.')[0],
      }, counter, i === 0 ? 'Personafy finds only the relevant facts from your vault — not everything.' : undefined),
    );
  });

  // 6-7s: Sensitivity check
  const sensitivityCounts = { low: 0, medium: 0, high: 0 };
  matched.forEach((f) => sensitivityCounts[f.sensitivity]++);
  events.push(
    makeEvent('sensitivity_check', 6000, 1000, {
      counts: sensitivityCounts,
      maxLevel: sensitivityCounts.high > 0 ? 'high' : sensitivityCounts.medium > 0 ? 'medium' : 'low',
    }, counter, 'Each fact has a sensitivity level. Higher sensitivity means stricter controls.'),
  );

  // 7-8s: Posture check
  const autoAllow = checkAutoAllow(posture, matched);
  events.push(
    makeEvent('posture_check', 7000, 1000, {
      posture,
      decision: autoAllow.allowed ? 'auto-allowed' : 'requires approval',
      reason: autoAllow.reason,
    }, counter, `Your privacy posture "${posture.replace(/_/g, ' ')}" determines what gets shared automatically.`),
  );

  // 8-10s: De-identification
  if (scenario.deidentifyMappings.length > 0) {
    scenario.deidentifyMappings.forEach((mapping, i) => {
      events.push(
        makeEvent('deidentify_field', 8000 + i * 500, 500, {
          original: mapping.original,
          masked: mapping.masked,
          method: mapping.method,
        }, counter, i === 0 ? 'Sensitive values are masked or generalized before sharing.' : undefined),
      );
    });

    events.push(
      makeEvent('deidentify_complete', 9500, 500, {
        fieldsProcessed: scenario.deidentifyMappings.length,
      }, counter),
    );
  }

  // 10-11s: Approval check
  events.push(
    makeEvent('approval_check', 10000, 1000, {
      autoApproved: autoAllow.allowed,
      reason: autoAllow.reason,
    }, counter, autoAllow.allowed
      ? 'Low-sensitivity data was auto-approved by your posture settings.'
      : 'Your vault asks for your approval before sharing medium or high sensitivity data.'),
  );

  // 11-12s: Data release
  const releasedFacts = matched.map((f) => {
    const mapping = scenario.deidentifyMappings.find((m) => m.factKey === f.key);
    return {
      key: f.key,
      value: mapping ? mapping.masked : f.value,
      sensitivity: f.sensitivity,
    };
  });
  events.push(
    makeEvent('data_release', 11000, 1000, {
      facts: releasedFacts,
      domain: scenario.agentDomain,
    }, counter, 'Only the approved, de-identified facts are released to the agent.'),
  );

  // 12-14s: Agent processing
  events.push(
    makeEvent('agent_processing', 12000, 2000, {
      status: 'thinking',
    }, counter),
  );

  // 14-15s: Agent response
  events.push(
    makeEvent('agent_response', 14000, 1000, {
      message: scenario.agentResponse,
    }, counter, 'The agent uses your context to give a truly personalized response.'),
  );

  // 15s: Audit log
  events.push(
    makeEvent('audit_log', 15000, 500, {
      timestamp: new Date().toISOString(),
      domain: scenario.agentDomain,
      fieldsReleased: matched.map((f) => f.key),
      decision: autoAllow.allowed ? 'auto_allowed' : 'ask_approved',
    }, counter, 'Every interaction is permanently logged in your audit trail.'),
  );

  return events;
}
