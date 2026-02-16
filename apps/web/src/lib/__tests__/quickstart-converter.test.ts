import { describe, it, expect } from 'vitest';
import {
  convertQuickStartToPersonas,
  type QuickStartAnswers,
} from '../quickstart-converter';

const NOW = 1700000000000;

function emptyAnswers(): QuickStartAnswers {
  return { shopping: {}, travel: {}, food: {}, fitness: {}, gifts: {} };
}

describe('convertQuickStartToPersonas', () => {
  it('returns empty array for empty answers', () => {
    expect(convertQuickStartToPersonas(emptyAnswers(), NOW)).toHaveLength(0);
  });

  it('creates a shopping persona from answers', () => {
    const answers = emptyAnswers();
    answers.shopping = {
      s1: 'Casual',
      s2: '32',
      s4: 'L',
    };
    const result = convertQuickStartToPersonas(answers, NOW);
    expect(result).toHaveLength(1);
    const p = result[0];
    expect(p.id).toBe('shopping');
    expect(p.name).toBe('Shopping');
    expect(p.category).toBe('Shopping');
    expect(p.facts).toHaveLength(3);
    expect(p.facts[0]).toEqual({
      key: 'apparel.style',
      value: 'Casual',
      sensitivity: 'low',
      confidence: 1.0,
      source: 'quickstart',
      extractedAt: NOW,
    });
  });

  it('maps food category to food-dining id', () => {
    const answers = emptyAnswers();
    answers.food = { f2: 'Italian, Japanese' };
    const result = convertQuickStartToPersonas(answers, NOW);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('food-dining');
    expect(result[0].category).toBe('Food & Dining');
  });

  it('maps gifts category to gift-giving id', () => {
    const answers = emptyAnswers();
    answers.gifts = { g1: 'Under $25' };
    const result = convertQuickStartToPersonas(answers, NOW);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('gift-giving');
    expect(result[0].category).toBe('Gift Giving');
  });

  it('uses travel as-is for id', () => {
    const answers = emptyAnswers();
    answers.travel = { t1: 'Window' };
    const result = convertQuickStartToPersonas(answers, NOW);
    expect(result[0].id).toBe('travel');
  });

  it('skips categories with no answers', () => {
    const answers = emptyAnswers();
    answers.shopping = { s1: 'Minimalist' };
    // travel, food, fitness, gifts all empty
    const result = convertQuickStartToPersonas(answers, NOW);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('shopping');
  });

  it('ignores whitespace-only answers', () => {
    const answers = emptyAnswers();
    answers.shopping = { s1: '  ', s2: '' };
    const result = convertQuickStartToPersonas(answers, NOW);
    // Both answers are whitespace → no facts → no persona
    expect(result).toHaveLength(0);
  });

  it('trims answer values', () => {
    const answers = emptyAnswers();
    answers.fitness = { x1: '  Running  ' };
    const result = convertQuickStartToPersonas(answers, NOW);
    expect(result[0].facts[0].value).toBe('Running');
  });

  it('produces multiple personas from multi-category answers', () => {
    const answers: QuickStartAnswers = {
      shopping: { s1: 'Streetwear', s5: '10' },
      travel: { t1: 'Aisle', t3: 'Japan' },
      food: { f1: 'Vegetarian', f3: 'Hot' },
      fitness: { x1: 'Cycling' },
      gifts: { g2: 'Practical' },
    };
    const result = convertQuickStartToPersonas(answers, NOW);
    expect(result).toHaveLength(5);
    expect(result.map((p) => p.id)).toEqual([
      'shopping',
      'travel',
      'food-dining',
      'fitness',
      'gift-giving',
    ]);
  });

  it('calculates completionScore correctly', () => {
    const answers = emptyAnswers();
    // Shopping has 7 questions, answer 3
    answers.shopping = { s1: 'Casual', s2: '32', s4: 'L' };
    const result = convertQuickStartToPersonas(answers, NOW);
    expect(result[0].completionScore).toBeCloseTo(3 / 7, 2);
  });

  it('caps completionScore at 1.0', () => {
    // Fitness has 3 questions — answer all 3
    const answers = emptyAnswers();
    answers.fitness = { x1: 'Running', x2: 'Daily', x3: 'Stay healthy' };
    const result = convertQuickStartToPersonas(answers, NOW);
    expect(result[0].completionScore).toBe(1);
  });

  it('assigns correct sensitivity levels', () => {
    const answers = emptyAnswers();
    answers.shopping = { s1: 'Casual', s7: '$250-500' };
    const result = convertQuickStartToPersonas(answers, NOW);
    const facts = result[0].facts;
    expect(facts[0].sensitivity).toBe('low'); // s1: apparel.style
    expect(facts[1].sensitivity).toBe('medium'); // s7: budget.monthly_clothing
  });

  it('maps all question IDs to correct fact keys', () => {
    // Answer every question in travel
    const answers = emptyAnswers();
    answers.travel = {
      t1: 'Window',
      t2: 'High floor',
      t3: 'Iceland',
      t4: 'United MileagePlus',
      t5: 'Premium ($3k-5k)',
    };
    const result = convertQuickStartToPersonas(answers, NOW);
    const keys = result[0].facts.map((f) => f.key);
    expect(keys).toEqual([
      'flight.seat_preference',
      'hotel.room_preference',
      'travel.favorite_destinations',
      'travel.loyalty_programs',
      'budget.per_trip',
    ]);
  });

  it('sets all confidence to 1.0 and source to quickstart', () => {
    const answers = emptyAnswers();
    answers.gifts = { g1: '$50-100', g2: 'Experience-based', g3: 'Partner' };
    const result = convertQuickStartToPersonas(answers, NOW);
    for (const fact of result[0].facts) {
      expect(fact.confidence).toBe(1.0);
      expect(fact.source).toBe('quickstart');
      expect(fact.extractedAt).toBe(NOW);
    }
  });

  it('ignores unknown question IDs', () => {
    const answers = emptyAnswers();
    answers.shopping = { s1: 'Casual', s99: 'unknown', bogus: 'nope' };
    const result = convertQuickStartToPersonas(answers, NOW);
    // Only s1 should produce a fact (s99 and bogus are not in catQuestions)
    expect(result[0].facts).toHaveLength(1);
  });

  it('preserves order of facts matching question order', () => {
    const answers = emptyAnswers();
    // Deliberately answer in reverse order
    answers.food = { f4: '$30-50', f1: 'Vegan' };
    const result = convertQuickStartToPersonas(answers, NOW);
    // Facts should follow catQuestions order (f1 first, f4 second)
    expect(result[0].facts[0].key).toBe('dietary.restrictions');
    expect(result[0].facts[1].key).toBe('budget.per_meal');
  });

  it('uses Date.now() as default timestamp', () => {
    const answers = emptyAnswers();
    answers.fitness = { x1: 'Yoga' };
    const before = Date.now();
    const result = convertQuickStartToPersonas(answers);
    const after = Date.now();
    expect(result[0].facts[0].extractedAt).toBeGreaterThanOrEqual(before);
    expect(result[0].facts[0].extractedAt).toBeLessThanOrEqual(after);
  });
});
