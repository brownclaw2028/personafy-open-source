import type { Fact, Persona, ProfileSummary, FollowUpQuestion } from './types';
import { BaseExtractor } from './base-extractor';
import { BRANDS_PATTERNS, LOCATION_PATTERNS } from './extraction-patterns';
import { generatePersonas, getFactsForCategory } from './persona-generator';

// ============================================================================
// Notion Export Types
// ============================================================================

export interface NotionPage {
  id: string;
  title: string;
  type: 'page' | 'database' | 'journal' | 'task' | 'note';
  content: string;
  properties?: Record<string, string>;
  created_time?: string;
  last_edited_time?: string;
  tags?: string[];
}


// ============================================================================
// Notion Extractor
// ============================================================================

export class NotionExtractor extends BaseExtractor {
  private pages: NotionPage[] = [];
  private personas: Persona[] = [];

  constructor(pages: NotionPage[]) {
    super('notion');
    this.pages = pages;
    this.processPages();
  }

  protected initPatterns(): void {
    // Shopping patterns
    this.addPattern('notion-waist', 'Shopping', 'apparel.pants.waist', /(\d+)\s*waist/i, 0.9, 'medium');
    this.addPattern('notion-inseam', 'Shopping', 'apparel.pants.inseam', /(\d+)\s*inseam/i, 0.9, 'medium');
    this.addPattern('notion-shirt-size', 'Shopping', 'apparel.shirt.size', /\b(xs|small|medium|large|xl|xxl)\s*(shirt|top|tee|size)/i, 0.8, 'medium');
    this.addPattern('notion-shoe-size', 'Shopping', 'apparel.shoe.size', /size\s*(\d+(?:\.\d+)?)\s*(shoe|sneaker|boot)?/i, 0.8, 'medium');
    this.addPattern('notion-slim-fit', 'Shopping', 'apparel.fit_preference', /slim fit/i, 0.9, 'low');
    this.addPattern('notion-hate-polyester', 'Shopping', 'apparel.material_dislikes', /hate.{0,20}polyester|no polyester|avoid polyester/i, 0.9, 'low');
    this.addPattern('notion-merino', 'Shopping', 'apparel.material_likes', /love.{0,20}merino|prefer.{0,20}merino|merino wool/i, 0.9, 'low');
    this.addPattern('notion-brands', 'Shopping', 'apparel.preferred_brands', BRANDS_PATTERNS.clothing, 0.7, 'low');

    // Travel patterns
    this.addPattern('notion-travel-freq', 'Travel', 'travel.frequency', /(\d+).{0,10}times.{0,10}year/i, 0.8, 'low');
    this.addPattern('notion-boutique-hotel', 'Travel', 'hotel.room_preference', /boutique hotel/i, 0.9, 'low');
    this.addPattern('notion-chain-dislike', 'Travel', 'hotel.room_dislikes', /avoid.{0,20}chain|prefer.{0,20}boutique|not.{0,20}chain/i, 0.8, 'low');
    this.addPattern('notion-window-seat', 'Travel', 'flight.seat_preference', /window seat/i, 0.9, 'low');
    this.addPattern('notion-aisle-seat', 'Travel', 'flight.seat_preference', /aisle seat/i, 0.9, 'low');
    this.addPattern('notion-tsa-precheck', 'Travel', 'travel.loyalty_programs', /tsa precheck|precheck/i, 0.9, 'medium');
    this.addPattern('notion-carry-on', 'Travel', 'travel.packing_style', /carry-on only|carry on only/i, 0.8, 'low');
    this.addPattern('notion-locations', 'Travel', 'travel.favorite_destinations', LOCATION_PATTERNS, 0.6, 'low');

    // Food patterns
    this.addPattern('notion-pescatarian', 'Food & Dining', 'dietary.restrictions', /pescatarian/i, 0.9, 'medium');
    this.addPattern('notion-vegetarian', 'Food & Dining', 'dietary.restrictions', /vegetarian/i, 0.9, 'medium');
    this.addPattern('notion-gluten-free', 'Food & Dining', 'dietary.restrictions', /gluten-?free/i, 0.9, 'medium');
    this.addPattern('notion-shellfish', 'Food & Dining', 'dietary.allergies', /allergic.{0,20}shellfish|shellfish.{0,20}allergy/i, 0.9, 'high');
    this.addPattern('notion-coffee', 'Food & Dining', 'food.coffee_preferences', /coffee.{0,20}snob|pour.over|pour over|light roast|single.origin/i, 0.8, 'low');
    this.addPattern('notion-meal-prep', 'Food & Dining', 'food.cooking_style', /batch.{0,10}cook|meal.{0,10}prep|prep.{0,10}sunday/i, 0.8, 'low');

    // Work patterns
    this.addPattern('notion-async', 'Work', 'work.communication_style', /prefer.{0,20}async|async.{0,20}communication/i, 0.8, 'low');
    this.addPattern('notion-concise', 'Work', 'work.communication_style', /concise|direct.{0,20}tone|brief/i, 0.7, 'low');
    this.addPattern('notion-tech-brands', 'Work', 'work.tools', BRANDS_PATTERNS.tech, 0.7, 'low');

    // Fitness patterns
    this.addPattern('notion-running-freq', 'Fitness', 'fitness.frequency', /run.{0,20}(\d+).{0,10}(x|times).{0,10}week/i, 0.9, 'low');
    this.addPattern('notion-half-marathon', 'Fitness', 'fitness.goal', /half marathon/i, 0.9, 'low');
    this.addPattern('notion-10k', 'Fitness', 'fitness.goal', /10k|10 k/i, 0.9, 'low');
    this.addPattern('notion-pegasus', 'Fitness', 'fitness.running_shoes', /nike pegasus/i, 0.9, 'low');
    this.addPattern('notion-brooks', 'Fitness', 'fitness.running_shoes', /brooks ghost/i, 0.9, 'low');
    this.addPattern('notion-strava', 'Fitness', 'fitness.apps', /strava/i, 0.9, 'low');
    this.addPattern('notion-garmin', 'Fitness', 'fitness.apps', /garmin/i, 0.9, 'low');

    // Gift patterns
    this.addPattern('notion-partner-gifts', 'Gift Giving', 'gifts.partner_interests', /partner.{0,50}(candle|cooking|ceramic)/i, 0.8, 'high');
    this.addPattern('notion-mom-gifts', 'Gift Giving', 'gifts.mom_interests', /mom.{0,50}(garden|mystery|novel)/i, 0.8, 'high');
    this.addPattern('notion-dad-gifts', 'Gift Giving', 'gifts.dad_interests', /dad.{0,50}(tech|gadget|golf|grill)/i, 0.8, 'high');

    // Entertainment, Home & Living, and Health & Wellness patterns are handled
    // by the shared base methods (extractEntertainmentFactsCommon, etc.)

    // Enriched Shopping patterns
    this.addPattern('notion-price-sensitivity', 'Shopping', 'shopping.price_sensitivity', /budget.{0,10}(?:friendly|conscious)|mid.?range|premium|luxury|high.?end/i, 0.75, 'low');
    this.addPattern('notion-brand-loyalty', 'Shopping', 'shopping.brand_loyalty', /loyal.{0,20}(?:brand|store)|always.{0,15}(?:buy|shop)/i, 0.7, 'low');

    // Enriched Travel patterns
    this.addPattern('notion-hotel-chain', 'Travel', 'travel.hotel_chain', /marriott|hilton|hyatt|ihg|four seasons|ritz/i, 0.85, 'low');
    this.addPattern('notion-travel-style', 'Travel', 'travel.travel_style', /budget.{0,10}travel|luxury.{0,10}travel|backpack|hostel/i, 0.8, 'low');

    // Enriched Food patterns
    this.addPattern('notion-cooking-freq', 'Food & Dining', 'food.cooking_frequency', /cook.{0,10}(?:every|daily|rarely)|batch.{0,10}cook/i, 0.8, 'low');
    this.addPattern('notion-meal-prep2', 'Food & Dining', 'food.meal_prep', /meal.{0,5}prep/i, 0.8, 'low');

    // Enriched Fitness patterns
    this.addPattern('notion-workout-freq', 'Fitness', 'fitness.workout_frequency', /work\s*out.{0,10}(\d+).{0,10}(?:x|times).{0,10}(?:week|per)/i, 0.85, 'low');
    this.addPattern('notion-equipment', 'Fitness', 'fitness.equipment_owned', /treadmill|peloton|dumbbells?|kettlebell|resistance band|yoga mat|foam roller/i, 0.8, 'low');
    this.addPattern('notion-competition', 'Fitness', 'fitness.competition', /race|triathlon|tournament|spartan|ironman/i, 0.8, 'low');

    // Enriched Gift patterns
    this.addPattern('notion-gift-style', 'Gift Giving', 'gifts.style', /practical.{0,10}gift|sentimental.{0,10}gift|experience.{0,10}gift|experiential/i, 0.75, 'low');
  }

