/**
 * Converts QuickStart questionnaire answers into Persona objects.
 * Extracted from App.tsx for testability.
 */

import type { Persona, PersonaCategory } from './types';

export interface QuickStartAnswers {
  shopping: Record<string, string>;
  travel: Record<string, string>;
  food: Record<string, string>;
  fitness: Record<string, string>;
  gifts: Record<string, string>;
}

interface PersonaMeta {
  name: string;
  icon: string;
  description: string;
  category: PersonaCategory;
}

interface QuestionMeta {
  id: string;
  factKey: string;
  sensitivity: 'low' | 'medium' | 'high';
}

const personaMap: Record<string, PersonaMeta> = {
  shopping: {
    name: 'Shopping',
    icon: 'ShoppingBag',
    description: 'Your clothing preferences, sizes, and shopping habits',
    category: 'Shopping',
  },
  travel: {
    name: 'Travel',
    icon: 'Plane',
    description: 'Hotel preferences, seating choices, and travel patterns',
    category: 'Travel',
  },
  food: {
    name: 'Food & Dining',
    icon: 'UtensilsCrossed',
    description: 'Dietary restrictions, cuisine preferences, and dining habits',
    category: 'Food & Dining',
  },
  fitness: {
    name: 'Fitness',
    icon: 'Activity',
    description: 'Exercise routines, equipment choices, and fitness goals',
    category: 'Fitness',
  },
  gifts: {
    name: 'Gift Giving',
    icon: 'Gift',
    description: 'Gift preferences for family and friends',
    category: 'Gift Giving',
  },
};

const catQuestions: Record<string, QuestionMeta[]> = {
  shopping: [
    { id: 's1', factKey: 'apparel.style', sensitivity: 'low' },
    { id: 's2', factKey: 'apparel.pants.waist', sensitivity: 'low' },
    { id: 's3', factKey: 'apparel.pants.inseam', sensitivity: 'low' },
    { id: 's4', factKey: 'apparel.shirt.size', sensitivity: 'low' },
    { id: 's5', factKey: 'apparel.shoe.size', sensitivity: 'low' },
    { id: 's6', factKey: 'apparel.preferred_brands', sensitivity: 'low' },
    { id: 's7', factKey: 'budget.monthly_clothing', sensitivity: 'medium' },
  ],
  travel: [
    { id: 't1', factKey: 'flight.seat_preference', sensitivity: 'low' },
    { id: 't2', factKey: 'hotel.room_preference', sensitivity: 'low' },
    { id: 't3', factKey: 'travel.favorite_destinations', sensitivity: 'low' },
    { id: 't4', factKey: 'travel.loyalty_programs', sensitivity: 'medium' },
    { id: 't5', factKey: 'budget.per_trip', sensitivity: 'medium' },
  ],
  food: [
    { id: 'f1', factKey: 'dietary.restrictions', sensitivity: 'medium' },
    { id: 'f2', factKey: 'food.favorite_cuisines', sensitivity: 'low' },
    { id: 'f3', factKey: 'food.spice_level', sensitivity: 'low' },
    { id: 'f4', factKey: 'budget.per_meal', sensitivity: 'low' },
  ],
  fitness: [
    { id: 'x1', factKey: 'fitness.primary_activity', sensitivity: 'low' },
    { id: 'x2', factKey: 'fitness.frequency', sensitivity: 'low' },
    { id: 'x3', factKey: 'fitness.goal', sensitivity: 'low' },
  ],
  gifts: [
    { id: 'g1', factKey: 'budget.gift_range', sensitivity: 'low' },
    { id: 'g2', factKey: 'gifts.style', sensitivity: 'low' },
    { id: 'g3', factKey: 'gifts.primary_recipients', sensitivity: 'low' },
  ],
};

/**
 * Converts QuickStart answers into an array of Personas with facts.
 * Skips categories with no answers. Whitespace-only answers are ignored.
 */
export function convertQuickStartToPersonas(
  answers: QuickStartAnswers,
  now: number = Date.now(),
): Persona[] {
  const personas: Persona[] = [];

  for (const [catId, catAnswers] of Object.entries(answers)) {
    const meta = personaMap[catId];
    if (!meta) continue;

    const questions = catQuestions[catId] ?? [];
    const facts = questions
      .filter((q) => catAnswers[q.id]?.trim())
      .map((q) => ({
        key: q.factKey,
        value: catAnswers[q.id].trim(),
        sensitivity: q.sensitivity,
        confidence: 1.0,
        source: 'quickstart' as const,
        extractedAt: now,
      }));

    if (facts.length === 0) continue;

    personas.push({
      id: catId === 'food' ? 'food-dining' : catId === 'gifts' ? 'gift-giving' : catId,
      name: meta.name,
      icon: meta.icon,
      description: meta.description,
      category: meta.category,
      completionScore: Math.min(1, facts.length / questions.length),
      facts,
    });
  }

  return personas;
}
