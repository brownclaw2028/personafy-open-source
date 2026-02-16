// ============================================================================
// Base Extractor — shared abstract class for all 5 platform extractors
// ============================================================================

export const EXTRACTOR_VERSION = '1.0.0';

import type { Fact } from './types';
import { normalizeFactKey } from './factKeys';
import { BRANDS_PATTERNS, BUDGET_PATTERNS, LOCATION_PATTERNS } from './extraction-patterns';

export interface PatternDef {
  id: string;
  category: string;
  key: string;
  regex: RegExp;
  confidence: number;
  sensitivity: 'low' | 'medium' | 'high';
}

export interface ExtractionMatch {
  start: number;
  end: number;
  factKey: string;
  value: string;
  category: string;
  confidence: number;
  patternId: string;
  negated: boolean;
}

export interface ExtractedFact {
  key: string;
  value: string;
  confidence: number;
  sensitivity: 'low' | 'medium' | 'high';
  source: string;
  extractedAt: number;
  negated?: boolean;
  extractionCount?: number;
  metadata?: {
    sourceType: 'chatgpt' | 'gmail' | 'amazon' | 'claude' | 'notion' | 'gemini' | 'calendar';
    sourceId: string;
    extractedAt: string;
    patternId: string;
  };
}

// Negation words to check within 5 words of a pattern match
const NEGATION_WORDS = ["don't", "dont", "not", "never", "hate", "dislike", "avoid", "no longer", "stopped", "quit"];

export abstract class BaseExtractor {
  protected patterns: PatternDef[] = [];
  protected facts: Map<string, ExtractedFact> = new Map();
  protected extractedFacts: Fact[] = [];
  protected sourceType: 'chatgpt' | 'gmail' | 'amazon' | 'claude' | 'notion' | 'gemini' | 'calendar';

  constructor(sourceType: 'chatgpt' | 'gmail' | 'amazon' | 'claude' | 'notion' | 'gemini' | 'calendar') {
    this.sourceType = sourceType;
    this.initPatterns();
  }

  protected abstract initPatterns(): void;

  protected addPattern(id: string, category: string, key: string, regex: RegExp, confidence: number, sensitivity: 'low' | 'medium' | 'high'): void {
    this.patterns.push({ id, category, key, regex, confidence, sensitivity });
  }

  // Run all patterns against text and return matches
  extractFromText(text: string, sourceId: string, sourceName: string): ExtractionMatch[] {
    const matches: ExtractionMatch[] = [];
    for (const pattern of this.patterns) {
      const regex = new RegExp(pattern.regex, pattern.regex.flags.includes('g') ? pattern.regex.flags : pattern.regex.flags + 'g');
      let match: RegExpExecArray | null;
      while ((match = regex.exec(text)) !== null) {
        const value = match[1] || match[0];
        const negated = this.detectNegation(text, match.index);
        const factKey = negated ? `not_${pattern.key}` : pattern.key;

        matches.push({
          start: match.index,
          end: match.index + match[0].length,
          factKey,
          value: value.trim(),
          category: pattern.category,
          confidence: pattern.confidence,
          patternId: pattern.id,
          negated,
        });

        this.addFact(factKey, value.trim(), pattern.confidence, pattern.sensitivity, sourceName, sourceId, pattern.id, negated);
      }
    }
    return matches;
  }

  // Detect negation within ~5 words before the match
  detectNegation(text: string, matchIndex: number): boolean {
    const windowStart = Math.max(0, matchIndex - 50);
    const prefix = text.slice(windowStart, matchIndex).toLowerCase();
    return NEGATION_WORDS.some(word => prefix.includes(word));
  }

  // Add/merge a fact with confidence fusion
  protected addFact(key: string, value: string, confidence: number, sensitivity: 'low' | 'medium' | 'high', source: string, sourceId: string, patternId: string, negated = false): void {
    const normalizedValue = this.normalizeValue(value, key);
    if (!normalizedValue) return;

    const existing = this.facts.get(key);
    if (existing) {
      if (existing.value.toLowerCase() === normalizedValue.toLowerCase()) {
        // Same value: merge confidence
        existing.confidence = Math.min(1, existing.confidence * 0.6 + confidence * 0.5);
        existing.extractionCount = (existing.extractionCount || 1) + 1;
      } else if (confidence > existing.confidence) {
        // Different value with higher confidence: replace
        this.facts.set(key, {
          key, value: normalizedValue, confidence, sensitivity, source,
          extractedAt: Date.now(), negated,
          extractionCount: 1,
          metadata: { sourceType: this.sourceType, sourceId, extractedAt: new Date().toISOString(), patternId },
        });
      }
      // else: keep existing (higher confidence)
    } else {
      this.facts.set(key, {
        key, value: normalizedValue, confidence, sensitivity, source,
        extractedAt: Date.now(), negated,
        extractionCount: 1,
        metadata: { sourceType: this.sourceType, sourceId, extractedAt: new Date().toISOString(), patternId },
      });
    }
  }