  private processPages() {
    this.pages.forEach(page => {
      this.extractFacts(page.content, page.title);

      // Also extract from properties if present
      if (page.properties) {
        const propsText = Object.entries(page.properties)
          .map(([k, v]) => `${k}: ${v}`)
          .join('. ');
        this.extractFacts(propsText, page.title);
      }
    });

    this.organizeExtractedFacts();
    this.buildPersonas();
  }

  private extractFacts(content: string, source: string) {
    this.extractClothingFactsCommon(content, source);
    this.extractTravelFactsCommon(content, source);
    this.extractFoodFactsCommon(content, source);
    this.extractWorkFactsCommon(content, source);
    this.extractFitnessFactsCommon(content, source);
    this.extractGiftFactsCommon(content, source);
    this.extractEntertainmentFactsCommon(content, source);
    this.extractHomeFactsCommon(content, source);
    this.extractHealthFactsCommon(content, source);
  }

  private buildPersonas() {
    this.personas = generatePersonas(this.extractedFacts);
  }

  public generateProfileSummary(): ProfileSummary {
    const shoppingFacts = getFactsForCategory('Shopping', this.extractedFacts);
    const travelFacts = getFactsForCategory('Travel', this.extractedFacts);
    const foodFacts = getFactsForCategory('Food & Dining', this.extractedFacts);
    const fitnessFacts = getFactsForCategory('Fitness', this.extractedFacts);

    let narrative = "Based on your Notion workspace, you're a ";
    narrative += "detail-oriented professional who documents everything. ";

    if (travelFacts.length > 0) {
      narrative += "You plan trips meticulously with detailed itineraries. ";
    }
    if (foodFacts.length > 0) {
      narrative += "You maintain curated recipe collections and restaurant lists. ";
    }
    if (fitnessFacts.length > 0) {
      narrative += "You track your fitness goals and training progress carefully. ";
    }
    if (shoppingFacts.length > 0) {
      narrative += "You keep organized wish lists and wardrobe inventories.";
    }

    const keyTraits = [
      'Meticulous planner',
      'Detail-oriented organizer',
      'Fitness tracker',
      'Thoughtful gift giver',
    ].filter(trait => {
      if (trait.includes('planner')) return travelFacts.length > 0;
      if (trait.includes('organizer')) return getFactsForCategory('Work', this.extractedFacts).length > 0;
      if (trait.includes('tracker')) return fitnessFacts.length > 0;
      if (trait.includes('gift')) return getFactsForCategory('Gift Giving', this.extractedFacts).length > 0;
      return true;
    });

    const totalFacts = this.extractedFacts.length;
    const avgConfidence = totalFacts > 0
      ? this.extractedFacts.reduce((sum, fact) => sum + fact.confidence, 0) / totalFacts
      : 0;

    return {
      narrative: narrative.trim(),
      keyTraits,
      confidence: avgConfidence,
    };
  }

