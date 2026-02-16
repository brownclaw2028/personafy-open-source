// ============================================================================
// Shared Persona Generator — consolidates identical persona generation logic
// from ChatGPT, Claude, and Notion extractors.
// ============================================================================

import type { Fact, Persona, PersonaCategory } from './types';

/** Maps persona categories to the fact keys that belong in each. */
const CATEGORY_MAPPINGS: Partial<Record<PersonaCategory, string[]>> = {
  'Shopping': [
    'apparel.pants.waist', 'apparel.pants.inseam', 'apparel.shirt.size',
    'apparel.shoe.size', 'apparel.fit_preference', 'apparel.material_likes',
    'apparel.material_dislikes', 'apparel.preferred_brands', 'budget.monthly_clothing',
    'shopping.brand_loyalty', 'shopping.price_sensitivity',
    'shopping.seasonal_patterns', 'shopping.return_frequency',
  ],
  'Travel': [
    'travel.frequency', 'hotel.room_preference', 'hotel.room_dislikes',
    'flight.seat_preference', 'travel.loyalty_programs', 'travel.favorite_destinations',
    'travel.packing_style', 'travel.hotel_chain', 'travel.travel_style',
    'travel.trip_frequency',
  ],
  'Food & Dining': [
    'dietary.restrictions', 'dietary.allergies', 'food.favorite_cuisines',
    'food.coffee_preferences', 'food.cooking_style', 'food.cooking_frequency',
    'food.meal_prep', 'food.restaurant_budget', 'food.cuisine_exploration',
  ],
  'Work': ['work.tools', 'work.communication_style'],
  'Fitness': [
    'fitness.frequency', 'fitness.goal', 'fitness.running_shoes', 'fitness.apps',
    'fitness.workout_frequency', 'fitness.equipment_owned', 'fitness.competition',
  ],
  'Gift Giving': [
    'gifts.partner_interests', 'gifts.mom_interests', 'gifts.dad_interests',
    'budget.gift_range', 'gifts.budget_per_occasion', 'gifts.style',
  ],
};

const PERSONA_DESCRIPTIONS: Partial<Record<PersonaCategory, string>> = {
  'Shopping': 'Your clothing preferences, sizes, and shopping habits',
  'Travel': 'Hotel preferences, seating choices, and travel patterns',
  'Food & Dining': 'Dietary restrictions, cuisine preferences, and dining habits',
  'Work': 'Tools, communication style, and work preferences',
  'Fitness': 'Exercise routines, equipment choices, and fitness goals',
  'Gift Giving': 'Gift preferences for family and friends',
};

const PERSONA_ICONS: Partial<Record<PersonaCategory, string>> = {
  'Shopping': 'ShoppingBag',
  'Travel': 'Plane',
  'Food & Dining': 'UtensilsCrossed',
  'Work': 'Briefcase',
  'Fitness': 'Activity',
  'Gift Giving': 'Gift',
};

const EXPECTED_FACT_COUNTS: Partial<Record<PersonaCategory, number>> = {
  'Shopping': 8,
  'Travel': 6,
  'Food & Dining': 4,
  'Work': 3,
  'Fitness': 4,
  'Gift Giving': 3,
};

export function getFactsForCategory(category: PersonaCategory, facts: Fact[]): Fact[] {
  const relevantKeys = CATEGORY_MAPPINGS[category] || [];
  return facts.filter(fact => relevantKeys.includes(fact.key));
}

function generatePersonaDescription(category: PersonaCategory): string {
  return PERSONA_DESCRIPTIONS[category] || category;
}

function getPersonaIcon(category: PersonaCategory): string {
  return PERSONA_ICONS[category] || 'FileText';
}

function calculateCompletionScore(category: PersonaCategory, facts: Fact[]): number {
  const expected = EXPECTED_FACT_COUNTS[category] || 3;
  const actual = facts.length;
  if (actual === 0) return 0;
  const avgConfidence = facts.reduce((sum, fact) => sum + fact.confidence, 0) / actual;
  const completeness = Math.min(1, actual / expected);
  return Math.round((completeness * 0.7 + avgConfidence * 0.3) * 100) / 100;
}

const DEFAULT_CATEGORIES: PersonaCategory[] = [
  'Shopping', 'Travel', 'Food & Dining', 'Work', 'Fitness', 'Gift Giving',
];

/**
 * Generate personas from a flat list of extracted facts.
 * Used by ChatGPT, Claude, and Notion extractors.
 */
export function generatePersonas(facts: Fact[], categories: PersonaCategory[] = DEFAULT_CATEGORIES): Persona[] {
  const personas: Persona[] = [];

  for (const category of categories) {
    const catFacts = getFactsForCategory(category, facts);
    if (catFacts.length > 0) {
      personas.push({
        id: category.toLowerCase().replace(/\s+/g, '-'),
        name: category,
        category,
        description: generatePersonaDescription(category),
        icon: getPersonaIcon(category),
        facts: catFacts,
        completionScore: calculateCompletionScore(category, catFacts),
      });
    }
  }

  return personas;
}