  // Override in subclasses for category-specific normalization
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected normalizeValue(value: string, _key: string): string {
    return value.trim().replace(/\s+/g, ' ');
  }

  // Merge confidence when same fact seen from multiple sources
  mergeConfidence(existing: number, incoming: number): number {
    return Math.min(1, existing * 0.6 + incoming * 0.5);
  }

  // Get all extracted facts as an array
  getAllFacts(): ExtractedFact[] {
    return Array.from(this.facts.values())
      .filter(f => f.value.length > 0)
      .sort((a, b) => b.confidence - a.confidence);
  }

  // Get facts grouped by category (from patterns)
  getFactsByCategory(): Record<string, ExtractedFact[]> {
    const result: Record<string, ExtractedFact[]> = {};
    for (const fact of this.getAllFacts()) {
      // Find category from pattern registry
      const pattern = this.patterns.find(p => p.key === fact.key || p.key === fact.key.replace('not_', ''));
      const category = pattern?.category || 'Other';
      if (!result[category]) result[category] = [];
      result[category].push(fact);
    }
    return result;
  }

  // Get all registered patterns
  getPatterns(): PatternDef[] {
    return [...this.patterns];
  }

  // Clear state for re-processing
  reset(): void {
    this.facts.clear();
    this.extractedFacts = [];
  }

  /**
   * Add a fact to the extractedFacts array with deduplication.
   * If a fact with the same normalized key+value already exists, its confidence
   * is incremented by 0.1 (capped at 0.95). Otherwise a new Fact is pushed.
   */
  protected addSourceFact(
    key: string,
    value: string,
    confidence: number,
    sensitivity: 'low' | 'medium' | 'high',
    source?: string,
    sourceId = '',
    patternId = `${this.sourceType}-${key}`,
  ): void {
    const resolvedSource = source ?? this.sourceType;
    const normalizedKey = normalizeFactKey(key);
    const existing = this.extractedFacts.find(
      f => f.key === normalizedKey && f.value.toLowerCase() === value.toLowerCase(),
    );

    if (existing) {
      existing.confidence = Math.min(0.95, existing.confidence + 0.1);
      return;
    }

    this.extractedFacts.push({
      key: normalizedKey,
      value: value.trim(),
      confidence,
      sensitivity,
      source: resolvedSource,
      extractedAt: Date.now(),
      metadata: {
        sourceType: this.sourceType,
        sourceId,
        extractedAt: new Date().toISOString(),
        patternId,
      },
    });
  }

  /**
   * Filter empty values and sort facts by confidence descending.
   */
  protected organizeExtractedFacts(): void {
    this.extractedFacts = this.extractedFacts
      .filter(fact => fact.value.length > 0)
      .sort((a, b) => b.confidence - a.confidence);
  }

  // ==========================================================================
  // Shared category extraction methods (union of ChatGPT + Claude + Notion)
  // ==========================================================================

