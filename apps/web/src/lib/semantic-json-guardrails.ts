import type { GeneralExtractedFact, GeneralExtractionRecord } from './general-extractor';
import type { SemanticExtractionContract } from './semantic-contracts';
import { validateSemanticContract } from './semantic-contracts';

export interface SemanticJsonGuardrailsResult {
  contracts: SemanticExtractionContract[];
  facts: GeneralExtractedFact[];
  rejectedContracts: number;
}

function sourceTextById(records: GeneralExtractionRecord[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const record of records) {
    map.set(record.sourceId, record.content);
  }
  return map;
}

function signatureForFact(fact: GeneralExtractedFact): string {
  return `${fact.key.toLowerCase()}::${fact.value.trim().toLowerCase()}`;
}

function contractToFact(contract: SemanticExtractionContract): GeneralExtractedFact {
  return {
    key: contract.canonical_key ?? contract.dynamic_key ?? 'dynamic.unknown',
    value: contract.value,
    confidence: Math.max(0, Math.min(1, contract.confidence)),
    sensitivity: contract.sensitivity,
    source: contract.source_name,
    extractedAt: Date.now(),
    negated: contract.is_negation || undefined,
    extractionMethod: 'general',
    evidence: [
      {
        sourceId: contract.source_id,
        sourceName: contract.source_name,
        snippet: contract.evidence_snippet,
        segmentIndex: 0,
      },
    ],
  };
}

function dedupeFacts(facts: GeneralExtractedFact[]): GeneralExtractedFact[] {
  const deduped = new Map<string, GeneralExtractedFact>();
  for (const fact of facts) {
    const signature = signatureForFact(fact);
    const existing = deduped.get(signature);
    if (!existing) {
      deduped.set(signature, fact);
      continue;
    }
    const preferred = fact.confidence >= existing.confidence ? fact : existing;
    const secondary = preferred === fact ? existing : fact;
    deduped.set(signature, {
      ...preferred,
      confidence: Math.max(preferred.confidence, secondary.confidence),
      evidence: [...(preferred.evidence ?? []), ...(secondary.evidence ?? [])].slice(0, 8),
    });
  }
  return [...deduped.values()].sort((a, b) => b.confidence - a.confidence);
}

export function applySemanticJsonGuardrails(params: {
  records: GeneralExtractionRecord[];
  contracts: unknown[];
}): SemanticJsonGuardrailsResult {
  const sourceTextMap = sourceTextById(params.records);
  const acceptedContracts: SemanticExtractionContract[] = [];
  let rejectedContracts = 0;

  for (const candidate of params.contracts) {
    if (!candidate || typeof candidate !== 'object') {
      rejectedContracts += 1;
      continue;
    }

    const sourceId = typeof (candidate as Record<string, unknown>).source_id === 'string'
      ? ((candidate as Record<string, unknown>).source_id as string)
      : '';
    const sourceText = sourceTextMap.get(sourceId) ?? '';
    const validated = validateSemanticContract(candidate, sourceText);
    if (!validated) {
      rejectedContracts += 1;
      continue;
    }
    if (validated.temporal_status !== 'current') {
      rejectedContracts += 1;
      continue;
    }
    acceptedContracts.push(validated);
  }

  const facts = dedupeFacts(acceptedContracts.map(contractToFact));
  return {
    contracts: acceptedContracts,
    facts,
    rejectedContracts,
  };
}
