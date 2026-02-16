import type { Fact, Persona, ProfileSummary, FollowUpQuestion } from './types';
import { BaseExtractor } from './base-extractor';
import { generatePersonas, getFactsForCategory } from './persona-generator';

// ============================================================================
// Claude Export Types
// ============================================================================

export interface ClaudeMessage {
  uuid: string;
  sender: 'human' | 'user' | 'assistant' | string;
  text: string;
  created_at: string;
  content?: unknown;
  [key: string]: unknown;
}

export interface ClaudeExport {
  uuid: string;
  name: string;
  created_at: string;
  updated_at: string;
  chat_messages: ClaudeMessage[];
}


// ============================================================================
// Claude Extractor
// ============================================================================

export class ClaudeExtractor extends BaseExtractor {
  private conversations: ClaudeExport[] = [];
  private personas: Persona[] = [];

  constructor(conversations: ClaudeExport[]) {
    super('claude');
    this.conversations = conversations;
    this.processConversations();
  }

  protected initPatterns(): void {
    // Claude extraction uses manual pattern matching, not BaseExtractor patterns.
  }

  private isUserSender(sender: unknown): boolean {
    if (typeof sender !== 'string') return false;
    const normalized = sender.trim().toLowerCase();
    return normalized === 'human' || normalized === 'user';
  }

  private collectText(value: unknown, fragments: string[], depth = 0): void {
    if (value === null || value === undefined || depth > 4) return;

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) fragments.push(trimmed);
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item) => this.collectText(item, fragments, depth + 1));
      return;
    }

    if (typeof value !== 'object') return;

    const record = value as Record<string, unknown>;
    const directTextKeys = ['text', 'content', 'value'];
    for (const key of directTextKeys) {
      if (typeof record[key] === 'string') {
        this.collectText(record[key], fragments, depth + 1);
      }
    }
  }

  private messageText(message: ClaudeMessage): string {
    if (typeof message.text === 'string' && message.text.trim().length > 0) {
      return message.text.trim();
    }

    const fragments: string[] = [];
    this.collectText(message.content, fragments);
    return fragments.join(' ').trim();
  }

  private processConversations() {
    this.conversations.forEach(conv => {
      const userMessages = conv.chat_messages.filter((message) =>
        this.isUserSender(message.sender),
      );
      userMessages.forEach(message => {
        const text = this.messageText(message);
        if (!text) return;
        this.extractFacts(text, conv.name);
      });
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
    const workFacts = getFactsForCategory('Work', this.extractedFacts);

    let narrative = "You're a ";

    if (workFacts.some(f => f.value.includes('react') || f.value.includes('typescript'))) {
      narrative += "software engineer ";
    } else {
      narrative += "professional ";
    }

    const chicagoMentions = this.extractedFacts.filter(f =>
      f.value.toLowerCase().includes('chicago'),
    );
    if (chicagoMentions.length > 0) {
      narrative += "in Chicago ";
    }

    narrative += "with a keen eye for quality. ";

    if (shoppingFacts.length > 0) {
      narrative += "You shop thoughtfully, preferring well-made basics from trusted brands. ";
    }

    if (travelFacts.length > 0) {
      narrative += "You travel frequently and value comfort and authenticity over luxury. ";
    }

    if (foodFacts.length > 0) {
      const pescatarian = foodFacts.find(f => f.value.includes('pescatarian'));
      if (pescatarian) {
        narrative += "You follow a pescatarian diet and love exploring new cuisines. ";
      }
    }

    if (fitnessFacts.length > 0) {
      narrative += "You take fitness seriously and track your progress meticulously.";
    }

    const keyTraits = [
      'Quality-conscious shopper',
      'Boutique hotel enthusiast',
      'Pescatarian foodie',
      'Fitness-focused runner',
      'Thoughtful gift giver',
    ].filter(trait => {
      if (trait.includes('shopper')) return shoppingFacts.length > 0;
      if (trait.includes('hotel')) return travelFacts.length > 0;
      if (trait.includes('foodie')) return foodFacts.length > 0;
      if (trait.includes('runner')) return fitnessFacts.length > 0;
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

    const hasRunningShoes = this.extractedFacts.some(f => {
      const v = f.value.toLowerCase();
      return v.includes('pegasus') || v.includes('ghost') || v.includes('running');
    });
    const hasShoeSize = this.extractedFacts.some(f => f.key === 'apparel.shoe.size');
    if (hasRunningShoes && !hasShoeSize) {
      questions.push({
        id: 'running-shoe-size',
        persona: 'Fitness',
        question: 'You mentioned running shoes. What shoe size do you wear?',
        type: 'text',
        importance: 'medium',
      });
    }

    const hasWindowSeat = this.extractedFacts.some(f => f.value.includes('window seat'));
    const hasAirlinePreference = this.extractedFacts.some(f => f.key === 'travel.airline_preference');
    if (hasWindowSeat && !hasAirlinePreference) {
      questions.push({
        id: 'airline-preference',
        persona: 'Travel',
        question: 'You prefer window seats. Do you have a go-to airline?',
        type: 'multiple-choice',
        options: ['United', 'American', 'Delta', 'Southwest', 'No preference'],
        importance: 'low',
      });
    }

    const hasCoffee = this.extractedFacts.some(f => f.key === 'food.coffee_preferences');
    if (hasCoffee) {
      questions.push({
        id: 'coffee-shop-preference',
        persona: 'Food & Dining',
        question: 'Any favorite local coffee shops or roasters?',
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