  protected extractClothingFactsCommon(
    content: string,
    source: string,
    config?: {
      extraSizes?: string[];
      includeBudget?: boolean;
      includeBrandLoyalty?: boolean;
      includePriceSensitivity?: boolean;
      includeSeasonalPatterns?: boolean;
      includeReturnFrequency?: boolean;
    },
  ): void {
    const lc = content.toLowerCase();

    // -- Sizes --
    const waistMatch = lc.match(/(\d+)\s*waist/);
    if (waistMatch) {
      this.addSourceFact('apparel.pants.waist', waistMatch[1], 0.9, 'medium', source);
    }

    const inseamMatch = lc.match(/(\d+)\s*inseam/);
    if (inseamMatch) {
      this.addSourceFact('apparel.pants.inseam', inseamMatch[1], 0.9, 'medium', source);
    }

    // Claude/Notion: xs, xxl, top, tee  |  ChatGPT: small/medium/large/xl, shirt/size
    const shirtSizeMatch = lc.match(/\b(xs|small|medium|large|xl|xxl)\s*(shirt|top|tee|size)/);
    if (shirtSizeMatch) {
      this.addSourceFact('apparel.shirt.size', shirtSizeMatch[1], 0.8, 'medium', source);
    }

    // Capture shoe sizes only when nearby shoe context exists and value looks plausible.
    const shoeSizePattern = /\bsize(?:\s+is)?\s*(\d+(?:\.\d+)?)\b/g;
    let shoeSizeMatch: RegExpExecArray | null;
    while ((shoeSizeMatch = shoeSizePattern.exec(lc)) !== null) {
      const matchIndex = shoeSizeMatch.index ?? 0;
      const contextStart = Math.max(0, matchIndex - 24);
      const contextEnd = Math.min(lc.length, matchIndex + shoeSizeMatch[0].length + 24);
      const context = lc.slice(contextStart, contextEnd);
      const hasShoeContext = /\b(shoe|shoes|sneaker|sneakers|boot|boots|cleat|loafer|heel|sandal)\b/.test(context);
      const hasPantsContext = /\b(waist|inseam|pants|jeans|shorts|trouser)\b/.test(context);
      const sizeValue = Number.parseFloat(shoeSizeMatch[1]);

      if (!hasShoeContext || hasPantsContext) continue;
      if (!Number.isFinite(sizeValue) || sizeValue < 3 || sizeValue > 18) continue;
      this.addSourceFact('apparel.shoe.size', shoeSizeMatch[1], 0.8, 'medium', source);
    }

    // -- Fit preferences --
    if (lc.includes('slim fit')) {
      this.addSourceFact('apparel.fit_preference', 'slim fit', 0.9, 'low', source);
    }
    // Claude-only: relaxed fit
    if (lc.includes('relaxed fit')) {
      this.addSourceFact('apparel.fit_preference', 'relaxed fit', 0.9, 'low', source);
    }

    // -- Material dislikes/likes --
    if (lc.match(/hate.{0,20}polyester|no polyester|avoid polyester/)) {
      this.addSourceFact('apparel.material_dislikes', 'polyester', 0.9, 'low', source);
    }
    if (lc.match(/love.{0,20}merino|prefer.{0,20}merino|merino wool/)) {
      this.addSourceFact('apparel.material_likes', 'merino wool', 0.9, 'low', source);
    }
    // Claude-only: cotton
    if (lc.match(/prefer.{0,20}cotton|love.{0,20}cotton|100% cotton/)) {
      this.addSourceFact('apparel.material_likes', 'cotton', 0.8, 'low', source);
    }

    // -- Brands --
    const brandMatches = content.match(BRANDS_PATTERNS.clothing);
    if (brandMatches) {
      brandMatches.forEach(brand => {
        this.addSourceFact('apparel.preferred_brands', brand.toLowerCase().trim(), 0.7, 'low', source);
      });
    }

    // -- Budget (ChatGPT/Claude) --
    if (config?.includeBudget !== false) {
      const budgetMatch = content.match(BUDGET_PATTERNS);
      if (budgetMatch && lc.includes('budget')) {
        this.addSourceFact('budget.monthly_clothing', budgetMatch[0], 0.8, 'medium', source);
      }
    }

    // -- ChatGPT-specific extras --
    if (config?.includeBrandLoyalty) {
      if (lc.match(/loyal.{0,20}(brand|store)|always.{0,15}(buy|shop).{0,15}(at|from)/)) {
        const loyaltyMatch = lc.match(/loyal.{0,20}([\w\s]+)|always.{0,15}(?:buy|shop).{0,15}(?:at|from)\s+([\w\s]+)/);
        if (loyaltyMatch) {
          this.addSourceFact('shopping.brand_loyalty', (loyaltyMatch[1] || loyaltyMatch[2]).trim(), 0.75, 'low', source);
        }
      }
    }

    if (config?.includePriceSensitivity) {
      if (lc.match(/budget.{0,10}(friendly|conscious|shopper)/)) {
        this.addSourceFact('shopping.price_sensitivity', 'budget', 0.8, 'low', source);
      } else if (lc.match(/mid.?range|moderate.{0,10}price/)) {
        this.addSourceFact('shopping.price_sensitivity', 'mid-range', 0.8, 'low', source);
      } else if (lc.match(/premium|high.?end|luxury/)) {
        this.addSourceFact('shopping.price_sensitivity', 'premium', 0.8, 'low', source);
      }
    }

    if (config?.includeSeasonalPatterns) {
      if (lc.match(/holiday.{0,15}shop|black friday|cyber monday/)) {
        this.addSourceFact('shopping.seasonal_patterns', 'holiday shopping', 0.7, 'low', source);
      }
      if (lc.match(/back.?to.?school/)) {
        this.addSourceFact('shopping.seasonal_patterns', 'back-to-school', 0.7, 'low', source);
      }
    }

    if (config?.includeReturnFrequency) {
      if (lc.match(/return.{0,15}(a lot|often|frequently)/)) {
        this.addSourceFact('shopping.return_frequency', 'often', 0.7, 'low', source);
      } else if (lc.match(/rarely.{0,10}return|never.{0,10}return/)) {
        this.addSourceFact('shopping.return_frequency', 'rarely', 0.7, 'low', source);
      }
    }
  }

