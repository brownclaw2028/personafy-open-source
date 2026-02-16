import { ArrowRight, Lightbulb } from 'lucide-react';
import { ExtractionHighlight, type ExtractionMatch } from '../../components/ExtractionHighlight';

// Pre-built extraction data per persona
interface ExtractedFact {
  key: string;
  value: string;
  sensitivity: 'low' | 'medium' | 'high';
  confidence: number;
  category: string;
}

interface RawSnippet {
  text: string;
  source: string;
  matches: ExtractionMatch[];
}

interface PersonaExtractionData {
  snippets: RawSnippet[];
  facts: ExtractedFact[];
}

const EXTRACTION_DATA: Record<string, PersonaExtractionData> = {
  alex: {
    snippets: [
      { source: 'Gmail', text: 'Your Patagonia Nano Puff Jacket (Men\'s M, slim fit) is on its way to San Francisco.', matches: [{ start: 5, end: 38, factKey: 'apparel.jacket', category: 'Shopping', confidence: 0.9 }, { start: 47, end: 55, factKey: 'apparel.fit', category: 'Shopping', confidence: 0.85 }] },
      { source: 'Amazon', text: 'Hoka Speedgoat 5 — Men\'s Size 10.5. Trail running shoe with Vibram outsole.', matches: [{ start: 0, end: 34, factKey: 'fitness.shoes', category: 'Fitness', confidence: 0.95 }] },
      { source: 'ChatGPT', text: 'I prefer recycled polyester and organic cotton. Slim athletic fit works best for me.', matches: [{ start: 9, end: 27, factKey: 'material', category: 'Shopping', confidence: 0.85 }, { start: 48, end: 67, factKey: 'fit', category: 'Shopping', confidence: 0.82 }] },
    ],
    facts: [
      { key: 'apparel.pants.waist', value: '32"', sensitivity: 'low', confidence: 0.95, category: 'Apparel' },
      { key: 'apparel.pants.inseam', value: '32"', sensitivity: 'low', confidence: 0.90, category: 'Apparel' },
      { key: 'apparel.fit_preference', value: 'slim athletic', sensitivity: 'low', confidence: 0.85, category: 'Apparel' },
      { key: 'apparel.material_likes', value: 'merino wool, recycled polyester', sensitivity: 'low', confidence: 0.80, category: 'Apparel' },
      { key: 'apparel.shoe.size', value: '10.5', sensitivity: 'low', confidence: 0.95, category: 'Apparel' },
      { key: 'fitness.running_shoes', value: 'Hoka Speedgoat 5', sensitivity: 'low', confidence: 0.92, category: 'Fitness' },
      { key: 'fitness.goal', value: 'trail ultramarathon', sensitivity: 'low', confidence: 0.88, category: 'Fitness' },
      { key: 'fitness.frequency', value: '5-6 days/week', sensitivity: 'low', confidence: 0.90, category: 'Fitness' },
      { key: 'travel.loyalty_programs', value: 'Alaska Airlines MVP', sensitivity: 'medium', confidence: 0.75, category: 'Travel' },
    ],
  },
  sarah: {
    snippets: [
      { source: 'Gmail', text: 'Your case of 2019 Châteauneuf-du-Pape and 2018 Barolo is shipping this week.', matches: [{ start: 14, end: 44, factKey: 'wine', category: 'Food', confidence: 0.92 }, { start: 49, end: 61, factKey: 'wine', category: 'Food', confidence: 0.90 }] },
      { source: 'ChatGPT', text: 'I love pairing Rhône wines with lamb and Burgundy with mushroom dishes.', matches: [{ start: 15, end: 27, factKey: 'wine', category: 'Food', confidence: 0.90 }, { start: 38, end: 46, factKey: 'wine', category: 'Food', confidence: 0.88 }] },
    ],
    facts: [
      { key: 'food.wine_preferences', value: 'Châteauneuf-du-Pape, Barolo, Rhône, Burgundy', sensitivity: 'low', confidence: 0.92, category: 'Food' },
      { key: 'food.pairings', value: 'lamb, mushroom dishes', sensitivity: 'low', confidence: 0.88, category: 'Food' },
    ],
  },
  jordan: {
    snippets: [
      { source: 'Etsy', text: 'Your 1978 Levi\'s Type III Trucker Jacket (M, oversized fit) is on its way!', matches: [{ start: 5, end: 40, factKey: 'brand', category: 'Shopping', confidence: 0.92 }, { start: 45, end: 58, factKey: 'fit', category: 'Shopping', confidence: 0.85 }] },
      { source: 'ChatGPT', text: 'I\'m heading to Mexico City next month. Love street tacos and local cortado spots.', matches: [{ start: 16, end: 27, factKey: 'destination', category: 'Travel', confidence: 0.88 }, { start: 44, end: 57, factKey: 'food', category: 'Food', confidence: 0.85 }] },
    ],
    facts: [
      { key: 'apparel.fit_preference', value: 'oversized vintage', sensitivity: 'low', confidence: 0.88, category: 'Apparel' },
      { key: 'apparel.preferred_brands', value: "Levi's Type III", sensitivity: 'low', confidence: 0.92, category: 'Apparel' },
      { key: 'food.street_food', value: 'street tacos, cortado', sensitivity: 'low', confidence: 0.85, category: 'Food' },
      { key: 'travel.upcoming_trip', value: 'Mexico City', sensitivity: 'low', confidence: 0.88, category: 'Travel' },
    ],
  },
  priya: {
    snippets: [
      { source: 'Gmail', text: 'Organic snack box, nut-free granola bars, and turmeric golden milk mix shipped.', matches: [{ start: 18, end: 26, factKey: 'allergy', category: 'Food', confidence: 0.95 }] },
      { source: 'ChatGPT', text: 'Must be completely nut-free due to allergies. We are a vegetarian household.', matches: [{ start: 19, end: 27, factKey: 'allergy', category: 'Food', confidence: 0.95 }, { start: 55, end: 65, factKey: 'diet', category: 'Food', confidence: 0.92 }] },
    ],
    facts: [
      { key: 'dietary.restrictions', value: 'vegetarian household', sensitivity: 'low', confidence: 0.95, category: 'Dietary' },
      { key: 'dietary.allergies', value: 'tree nuts, peanuts (child)', sensitivity: 'high', confidence: 0.98, category: 'Dietary' },
      { key: 'food.favorite_cuisines', value: 'Indian, Mediterranean, Thai', sensitivity: 'low', confidence: 0.85, category: 'Food' },
      { key: 'travel.favorite_destinations', value: 'Goa, Bali, Costa Rica', sensitivity: 'low', confidence: 0.82, category: 'Travel' },
    ],
  },
  marcus: {
    snippets: [
      { source: 'Gmail', text: 'Your Veritas Low-Angle Jack Plane and Narex Premium Chisel Set have shipped.', matches: [{ start: 5, end: 33, factKey: 'tools', category: 'Work', confidence: 0.92 }, { start: 38, end: 62, factKey: 'tools', category: 'Work', confidence: 0.90 }] },
      { source: 'ChatGPT', text: 'I want to build a Roubo workbench using hand-cut dovetail joints with my hand planes and chisels.', matches: [{ start: 18, end: 34, factKey: 'project', category: 'Work', confidence: 0.88 }, { start: 41, end: 64, factKey: 'technique', category: 'Work', confidence: 0.85 }] },
    ],
    facts: [
      { key: 'work.tools', value: 'Veritas jack plane, Narex chisels', sensitivity: 'low', confidence: 0.92, category: 'Work' },
      { key: 'work.current_project', value: 'Roubo workbench', sensitivity: 'low', confidence: 0.88, category: 'Work' },
      { key: 'work.techniques', value: 'hand-cut dovetail joints', sensitivity: 'low', confidence: 0.85, category: 'Work' },
    ],
  },
};

