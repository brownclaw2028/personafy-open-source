import { normalizeFactKey } from './factKeys';

interface FactLike {
  key: string;
  value: string;
}

export interface SemanticShadowMetrics {
  baselineCount: number;
  semanticCount: number;
  overlapCount: number;
  semanticOnlyCount: number;
  baselineOnlyCount: number;
  precisionProxy: number;
  recallProxy: number;
  f1Proxy: number;
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function signatureForFact(fact: FactLike): string {
  return `${normalizeFactKey(fact.key)}::${fact.value.trim().toLowerCase()}`;
}

export function computeSemanticShadowMetrics(
  baselineFacts: FactLike[],
  semanticFacts: FactLike[],
): SemanticShadowMetrics {
  const baseline = new Set(baselineFacts.map(signatureForFact));
  const semantic = new Set(semanticFacts.map(signatureForFact));

  let overlapCount = 0;
  for (const signature of semantic) {
    if (baseline.has(signature)) overlapCount += 1;
  }

  const baselineCount = baseline.size;
  const semanticCount = semantic.size;
  const semanticOnlyCount = semanticCount - overlapCount;
  const baselineOnlyCount = baselineCount - overlapCount;
  const precisionProxy = semanticCount > 0 ? overlapCount / semanticCount : 0;
  const recallProxy = baselineCount > 0 ? overlapCount / baselineCount : 0;
  const f1Denominator = precisionProxy + recallProxy;
  const f1Proxy = f1Denominator > 0
    ? (2 * precisionProxy * recallProxy) / f1Denominator
    : 0;

  return {
    baselineCount,
    semanticCount,
    overlapCount,
    semanticOnlyCount,
    baselineOnlyCount,
    precisionProxy: clampUnit(precisionProxy),
    recallProxy: clampUnit(recallProxy),
    f1Proxy: clampUnit(f1Proxy),
  };
}