  protected extractTravelFactsCommon(
    content: string,
    source: string,
    config?: {
      includeHotelChains?: boolean;
      includeTravelStyle?: boolean;
      includeTripFrequency?: boolean;
    },
  ): void {
    const lc = content.toLowerCase();

    // Travel frequency
    if (lc.match(/travel.{0,20}(\d+).{0,10}times.{0,10}year/)) {
      const freqMatch = lc.match(/(\d+).{0,10}times.{0,10}year/);
      if (freqMatch) {
        this.addSourceFact('travel.frequency', `${freqMatch[1]} times per year`, 0.8, 'low', source);
      }
    }

    // Hotel preferences
    if (lc.includes('boutique hotel')) {
      this.addSourceFact('hotel.room_preference', 'boutique hotels', 0.9, 'low', source);
    }
    if (lc.match(/avoid.{0,20}chain|prefer.{0,20}boutique|not.{0,20}chain/)) {
      this.addSourceFact('hotel.room_dislikes', 'chain hotels', 0.8, 'low', source);
    }

    // Seat preferences
    if (lc.includes('window seat')) {
      this.addSourceFact('flight.seat_preference', 'window seat', 0.9, 'low', source);
    }
    // Claude/Notion: aisle seat
    if (lc.includes('aisle seat')) {
      this.addSourceFact('flight.seat_preference', 'aisle seat', 0.9, 'low', source);
    }

    // TSA PreCheck
    if (lc.includes('tsa precheck') || lc.includes('precheck')) {
      this.addSourceFact('travel.loyalty_programs', 'TSA PreCheck', 0.9, 'medium', source);
    }

    // Claude/Notion: carry-on only
    if (lc.includes('carry-on only') || lc.includes('carry on only')) {
      this.addSourceFact('travel.packing_style', 'carry-on only', 0.8, 'low', source);
    }

    // Destinations
    const locationMatches = content.match(LOCATION_PATTERNS);
    if (locationMatches) {
      locationMatches.forEach(location => {
        this.addSourceFact('travel.favorite_destinations', location.toLowerCase(), 0.6, 'low', source);
      });
    }

    // -- ChatGPT-specific extras --
    if (config?.includeHotelChains) {
      const hotelChains = ['marriott', 'hilton', 'hyatt', 'ihg', 'best western', 'wyndham', 'four seasons', 'ritz'];
      hotelChains.forEach(chain => {
        if (lc.includes(chain)) {
          this.addSourceFact('travel.hotel_chain', chain, 0.8, 'low', source);
        }
      });
    }

    if (config?.includeTravelStyle) {
      if (lc.match(/budget.{0,10}travel|backpack|hostel/)) {
        this.addSourceFact('travel.travel_style', 'budget', 0.8, 'low', source);
      } else if (lc.match(/luxury.{0,10}travel|five.?star|first.?class/)) {
        this.addSourceFact('travel.travel_style', 'luxury', 0.8, 'low', source);
      }
    }

    if (config?.includeTripFrequency) {
      const tripFreqMatch = lc.match(/(\d+)\s*trips?\s*(?:a|per)\s*year/);
      if (tripFreqMatch) {
        this.addSourceFact('travel.trip_frequency', `${tripFreqMatch[1]} per year`, 0.85, 'low', source);
      }
    }
  }