const SENSITIVITY_STYLES: Record<string, { dot: string; label: string }> = {
  low: { dot: 'bg-green-400', label: 'Low' },
  medium: { dot: 'bg-yellow-400', label: 'Medium' },
  high: { dot: 'bg-red-400', label: 'High' },
};

interface DemoExtractionViewProps {
  personaId: string;
  onContinue: () => void;
}

export function DemoExtractionView({ personaId, onContinue }: DemoExtractionViewProps) {
  const data = EXTRACTION_DATA[personaId];
  if (!data) return null;

  // Group facts by category
  const grouped = data.facts.reduce<Record<string, ExtractedFact[]>>((acc, f) => {
    if (!acc[f.category]) acc[f.category] = [];
    acc[f.category].push(f);
    return acc;
  }, {});

  return (
    <div className="min-h-screen flex flex-col px-8 py-12 max-w-6xl mx-auto animate-fade-in">
      {/* Header */}
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-white mb-2">Extracted facts</h2>
        <p className="text-text-secondary">
          Raw data becomes structured, categorized facts with sensitivity levels.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 flex-1">
        {/* Left: Raw snippets */}
        <div>
          <h3 className="text-sm font-semibold text-text-tertiary uppercase tracking-wider mb-4">Raw data</h3>
          <div className="space-y-4">
            {data.snippets.map((snippet, i) => (
              <div key={i} className="glass-card p-4">
                <div className="text-[11px] text-text-tertiary uppercase tracking-wider mb-2">{snippet.source}</div>
                <p className="text-sm text-text-secondary leading-relaxed">
                  <ExtractionHighlight text={snippet.text} matches={snippet.matches} />
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Extracted facts */}
        <div>
          <h3 className="text-sm font-semibold text-text-tertiary uppercase tracking-wider mb-4">Extracted facts</h3>
          <div className="space-y-6 stagger-children">
            {Object.entries(grouped).map(([category, facts]) => (
              <div key={category}>
                <h4 className="text-white font-medium text-sm mb-3">{category}</h4>
                <div className="space-y-2">
                  {facts.map((fact) => {
                    const sens = SENSITIVITY_STYLES[fact.sensitivity];
                    return (
                      <div
                        key={fact.key}
                        className="flex items-center gap-3 p-3 rounded-lg bg-white/[0.08] border border-card-border/35"
                        style={{ animation: 'factSlideIn 0.3s ease-out both' }}
                      >
                        {/* Sensitivity dot */}
                        <div className={`w-2.5 h-2.5 rounded-full ${sens.dot} flex-shrink-0`} title={`${sens.label} sensitivity`} />

                        {/* Key/value */}
                        <div className="flex-1 min-w-0">
                          <span className="text-text-tertiary text-xs font-mono">{fact.key}</span>
                          <div className="text-white text-sm truncate">{fact.value}</div>
                        </div>

                        {/* Confidence bar */}
                        <div className="w-16 flex-shrink-0">
                          <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-primary rounded-full transition-all duration-500"
                              style={{ width: `${Math.round(fact.confidence * 100)}%` }}
                            />
                          </div>
                          <div className="text-[10px] text-text-tertiary text-right mt-0.5">
                            {Math.round(fact.confidence * 100)}%
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Education note */}
      <div className="flex items-start gap-3 p-4 rounded-lg bg-accent/5 border border-accent/20 mt-8">
        <Lightbulb className="w-5 h-5 text-accent flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-accent font-medium text-sm mb-1">Privacy by design</p>
          <p className="text-text-tertiary text-sm">
            Each fact is assigned a sensitivity level. High-sensitivity facts (like allergy details)
            get extra protection and are de-identified before sharing with AI agents.
          </p>
        </div>
      </div>

      {/* Continue */}
      <div className="flex justify-end mt-8">
        <button onClick={onContinue} className="btn-primary flex items-center gap-2">
          See it in action <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
