// ============================================================================
// Shared extraction patterns for chat browser components (ChatGPT & Claude).
// ============================================================================

import type { ExtractionMatch } from '../../components/ExtractionHighlight';

export const CHAT_EXTRACTION_PATTERNS: Array<{
  regex: RegExp;
  factKey: string;
  category: string;
  confidence: number;
}> = [
  { regex: /\b(running|marathon|trail|hiking|climbing|yoga|meditation|pilates)\b/gi, factKey: 'fitness.activity', category: 'Fitness', confidence: 0.75 },
  { regex: /\b(plant-based|vegan|vegetarian|pescatarian)\b/gi, factKey: 'dietary.preference', category: 'Food & Dining', confidence: 0.85 },
  { regex: /\b(Hoka|Nike|Adidas|Allbirds|Patagonia|lululemon)\b/gi, factKey: 'apparel.brand', category: 'Shopping', confidence: 0.8 },
  { regex: /\bsize\s+(\d+(?:\.\d)?)\b/gi, factKey: 'apparel.size', category: 'Shopping', confidence: 0.85 },
  { regex: /\b(Strava|Headspace|Calm|MyFitnessPal)\b/gi, factKey: 'apps.preferred', category: 'Fitness', confidence: 0.8 },
  { regex: /\b(San Francisco|SF|Marin|Big Sur|Tokyo|Kyoto|NYC|Chicago|Portland|Seattle)\b/gi, factKey: 'location.mentioned', category: 'Travel', confidence: 0.7 },
  { regex: /\b(TypeScript|React|Python|VS Code|Figma|Linear)\b/gi, factKey: 'work.tools', category: 'Work', confidence: 0.75 },
  { regex: /\b(minimalist|Japanese style|Muji|Sonos|Philips Hue)\b/gi, factKey: 'home.style', category: 'Home & Living', confidence: 0.7 },
  { regex: /\b(Spotify|Netflix|Audible|Kindle)\b/gi, factKey: 'entertainment.service', category: 'Entertainment', confidence: 0.75 },
  { regex: /\b(coffee|espresso|pour.over|light roast|oat milk)\b/gi, factKey: 'food.coffee', category: 'Food & Dining', confidence: 0.7 },
  { regex: /\b(sushi|thai|mediterranean|italian|chinese|japanese|korean|mexican|indian|french|vietnamese)\b/gi, factKey: 'food.favorite_cuisines', category: 'Food & Dining', confidence: 0.7 },
];

/**
 * Run shared extraction patterns against a message and return highlight matches.
 */
export function extractMessageMatches(text: string): ExtractionMatch[] {
  const matches: ExtractionMatch[] = [];
  for (const pattern of CHAT_EXTRACTION_PATTERNS) {
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        factKey: pattern.factKey,
        category: pattern.category,
        confidence: pattern.confidence,
      });
    }
  }
  return matches;
}