  protected extractFoodFactsCommon(
    content: string,
    source: string,
    config?: {
      includeCookingFrequency?: boolean;
      includeMealPrep?: boolean;
      includeRestaurantBudget?: boolean;
      includeCuisineExploration?: boolean;
    },
  ): void {
    const lc = content.toLowerCase();

    // Dietary restrictions
    if (lc.includes('pescatarian')) {
      this.addSourceFact('dietary.restrictions', 'pescatarian', 0.9, 'medium', source);
    }
    // Claude/Notion: vegetarian, vegan, gluten-free
    if (lc.includes('vegetarian') && !lc.includes('pescatarian')) {
      this.addSourceFact('dietary.restrictions', 'vegetarian', 0.9, 'medium', source);
    }
    if (lc.includes('vegan')) {
      this.addSourceFact('dietary.restrictions', 'vegan', 0.9, 'medium', source);
    }
    if (lc.includes('gluten-free') || lc.includes('gluten free')) {
      this.addSourceFact('dietary.restrictions', 'gluten-free', 0.9, 'medium', source);
    }

    // Allergies
    if (lc.match(/allergic.{0,20}shellfish|shellfish.{0,20}allergy/)) {
      this.addSourceFact('dietary.allergies', 'shellfish', 0.9, 'high', source);
    }
    // Claude: nut allergy
    if (lc.match(/allergic.{0,20}nuts?|nut.{0,10}allergy/)) {
      this.addSourceFact('dietary.allergies', 'tree nuts', 0.9, 'high', source);
    }

    // Cuisines — union of ChatGPT + Claude + Notion
    const cuisines = ['sushi', 'thai', 'mediterranean', 'italian', 'chinese', 'japanese', 'korean', 'mexican', 'indian', 'french', 'vietnamese', 'ramen'];
    cuisines.forEach(cuisine => {
      if (lc.includes(cuisine)) {
        this.addSourceFact('food.favorite_cuisines', cuisine, 0.7, 'low', source);
      }
    });

    // Coffee — union: snob, pour-over, pour over, light roast, single.origin
    if (lc.match(/coffee.{0,20}snob|pour.over|pour over|light roast|single.origin/)) {
      this.addSourceFact('food.coffee_preferences', 'coffee enthusiast, pour-over, light roast', 0.8, 'low', source);
    }

    // Claude/Notion: batch cooking / meal prep (food.cooking_style)
    if (lc.match(/batch.{0,10}cook|meal.{0,10}prep|prep.{0,10}sunday/)) {
      this.addSourceFact('food.cooking_style', 'batch cooking / meal prep', 0.8, 'low', source);
    }

    // -- ChatGPT-specific extras --
    if (config?.includeCookingFrequency) {
      if (lc.match(/cook.{0,10}(every|daily|each)\s*(day|night)/)) {
        this.addSourceFact('food.cooking_frequency', 'daily', 0.8, 'low', source);
      } else if (lc.match(/cook.{0,15}(few|couple|several).{0,10}times.{0,10}week/)) {
        this.addSourceFact('food.cooking_frequency', 'few times a week', 0.8, 'low', source);
      } else if (lc.match(/rarely.{0,10}cook|don't.{0,10}cook|hate.{0,10}cook/)) {
        this.addSourceFact('food.cooking_frequency', 'rarely', 0.8, 'low', source);
      }
    }

    if (config?.includeMealPrep) {
      if (lc.match(/meal.{0,5}prep|batch.{0,5}cook|prep.{0,10}sunday/)) {
        this.addSourceFact('food.meal_prep', 'yes', 0.8, 'low', source);
      }
    }

    if (config?.includeRestaurantBudget) {
      const restaurantBudget = content.match(/\$(\d+).{0,15}(per|a)\s*meal/i);
      if (restaurantBudget) {
        this.addSourceFact('food.restaurant_budget', `$${restaurantBudget[1]} per meal`, 0.75, 'medium', source);
      }
    }

    if (config?.includeCuisineExploration) {
      if (lc.match(/adventurous.{0,10}eat|try.{0,10}new.{0,10}food|love.{0,10}explor/)) {
        this.addSourceFact('food.cuisine_exploration', 'adventurous', 0.75, 'low', source);
      } else if (lc.match(/picky.{0,10}eat|stick.{0,10}to.{0,10}what/)) {
        this.addSourceFact('food.cuisine_exploration', 'conservative', 0.75, 'low', source);
      }
    }
  }

  protected extractWorkFactsCommon(content: string, source: string): void {
    const lc = content.toLowerCase();

    // Tools — union of ChatGPT + Claude + Notion
    const workTools = ['notion', 'figma', 'linear', 'slack', 'jira', 'github', 'vscode', 'typescript', 'react', 'tailwind', 'arc browser', 'obsidian'];
    workTools.forEach(tool => {
      if (lc.includes(tool)) {
        this.addSourceFact('work.tools', tool, 0.8, 'low', source);
      }
    });

    // Communication preferences
    if (lc.match(/prefer.{0,20}async|async.{0,20}communication/)) {
      this.addSourceFact('work.communication_style', 'prefers asynchronous communication', 0.8, 'low', source);
    }
    if (lc.match(/concise|direct.{0,20}tone|brief/)) {
      this.addSourceFact('work.communication_style', 'concise and direct', 0.7, 'low', source);
    }

    // Tech brands (Claude/Notion)
    const techBrands = content.match(BRANDS_PATTERNS.tech);
    if (techBrands) {
      techBrands.forEach(brand => {
        this.addSourceFact('work.tools', brand.toLowerCase().trim(), 0.7, 'low', source);
      });
    }
  }

  protected extractFitnessFactsCommon(
    content: string,
    source: string,
    config?: {
      includeWorkoutFrequency?: boolean;
      includeEquipment?: boolean;
      includeCompetition?: boolean;
    },
  ): void {
    const lc = content.toLowerCase();

    // Running frequency
    const runningFreq = lc.match(/run.{0,20}(\d+).{0,10}(x|times).{0,10}week/);
    if (runningFreq) {
      this.addSourceFact('fitness.frequency', `runs ${runningFreq[1]}x per week`, 0.9, 'low', source);
    }

    // Training goals — union: half marathon, 10K, marathon
    if (lc.includes('half marathon')) {
      this.addSourceFact('fitness.goal', 'half marathon training', 0.9, 'low', source);
    }
    if ((lc.includes('10k') || lc.includes('10 k')) && !lc.includes('half marathon')) {
      this.addSourceFact('fitness.goal', '10K race training', 0.9, 'low', source);
    }
    if (lc.includes('marathon') && !lc.includes('half marathon')) {
      this.addSourceFact('fitness.goal', 'marathon training', 0.9, 'low', source);
    }

    // Running shoes — union: pegasus, brooks ghost
    if (lc.includes('nike pegasus')) {
      this.addSourceFact('fitness.running_shoes', 'Nike Pegasus', 0.9, 'low', source);
    }
    if (lc.includes('brooks ghost')) {
      this.addSourceFact('fitness.running_shoes', 'Brooks Ghost', 0.9, 'low', source);
    }

    // Fitness apps — union: strava, garmin
    if (lc.includes('strava')) {
      this.addSourceFact('fitness.apps', 'Strava', 0.9, 'low', source);
    }
    if (lc.includes('garmin')) {
      this.addSourceFact('fitness.apps', 'Garmin', 0.9, 'low', source);
    }

    // -- ChatGPT-specific extras --
    if (config?.includeWorkoutFrequency) {
      const workoutFreqMatch = lc.match(/work\s*out.{0,10}(\d+).{0,10}(x|times).{0,10}(week|per)/);
      if (workoutFreqMatch) {
        this.addSourceFact('fitness.workout_frequency', `${workoutFreqMatch[1]}x per week`, 0.85, 'low', source);
      }
    }

    if (config?.includeEquipment) {
      const equipmentList = ['treadmill', 'peloton', 'rowing machine', 'dumbbells', 'kettlebell', 'resistance bands', 'yoga mat', 'foam roller', 'pull-up bar'];
      equipmentList.forEach(equip => {
        if (lc.includes(equip)) {
          this.addSourceFact('fitness.equipment_owned', equip, 0.8, 'low', source);
        }
      });
    }

    if (config?.includeCompetition) {
      if (lc.match(/race|marathon|triathlon|tournament|5k|10k|spartan|ironman/)) {
        const compMatch = lc.match(/(half marathon|marathon|triathlon|5k|10k|spartan|ironman)/);
        if (compMatch) {
          this.addSourceFact('fitness.competition', compMatch[1], 0.85, 'low', source);
        }
      }
    }
  }

  protected extractGiftFactsCommon(
    content: string,
    source: string,
    config?: {
      includeBudgetPerOccasion?: boolean;
      includeGiftStyle?: boolean;
    },
  ): void {
    const lc = content.toLowerCase();

    // Partner preferences
    if (lc.match(/partner.{0,50}(candle|cooking|ceramic)/)) {
      this.addSourceFact('gifts.partner_interests', 'candles, cooking, ceramics', 0.8, 'high', source);
    }

    // Mom preferences
    if (lc.match(/mom.{0,50}(garden|mystery|novel)/)) {
      this.addSourceFact('gifts.mom_interests', 'gardening, mystery novels', 0.8, 'high', source);
    }

    // Dad preferences (Claude/Notion)
    if (lc.match(/dad.{0,50}(tech|gadget|golf|grill)/)) {
      this.addSourceFact('gifts.dad_interests', 'tech gadgets, grilling', 0.8, 'high', source);
    }

    // Gift budget — union: anniversary, gift, birthday, holiday
    const giftBudget = content.match(/budget.{0,20}\$(\d+)/);
    if (giftBudget && (lc.includes('anniversary') || lc.includes('gift') || lc.includes('birthday') || lc.includes('holiday'))) {
      this.addSourceFact('budget.gift_range', `$${giftBudget[1]}`, 0.7, 'medium', source);
    }

    // -- ChatGPT-specific extras --
    if (config?.includeBudgetPerOccasion) {
      const occasionBudget = content.match(/\$(\d+).{0,20}(birthday|christmas|anniversary|valentine|mother|father)/i);
      if (occasionBudget) {
        this.addSourceFact('gifts.budget_per_occasion', `$${occasionBudget[1]} for ${occasionBudget[2].toLowerCase()}`, 0.75, 'medium', source);
      }
    }

    if (config?.includeGiftStyle) {
      if (lc.match(/practical.{0,10}gift|useful.{0,10}gift/)) {
        this.addSourceFact('gifts.style', 'practical', 0.75, 'low', source);
      } else if (lc.match(/sentimental.{0,10}gift|thoughtful.{0,10}gift|meaningful/)) {
        this.addSourceFact('gifts.style', 'sentimental', 0.75, 'low', source);
      } else if (lc.match(/experience.{0,10}gift|experiential/)) {
        this.addSourceFact('gifts.style', 'experiential', 0.75, 'low', source);
      }
    }
  }

  protected extractEntertainmentFactsCommon(content: string, source: string): void {
    const lc = content.toLowerCase();

    // Streaming services — union of all extractors
    const streamingServices = ['netflix', 'hulu', 'disney+', 'disney plus', 'hbo max', 'max', 'amazon prime', 'prime video', 'apple tv', 'peacock', 'paramount+', 'paramount plus', 'crunchyroll'];
    streamingServices.forEach(service => {
      if (lc.includes(service)) {
        this.addSourceFact('entertainment.streaming_services', service, 0.8, 'low', source);
      }
    });

    // Music genres — union: includes fan.{0,10} from ChatGPT, r&b, reggae, latin, rap
    const musicGenres = ['rock', 'jazz', 'classical', 'hip hop', 'hip-hop', 'rap', 'country', 'pop', 'r&b', 'electronic', 'edm', 'indie', 'metal', 'folk', 'blues', 'reggae', 'latin'];
    musicGenres.forEach(genre => {
      if (lc.match(new RegExp(`\\b${genre}\\b.{0,15}music|listen.{0,15}${genre}|love.{0,15}${genre}|fan.{0,10}${genre}`, 'i'))) {
        this.addSourceFact('entertainment.music_genres', genre, 0.7, 'low', source);
      }
    });

    // Favorite shows (ChatGPT)
    if (lc.match(/(?:watch|binge|love|favorite).{0,15}(show|series)/)) {
      const showMatch = content.match(/(?:watching|binged?|love|favorite)\s+(?:show|series)?\s*[":]*\s*([A-Z][\w\s']+)/);
      if (showMatch) {
        this.addSourceFact('entertainment.favorite_shows', showMatch[1].trim(), 0.7, 'low', source);
      }
    }

    // Podcast preferences
    if (lc.match(/podcast|listen.{0,10}to.{0,20}(show|episode)/)) {
      this.addSourceFact('entertainment.podcast_preferences', 'podcast listener', 0.7, 'low', source);
    }

    // Gaming platforms
    const gamingPlatforms = ['pc gaming', 'ps5', 'playstation', 'xbox', 'nintendo switch', 'switch', 'steam deck'];
    gamingPlatforms.forEach(platform => {
      if (lc.includes(platform)) {
        this.addSourceFact('entertainment.gaming_platforms', platform, 0.8, 'low', source);
      }
    });

    // Gaming genres — union
    const gamingGenres: Array<[string, string]> = [
      ['rpg', 'rpg'], ['fps', 'fps'], ['strategy', 'strategy'],
      ['mmorpg', 'mmorpg'], ['roguelike', 'roguelike'], ['puzzle', 'puzzle games'],
      ['racing', 'racing games'], ['simulation', 'simulation'],
    ];
    gamingGenres.forEach(([keyword, genre]) => {
      if (lc.match(new RegExp(`\\b${keyword}\\b`, 'i'))) {
        this.addSourceFact('entertainment.gaming_genres', genre, 0.7, 'low', source);
      }
    });
  }

  protected extractHomeFactsCommon(content: string, source: string): void {
    const lc = content.toLowerCase();

    // Furniture style — union of all extractors
    const furnitureStyles: Array<[string, string]> = [
      ['modern', 'modern'], ['contemporary', 'contemporary'], ['mid.?century', 'mid-century'],
      ['traditional', 'traditional'], ['minimalist', 'minimalist'], ['scandinavian', 'scandinavian'],
      ['industrial', 'industrial'], ['farmhouse', 'farmhouse'], ['bohemian', 'bohemian'],
    ];
    furnitureStyles.forEach(([pattern, style]) => {
      if (lc.match(new RegExp(`${pattern}.{0,15}(style|furniture|decor|design)`, 'i'))) {
        this.addSourceFact('home.furniture_style', style, 0.75, 'low', source);
      }
    });

    // Home size
    if (lc.match(/\b(apartment|studio|flat)\b/)) {
      this.addSourceFact('home.size', 'apartment', 0.7, 'low', source);
    } else if (lc.match(/\b(house|home)\b.{0,15}(bed|bath|square|sq)/)) {
      this.addSourceFact('home.size', 'house', 0.7, 'low', source);
    } else if (lc.includes('condo')) {
      this.addSourceFact('home.size', 'condo', 0.7, 'low', source);
    }

    // Pets — union
    const petTypes = ['dog', 'cat', 'fish', 'bird', 'rabbit', 'hamster', 'turtle', 'lizard', 'snake'];
    petTypes.forEach(pet => {
      if (lc.match(new RegExp(`(?:my|our|have a|own a)\\s+${pet}`, 'i'))) {
        this.addSourceFact('home.pets', pet, 0.85, 'low', source);
      }
    });

    // Pet breeds — union
    const breeds = [
      'golden retriever', 'labrador', 'german shepherd', 'french bulldog', 'bulldog',
      'poodle', 'beagle', 'rottweiler', 'husky', 'corgi', 'dachshund',
      'siamese', 'persian', 'maine coon', 'ragdoll', 'bengal', 'british shorthair',
    ];
    breeds.forEach(breed => {
      if (lc.includes(breed)) {
        this.addSourceFact('home.pet_breeds', breed, 0.85, 'low', source);
      }
    });

    // Garden preferences
    if (lc.match(/grow.{0,15}(vegetable|tomato|herb|lettuce|pepper)/)) {
      this.addSourceFact('home.garden_preferences', 'vegetables', 0.75, 'low', source);
    }
    if (lc.match(/grow.{0,15}(flower|rose|tulip|daisy|sunflower)/)) {
      this.addSourceFact('home.garden_preferences', 'flowers', 0.75, 'low', source);
    }
    if (lc.match(/herb.{0,10}garden|grow.{0,10}(basil|mint|cilantro|parsley)/)) {
      this.addSourceFact('home.garden_preferences', 'herbs', 0.75, 'low', source);
    }

    // Smart home devices — union
    const smartDevices: Array<[string, string]> = [
      ['alexa', 'Alexa'], ['google home', 'Google Home'], ['echo', 'Amazon Echo'],
      ['hue', 'Philips Hue'], ['nest', 'Google Nest'], ['ring', 'Ring'],
      ['homekit', 'Apple HomeKit'], ['smart speaker', 'smart speaker'],
    ];
    smartDevices.forEach(([keyword, device]) => {
      if (lc.includes(keyword)) {
        this.addSourceFact('home.smart_devices', device, 0.8, 'low', source);
      }
    });
  }

  protected extractHealthFactsCommon(content: string, source: string): void {
    const lc = content.toLowerCase();

    // Dietary restrictions
    if (lc.includes('vegetarian')) {
      this.addSourceFact('health.dietary_restrictions', 'vegetarian', 0.85, 'medium', source);
    }
    if (lc.includes('vegan')) {
      this.addSourceFact('health.dietary_restrictions', 'vegan', 0.85, 'medium', source);
    }
    if (lc.match(/gluten.?free/)) {
      this.addSourceFact('health.dietary_restrictions', 'gluten-free', 0.85, 'medium', source);
    }
    if (lc.match(/keto/)) {
      this.addSourceFact('health.dietary_restrictions', 'keto', 0.85, 'medium', source);
    }
    // ChatGPT-only: paleo
    if (lc.match(/paleo/)) {
      this.addSourceFact('health.dietary_restrictions', 'paleo', 0.85, 'medium', source);
    }

    // Allergies — union
    const allergyPatterns: Array<[string, string]> = [
      ['peanut', 'peanuts'], ['tree.?nut', 'tree nuts'], ['shellfish', 'shellfish'],
      ['dairy', 'dairy'], ['egg', 'eggs'], ['soy', 'soy'], ['wheat', 'wheat'],
      ['pollen', 'pollen'], ['dust', 'dust mites'], ['pet dander', 'pet dander'],
    ];
    allergyPatterns.forEach(([pattern, allergen]) => {
      if (lc.match(new RegExp(`allerg.{0,10}${pattern}|${pattern}.{0,10}allerg`, 'i'))) {
        this.addSourceFact('health.allergies', allergen, 0.9, 'high', source);
      }
    });

    // Supplements — union
    const supplements = ['vitamin d', 'vitamin c', 'multivitamin', 'omega-3', 'omega 3', 'fish oil', 'protein powder', 'creatine', 'magnesium', 'probiotic', 'collagen', 'melatonin', 'zinc', 'iron'];
    supplements.forEach(supp => {
      if (lc.includes(supp)) {
        this.addSourceFact('health.supplements', supp, 0.8, 'medium', source);
      }
    });

    // Sleep schedule
    if (lc.match(/early.{0,10}(bird|riser|morning)|wake.{0,10}(early|5|6)\s*(am)?/)) {
      this.addSourceFact('health.sleep_schedule', 'early bird', 0.75, 'low', source);
    } else if (lc.match(/night.{0,10}owl|stay.{0,10}up.{0,10}late|late.{0,10}night/)) {
      this.addSourceFact('health.sleep_schedule', 'night owl', 0.75, 'low', source);
    }

    // ChatGPT-only: medical preferences
    if (lc.match(/naturopath|holistic|natural.{0,10}medicine|herbal.{0,10}remed/)) {
      this.addSourceFact('health.medical_preferences', 'naturopathic', 0.7, 'medium', source);
    } else if (lc.match(/traditional.{0,10}medicine|conventional.{0,10}medicine/)) {
      this.addSourceFact('health.medical_preferences', 'traditional', 0.7, 'medium', source);
    }

    // Mental health practices
    if (lc.match(/meditat|mindful/)) {
      this.addSourceFact('health.mental_health', 'meditation', 0.75, 'medium', source);
    }
    if (lc.match(/therap(y|ist)/)) {
      this.addSourceFact('health.mental_health', 'therapy', 0.7, 'high', source);
    }
    if (lc.match(/journal/)) {
      this.addSourceFact('health.mental_health', 'journaling', 0.7, 'low', source);
    }
  }
}