  public generateFollowUpQuestions(): FollowUpQuestion[] {
    const questions: FollowUpQuestion[] = [];

    const hasTravelPages = this.extractedFacts.some(f => f.key.startsWith('travel.'));
    const hasHotelPref = this.extractedFacts.some(f => f.key === 'hotel.room_preference');
    if (hasTravelPages && !hasHotelPref) {
      questions.push({
        id: 'hotel-preference',
        persona: 'Travel',
        question: 'You plan a lot of trips. Do you prefer boutique hotels or chains?',
        type: 'multiple-choice',
        options: ['Boutique hotels', 'Major chains', 'Airbnb / vacation rentals', 'No preference'],
        importance: 'medium',
      });
    }

    const hasFitness = this.extractedFacts.some(f => f.key.startsWith('fitness.'));
    const hasShoeSize = this.extractedFacts.some(f => f.key === 'apparel.shoe.size');
    if (hasFitness && !hasShoeSize) {
      questions.push({
        id: 'shoe-size',
        persona: 'Fitness',
        question: 'What shoe size do you wear for running?',
        type: 'text',
        importance: 'medium',
      });
    }

    return questions.sort((a, b) => {
      const importanceOrder = { high: 3, medium: 2, low: 1 };
      return importanceOrder[b.importance] - importanceOrder[a.importance];
    });
  }

  public getPersonas(): Persona[] {
    return this.personas;
  }

  public override getAllFacts(): Fact[] {
    return this.extractedFacts;
  }
}
