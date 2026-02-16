import type { SourceType } from './source-types';

export interface SourceLineage {
  sourceType: SourceType;
  personaIds: string[];
  packageVersion: string;
  packageFormat: string;
  buildDate: string;
  contractVerified: boolean;
  contractStatus: 'stable' | 'experimental';
}

const PERSONA_IDS = ['alex', 'sarah', 'jordan', 'priya', 'marcus'];

export function getSourceLineage(sourceType: SourceType, persona: string): SourceLineage {
  return {
    sourceType,
    personaIds: persona === 'all' ? PERSONA_IDS : [persona],
    packageVersion: '1.0.0',
    packageFormat: 'json',
    buildDate: '2026-02-16',
    contractVerified: true,
    contractStatus: 'stable',
  };
}

export async function loadCanonicalSourceDataset<T>(
  sourceType: string,
  persona: string,
): Promise<T[]> {
  const key = `demo-${sourceType}-${persona}`;
  const modules = import.meta.glob<{ default: T[] }>('../data/demo-*.json');
  const path = `../data/${key}.json`;
  const loader = modules[path];
  if (!loader) {
    console.warn(`No demo dataset found for ${key}`);
    return [];
  }
  const mod = await loader();
  return mod.default;
}

export const CANONICAL_PERSONA_OPTIONS = [
  { id: 'alex', name: 'Alex Chen', avatarColor: '#6366f1', tagline: 'Minimalist runner who codes' },
  { id: 'sarah', name: 'Sarah Mitchell', avatarColor: '#ec4899', tagline: 'Luxury traveler and wine enthusiast' },
  { id: 'jordan', name: 'Jordan Rivera', avatarColor: '#f59e0b', tagline: 'Vintage collector and festival foodie' },
  { id: 'priya', name: 'Dr. Priya Sharma', avatarColor: '#10b981', tagline: 'Health-conscious mom of 3 who optimizes everything' },
  { id: 'marcus', name: 'Marcus Thompson', avatarColor: '#8b5cf6', tagline: 'Woodworker, bookworm, and garden enthusiast' },
];

export function resolvePersonaSelection(input: string): string[] {
  const normalized = input.trim().toLowerCase();
  if (normalized === 'all') return PERSONA_IDS;
  const match = CANONICAL_PERSONA_OPTIONS.find(
    (p) => p.id === normalized || p.name.toLowerCase() === normalized,
  );
  return match ? [match.id] : [];
}
