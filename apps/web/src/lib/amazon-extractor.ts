import type { Fact, Persona, ProfileSummary, FollowUpQuestion } from './types';
import { BaseExtractor } from './base-extractor';
import { generatePersonas } from './persona-generator';

// ============================================================================
// Amazon Order Types
// ============================================================================

interface AmazonOrderItem {
  name: string;
  category: string;
  price: number;
  quantity: number;
  size?: string;
  color?: string;
  brand?: string;
  asin?: string;
  imageCategory?: string;
  starRating?: number;
  reviewCount?: number;
  itemDiscount?: number;
  promotions?: string;
}

export interface AmazonOrder {
  orderId: string;
  orderDate: string;
  items: AmazonOrderItem[];
  total: number;
  currency?: string;
  savings?: number;
  shippingAddress: { city: string; state: string };
  status: string;
  source?: 'amazon_csv' | 'amazon_json';
  deliveryDate?: string;
}

// ============================================================================
// Validation
// ============================================================================

interface AmazonValidationResult {
  valid: boolean;
  errors: string[];
  validOrders: AmazonOrder[];
  skippedCount: number;
}

function validateOrder(order: unknown, index: number): { valid: boolean; error?: string; order?: AmazonOrder } {
  if (!order || typeof order !== 'object') {
    return { valid: false, error: `Order ${index + 1} is not a valid object` };
  }
  const o = order as Record<string, unknown>;
  if (typeof o.orderId !== 'string' || typeof o.orderDate !== 'string') {
    return { valid: false, error: `Order ${index + 1} is missing orderId or orderDate` };
  }
  if (!Array.isArray(o.items) || o.items.length === 0) {
    return { valid: false, error: `Order ${index + 1} has no items` };
  }
  return { valid: true, order: o as unknown as AmazonOrder };
}

function validateAmazonOrders(data: unknown): AmazonValidationResult {
  const errors: string[] = [];
  const validOrders: AmazonOrder[] = [];

  if (!Array.isArray(data)) {
    return { valid: false, errors: ['Data is not an array of orders'], validOrders: [], skippedCount: 0 };
  }
  if (data.length === 0) {
    return { valid: false, errors: ['No orders found in data'], validOrders: [], skippedCount: 0 };
  }

  let skippedCount = 0;
  for (let i = 0; i < data.length; i++) {
    const result = validateOrder(data[i], i);
    if (result.valid && result.order) {
      validOrders.push(result.order);
    } else {
      skippedCount++;
      if (result.error) errors.push(result.error);
    }
  }

  return {
    valid: validOrders.length > 0,
    errors,
    validOrders,
    skippedCount,
  };
}

// ============================================================================
// Category detection helpers
// ============================================================================

const CATEGORY_MAP: Record<string, string> = {
  clothing: 'clothing',
  apparel: 'clothing',
  shoes: 'clothing',
  fashion: 'clothing',
  electronics: 'electronics',
  computers: 'electronics',
  'cell phones': 'electronics',
  accessories: 'electronics',
  books: 'books',
  'kindle store': 'books',
  home: 'home',
  kitchen: 'home',
  garden: 'home',
  furniture: 'home',
  'home & kitchen': 'home',
  health: 'health',
  fitness: 'health',
  sports: 'health',
  'sports & outdoors': 'health',
  supplements: 'health',
  'health & household': 'health',
  grocery: 'food',
  food: 'food',
  'gourmet food': 'food',
  'grocery & gourmet food': 'food',
  office: 'office',
  'office products': 'office',
  pet: 'pet',
  'pet supplies': 'pet',
  toys: 'gifts',
  'toys & games': 'gifts',
  beauty: 'beauty',
  'personal care': 'beauty',
  'video games': 'entertainment',
  'movies & tv': 'entertainment',
  'music': 'entertainment',
  'musical instruments': 'entertainment',
  'smart home': 'smart_home',
  'tools & home improvement': 'home',
  'patio, lawn & garden': 'garden',
  'lawn & garden': 'garden',
};

function normalizeCategory(cat: string): string {
  const lower = cat.toLowerCase().trim();
  return CATEGORY_MAP[lower] ?? lower;
}

// ============================================================================
// AmazonExtractor
// ============================================================================

export class AmazonExtractor extends BaseExtractor {
  private orders: AmazonOrder[] = [];
  private personas: Persona[] = [];

  constructor(orders: AmazonOrder[]) {
    super('amazon');
    this.orders = orders;
    this.processOrders();
  }

  protected initPatterns(): void {
    // Amazon extraction is order-based, not text-pattern-based.
    // Patterns are not used; extraction is done via structured order data.
  }

  static fromRawData(data: unknown): { extractor?: AmazonExtractor; validation: AmazonValidationResult } {
    const validation = validateAmazonOrders(data);
    if (!validation.valid) return { validation };
    const extractor = new AmazonExtractor(validation.validOrders);
    return { extractor, validation };
  }

  // ── Processing pipeline ───────────────────────────────────────────────────

  private processOrders() {
    this.extractClothingFacts();
    this.extractTechFacts();
    this.extractBookFacts();
    this.extractHomeFacts();
    this.extractHealthFacts();
    this.extractFoodFacts();
    this.extractGiftFacts();
    this.extractSpendingPatterns();
    this.extractEntertainmentFacts();
    this.extractPetFacts();
    this.extractGardenFacts();
    this.extractSmartHomeFacts();
    this.organizeExtractedFacts();
    this.generatePersonas();
  }

  // ── Clothing ──────────────────────────────────────────────────────────────

  private extractClothingFacts() {
    const clothingItems = this.getItemsByCategory('clothing');
    if (clothingItems.length === 0) return;

    // Sizes
    const sizes = clothingItems.filter(i => i.size).map(i => i.size!);
    const sizeFreq = this.frequency(sizes);
    for (const [size, count] of sizeFreq) {
      if (size.match(/^\d{2}$/)) {
        this.addSourceFact('apparel.pants.waist', size, 0.85 + count * 0.03, 'medium');
      } else if (size.match(/^(XS|S|M|L|XL|XXL|2XL)$/i)) {
        this.addSourceFact('apparel.shirt.size', size.toUpperCase(), 0.85 + count * 0.03, 'medium');
      } else if (size.match(/^\d+(\.\d)?$/)) {
        this.addSourceFact('apparel.shoe.size', size, 0.85 + count * 0.03, 'medium');
      }
    }

    // Colors
    const colors = clothingItems.filter(i => i.color).map(i => i.color!.toLowerCase());
    const colorFreq = this.frequency(colors);
    const topColors = [...colorFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    for (const [color] of topColors) {
      this.addSourceFact('apparel.color_preferences', color, 0.7, 'low');
    }

    // Brands
    const brands = clothingItems.filter(i => i.brand).map(i => i.brand!);
    const brandFreq = this.frequency(brands);
    for (const [brand, count] of brandFreq) {
      this.addSourceFact('apparel.preferred_brands', brand.toLowerCase(), 0.7 + count * 0.05, 'low');
    }

    // Detect athletic vs casual vs work
    const athleticKeywords = /running|athletic|workout|gym|sport|training/i;
    const workKeywords = /dress|oxford|blazer|suit|formal|business/i;
    const athleticCount = clothingItems.filter(i => athleticKeywords.test(i.name)).length;
    const workCount = clothingItems.filter(i => workKeywords.test(i.name)).length;
    const casualCount = clothingItems.length - athleticCount - workCount;

    if (athleticCount >= 2) this.addSourceFact('apparel.style_athletic', 'active/athletic wear', 0.75, 'low');
    if (workCount >= 2) this.addSourceFact('apparel.style_work', 'business/formal wear', 0.75, 'low');
    if (casualCount >= 3) this.addSourceFact('apparel.style_casual', 'casual wear', 0.7, 'low');
  }

  // ── Tech / Electronics ────────────────────────────────────────────────────

  private extractTechFacts() {
    const techItems = this.getItemsByCategory('electronics');
    if (techItems.length === 0) return;

    // Detect ecosystem
    const applePattern = /\b(apple|macbook|iphone|ipad|airpods|magsafe|lightning|usb-c.*apple|apple.*usb-c)\b/i;
    const androidPattern = /\b(samsung|google pixel|android|galaxy|usb-c.*samsung)\b/i;

    const appleCount = techItems.filter(i => applePattern.test(i.name) || applePattern.test(i.brand ?? '')).length;
    const androidCount = techItems.filter(i => androidPattern.test(i.name) || androidPattern.test(i.brand ?? '')).length;

    if (appleCount > androidCount && appleCount >= 2) {
      this.addSourceFact('tech.ecosystem', 'Apple', 0.85, 'low');
    } else if (androidCount > appleCount && androidCount >= 2) {
      this.addSourceFact('tech.ecosystem', 'Android/Samsung', 0.85, 'low');
    }

    // Device types
    const monitorPattern = /monitor|display|screen/i;
    const headphonePattern = /headphone|earbuds|airpods|earphone/i;
    const keyboardPattern = /keyboard/i;
    const mousePattern = /mouse|trackpad/i;

    if (techItems.some(i => monitorPattern.test(i.name))) {
      this.addSourceFact('tech.peripherals', 'external monitor', 0.8, 'low');
    }
    if (techItems.some(i => headphonePattern.test(i.name))) {
      this.addSourceFact('tech.audio', 'wireless earbuds/headphones', 0.8, 'low');
    }
    if (techItems.some(i => keyboardPattern.test(i.name))) {
      this.addSourceFact('tech.peripherals', 'mechanical/external keyboard', 0.75, 'low');
    }
    if (techItems.some(i => mousePattern.test(i.name))) {
      this.addSourceFact('tech.peripherals', 'external mouse/trackpad', 0.75, 'low');
    }

    // Brands
    const techBrands = techItems.filter(i => i.brand).map(i => i.brand!);
    const brandFreq = this.frequency(techBrands);
    for (const [brand, count] of brandFreq) {
      if (count >= 2) {
        this.addSourceFact('tech.preferred_brands', brand, 0.7 + count * 0.05, 'low');
      }
    }
  }

  // ── Books ─────────────────────────────────────────────────────────────────

  private extractBookFacts() {
    const bookItems = this.getItemsByCategory('books');
    if (bookItems.length === 0) return;

    // Detect genres from names/categories
    const genrePatterns: Array<[RegExp, string]> = [
      [/design|typography|ux|ui|visual|graphic/i, 'design'],
      [/programming|software|coding|algorithm|engineer/i, 'technology/programming'],
      [/business|management|leadership|startup|entrepreneur/i, 'business'],
      [/fiction|novel|story|mystery|thriller|fantasy|sci-fi/i, 'fiction'],
      [/self-help|productivity|habit|mindset|psychology/i, 'self-help/psychology'],
      [/cook|recipe|food|baking|kitchen/i, 'cooking/food'],
      [/history|biography|memoir/i, 'history/biography'],
      [/science|physics|biology|math/i, 'science'],
    ];

    const detectedGenres = new Set<string>();
    for (const item of bookItems) {
      for (const [pattern, genre] of genrePatterns) {
        if (pattern.test(item.name)) {
          detectedGenres.add(genre);
        }
      }
    }

    for (const genre of detectedGenres) {
      this.addSourceFact('reading.interests', genre, 0.75, 'low');
    }

    if (bookItems.length >= 3) {
      this.addSourceFact('reading.frequency', 'regular reader', 0.7, 'low');
    }
  }

  // ── Home ──────────────────────────────────────────────────────────────────

  private extractHomeFacts() {
    const homeItems = this.getItemsByCategory('home');
    if (homeItems.length === 0) return;

    const modernPattern = /minimalist|modern|sleek|contemporary|scandinavian/i;
    const cozyPattern = /cozy|warm|rustic|farmhouse|vintage|boho/i;

    const modernCount = homeItems.filter(i => modernPattern.test(i.name)).length;
    const cozyCount = homeItems.filter(i => cozyPattern.test(i.name)).length;

    if (modernCount > cozyCount && modernCount >= 2) {
      this.addSourceFact('home.style', 'modern/minimalist', 0.7, 'low');
    } else if (cozyCount > modernCount && cozyCount >= 2) {
      this.addSourceFact('home.style', 'cozy/rustic', 0.7, 'low');
    }

    // Kitchen-specific
    const kitchenItems = homeItems.filter(i =>
      /kitchen|cook|coffee|tea|mug|pot|pan|knife|cutting|blender/i.test(i.name)
    );
    if (kitchenItems.length >= 2) {
      this.addSourceFact('home.cooking_interest', 'regular home cook', 0.75, 'low');
    }

    // Coffee enthusiast
    const coffeeItems = homeItems.filter(i => /coffee|espresso|grinder|pour.over|chemex|aeropress/i.test(i.name));
    if (coffeeItems.length >= 2) {
      this.addSourceFact('food.coffee_preferences', 'coffee enthusiast', 0.8, 'low');
    }
  }

  // ── Health & Fitness ──────────────────────────────────────────────────────

  private extractHealthFacts() {
    const healthItems = this.getItemsByCategory('health');
    if (healthItems.length === 0) return;

    // Running
    const runningItems = healthItems.filter(i => /running|marathon|jog/i.test(i.name));
    if (runningItems.length >= 1) {
      this.addSourceFact('fitness.activity', 'running', 0.8, 'low');
    }

    // Yoga
    const yogaItems = healthItems.filter(i => /yoga|mat|meditation|pilates/i.test(i.name));
    if (yogaItems.length >= 1) {
      this.addSourceFact('fitness.activity', 'yoga/meditation', 0.75, 'low');
    }

    // Supplements
    const supplementItems = healthItems.filter(i => /protein|vitamin|supplement|creatine|omega|probiotic|collagen/i.test(i.name));
    if (supplementItems.length >= 1) {
      this.addSourceFact('health.supplements', 'takes supplements regularly', 0.75, 'medium');
    }

    // Fitness equipment
    const equipmentItems = healthItems.filter(i =>
      /dumbbell|resistance|band|foam roller|kettlebell|pull.up/i.test(i.name)
    );
    if (equipmentItems.length >= 1) {
      this.addSourceFact('fitness.home_gym', 'has home workout equipment', 0.7, 'low');
    }

    // Running shoes brand
    const runningShoes = healthItems.filter(i => /running shoe|pegasus|ultraboost|gel.nimbus|fresh foam/i.test(i.name));
    for (const shoe of runningShoes) {
      if (shoe.brand) {
        this.addSourceFact('fitness.running_shoes', `${shoe.brand} ${shoe.name.split(' ').slice(0, 3).join(' ')}`, 0.85, 'low');
      }
    }
  }

  // ── Food & Grocery ────────────────────────────────────────────────────────

  private extractFoodFacts() {
    const foodItems = this.getItemsByCategory('food');
    if (foodItems.length === 0) return;

    // Coffee
    const coffeeItems = foodItems.filter(i => /coffee|espresso|roast/i.test(i.name));
    if (coffeeItems.length >= 1) {
      this.addSourceFact('food.coffee_preferences', 'coffee drinker', 0.75, 'low');
      const lightRoast = coffeeItems.some(i => /light roast/i.test(i.name));
      const darkRoast = coffeeItems.some(i => /dark roast/i.test(i.name));
      if (lightRoast) this.addSourceFact('food.coffee_preferences', 'prefers light roast', 0.7, 'low');
      if (darkRoast) this.addSourceFact('food.coffee_preferences', 'prefers dark roast', 0.7, 'low');
    }

    // Tea
    const teaItems = foodItems.filter(i => /tea|matcha|chamomile|green tea/i.test(i.name));
    if (teaItems.length >= 1) {
      this.addSourceFact('food.tea_preferences', 'tea drinker', 0.7, 'low');
    }

    // Organic preference
    const organicItems = foodItems.filter(i => /organic|natural|non-gmo/i.test(i.name));
    if (organicItems.length >= 2) {
      this.addSourceFact('food.preferences', 'prefers organic/natural products', 0.75, 'low');
    }

    // Snack preferences
    const snackItems = foodItems.filter(i => /snack|bar|nut|trail mix|jerky|chip/i.test(i.name));
    if (snackItems.length >= 2) {
      this.addSourceFact('food.snack_preferences', 'regular snacker', 0.65, 'low');
    }
  }

  // ── Gift Detection ────────────────────────────────────────────────────────

  private extractGiftFacts() {
    // Detect gifts: different shipping address or gift-wrap keywords
    const primaryAddress = this.detectPrimaryAddress();
    const giftOrders = this.orders.filter(order => {
      const addr = order.shippingAddress;
      const isDifferentAddress = primaryAddress &&
        (addr.city !== primaryAddress.city || addr.state !== primaryAddress.state);
      const hasGiftItems = order.items.some(i =>
        /gift|wrap|card|present/i.test(i.name) || /gift/i.test(order.status)
      );
      return isDifferentAddress || hasGiftItems;
    });

    if (giftOrders.length >= 2) {
      this.addSourceFact('gifts.frequency', 'regular gift giver', 0.75, 'low');
    }

    // Gift budget range
    if (giftOrders.length > 0) {
      const giftTotals = giftOrders.map(o => o.total);
      const avgGift = giftTotals.reduce((s, t) => s + t, 0) / giftTotals.length;
      this.addSourceFact('budget.gift_range', `~$${Math.round(avgGift)}`, 0.7, 'medium');
    }
  }

  // ── Spending Patterns ─────────────────────────────────────────────────────

  private extractSpendingPatterns() {
    if (this.orders.length === 0) return;

    const monthlySpend = new Map<string, number>();

    for (const order of this.orders) {
      const month = order.orderDate.slice(0, 7); // YYYY-MM
      monthlySpend.set(month, (monthlySpend.get(month) ?? 0) + order.total);
    }

    const avgMonthly = [...monthlySpend.values()].reduce((s, v) => s + v, 0) / monthlySpend.size;
    if (avgMonthly > 0) {
      this.addSourceFact('budget.avg_monthly_amazon', `~$${Math.round(avgMonthly)}`, 0.8, 'medium');
    }

    // Order frequency
    const avgOrdersPerMonth = this.orders.length / Math.max(monthlySpend.size, 1);
    if (avgOrdersPerMonth >= 4) {
      this.addSourceFact('shopping.frequency', 'frequent Amazon shopper', 0.85, 'low');
    } else if (avgOrdersPerMonth >= 2) {
      this.addSourceFact('shopping.frequency', 'regular Amazon shopper', 0.75, 'low');
    }

    // Location
    const primaryAddr = this.detectPrimaryAddress();
    if (primaryAddr) {
      this.addSourceFact('location.city', primaryAddr.city, 0.9, 'medium');
      this.addSourceFact('location.state', primaryAddr.state, 0.9, 'medium');
    }
  }

  // ── Entertainment ────────────────────────────────────────────────────────

  private extractEntertainmentFacts() {
    const entertainmentItems = this.getItemsByCategory('entertainment');
    if (entertainmentItems.length === 0) return;

    // Gaming platforms
    const gamingPatterns: Array<[RegExp, string]> = [
      [/playstation|ps5|ps4|dualshock|dualsense/i, 'PlayStation'],
      [/xbox|series x|series s/i, 'Xbox'],
      [/nintendo|switch|joy-?con/i, 'Nintendo Switch'],
      [/steam deck/i, 'Steam Deck'],
    ];
    for (const [pattern, platform] of gamingPatterns) {
      if (entertainmentItems.some(i => pattern.test(i.name))) {
        this.addSourceFact('entertainment.gaming_platforms', platform, 0.85, 'low');
      }
    }

    // Gaming genres from item names
    const genrePatterns: Array<[RegExp, string]> = [
      [/rpg|role.playing/i, 'RPG'],
      [/fps|shooter|call of duty|battlefield/i, 'FPS'],
      [/strategy|civilization|age of empires/i, 'strategy'],
      [/racing|forza|gran turismo/i, 'racing'],
      [/sports|madden|fifa|nba/i, 'sports'],
    ];
    for (const [pattern, genre] of genrePatterns) {
      if (entertainmentItems.some(i => pattern.test(i.name))) {
        this.addSourceFact('entertainment.gaming_genres', genre, 0.75, 'low');
      }
    }

    // Streaming devices signal streaming services
    if (entertainmentItems.some(i => /fire.?stick|chromecast|roku|apple tv/i.test(i.name))) {
      this.addSourceFact('entertainment.streaming_services', 'streaming device owner', 0.7, 'low');
    }

    // Music
    if (entertainmentItems.some(i => /vinyl|turntable|record player|guitar|piano|ukulele/i.test(i.name))) {
      this.addSourceFact('entertainment.music_genres', 'music enthusiast', 0.75, 'low');
    }
  }

  // ── Pets ────────────────────────────────────────────────────────────────

  private extractPetFacts() {
    const petItems = this.getItemsByCategory('pet');
    if (petItems.length === 0) return;

    // Detect pet type
    const dogItems = petItems.filter(i => /dog|puppy|canine|chew|leash|collar/i.test(i.name));
    const catItems = petItems.filter(i => /cat|kitten|feline|litter|scratching/i.test(i.name));
    const fishItems = petItems.filter(i => /fish|aquarium|tank|filter/i.test(i.name));

    if (dogItems.length > 0) this.addSourceFact('home.pets', 'dog', 0.85, 'low');
    if (catItems.length > 0) this.addSourceFact('home.pets', 'cat', 0.85, 'low');
    if (fishItems.length > 0) this.addSourceFact('home.pets', 'fish', 0.8, 'low');

    // Pet food brands
    const petBrands = petItems.filter(i => i.brand).map(i => i.brand!);
    const brandFreq = this.frequency(petBrands);
    for (const [brand, count] of brandFreq) {
      if (count >= 2) {
        this.addSourceFact('home.pet_breeds', `${brand} customer`, 0.65, 'low');
      }
    }
  }

  // ── Garden ──────────────────────────────────────────────────────────────

  private extractGardenFacts() {
    const gardenItems = this.getItemsByCategory('garden');
    if (gardenItems.length === 0) return;

    if (gardenItems.some(i => /seed|vegetable|tomato|pepper|lettuce/i.test(i.name))) {
      this.addSourceFact('home.garden_preferences', 'vegetables', 0.8, 'low');
    }
    if (gardenItems.some(i => /flower|rose|tulip|sunflower|petunia|dahlia/i.test(i.name))) {
      this.addSourceFact('home.garden_preferences', 'flowers', 0.8, 'low');
    }
    if (gardenItems.some(i => /herb|basil|mint|cilantro|parsley|thyme/i.test(i.name))) {
      this.addSourceFact('home.garden_preferences', 'herbs', 0.8, 'low');
    }
  }

  // ── Smart Home ──────────────────────────────────────────────────────────

  private extractSmartHomeFacts() {
    const smartHomeItems = this.getItemsByCategory('smart_home');
    if (smartHomeItems.length === 0) return;

    const devicePatterns: Array<[RegExp, string]> = [
      [/echo|alexa/i, 'Amazon Echo/Alexa'],
      [/google home|nest/i, 'Google Nest'],
      [/hue|smart.?bulb|smart.?light/i, 'Smart Lighting'],
      [/ring|blink|smart.?camera/i, 'Smart Security'],
      [/thermostat|ecobee/i, 'Smart Thermostat'],
      [/smart.?plug|smart.?switch/i, 'Smart Plugs'],
    ];

    for (const [pattern, device] of devicePatterns) {
      if (smartHomeItems.some(i => pattern.test(i.name))) {
        this.addSourceFact('home.smart_devices', device, 0.85, 'low');
      }
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private getItemsByCategory(cat: string): AmazonOrderItem[] {
    const items: AmazonOrderItem[] = [];
    for (const order of this.orders) {
      for (const item of order.items) {
        if (normalizeCategory(item.category) === cat) {
          items.push(item);
        }
      }
    }
    return items;
  }

  private frequency(values: string[]): Map<string, number> {
    const freq = new Map<string, number>();
    for (const v of values) {
      const key = v.toLowerCase().trim();
      freq.set(key, (freq.get(key) ?? 0) + 1);
    }
    return freq;
  }

  private detectPrimaryAddress(): { city: string; state: string } | null {
    const addrFreq = new Map<string, number>();
    for (const order of this.orders) {
      const key = `${order.shippingAddress.city}|${order.shippingAddress.state}`;
      addrFreq.set(key, (addrFreq.get(key) ?? 0) + 1);
    }
    let maxKey = '';
    let maxCount = 0;
    for (const [key, count] of addrFreq) {
      if (count > maxCount) {
        maxCount = count;
        maxKey = key;
      }
    }
    if (!maxKey) return null;
    const [city, state] = maxKey.split('|');
    return { city, state };
  }


  // ── Persona Generation ────────────────────────────────────────────────────

  private generatePersonas() {
    this.personas = generatePersonas(this.extractedFacts);
  }

  // ── Public API (legacy chat-extractor compatible) ─────────────────────────

  public getPersonas(): Persona[] {
    return this.personas;
  }

  public override getAllFacts(): Fact[] {
    return this.extractedFacts;
  }

  public generateProfileSummary(): ProfileSummary {
    const totalFacts = this.extractedFacts.length;
    const avgConfidence = totalFacts > 0
      ? this.extractedFacts.reduce((s, f) => s + f.confidence, 0) / totalFacts
      : 0;

    const parts: string[] = [];

    // Location
    const city = this.extractedFacts.find(f => f.key === 'location.city');
    if (city) parts.push(`Based in ${city.value}`);

    // Ecosystem
    const eco = this.extractedFacts.find(f => f.key === 'tech.ecosystem');
    if (eco) parts.push(`${eco.value} ecosystem user`);

    // Shopping frequency
    const freq = this.extractedFacts.find(f => f.key === 'shopping.frequency');
    if (freq) parts.push(freq.value);

    // Fitness
    const activity = this.extractedFacts.filter(f => f.key === 'fitness.activity');
    if (activity.length > 0) {
      parts.push(`active lifestyle (${activity.map(a => a.value).join(', ')})`);
    }

    // Reading
    const reading = this.extractedFacts.filter(f => f.key === 'reading.interests');
    if (reading.length > 0) {
      parts.push(`reads ${reading.map(r => r.value).join(', ')}`);
    }

    const narrative = parts.length > 0
      ? `Based on your Amazon order history: ${parts.join('. ')}.`
      : 'Not enough order data to build a complete profile yet.';

    const keyTraits = this.extractedFacts
      .filter(f => f.confidence >= 0.75)
      .slice(0, 5)
      .map(f => f.value);

    return { narrative, keyTraits, confidence: avgConfidence };
  }

  public generateFollowUpQuestions(): FollowUpQuestion[] {
    const questions: FollowUpQuestion[] = [];

    const hasClothing = this.extractedFacts.some(f => f.key.startsWith('apparel.'));
    const hasShoeSize = this.extractedFacts.some(f => f.key === 'apparel.shoe.size');
    if (hasClothing && !hasShoeSize) {
      questions.push({
        id: 'amazon-shoe-size',
        persona: 'Shopping',
        question: 'We found clothing purchases but no shoe size. What shoe size do you typically wear?',
        type: 'text',
        importance: 'medium',
      });
    }

    const hasEcosystem = this.extractedFacts.some(f => f.key === 'tech.ecosystem');
    if (!hasEcosystem) {
      questions.push({
        id: 'amazon-tech-ecosystem',
        persona: 'Work',
        question: 'Do you primarily use Apple or Android/Windows devices?',
        type: 'multiple-choice',
        options: ['Apple', 'Android', 'Windows', 'Mix of platforms'],
        importance: 'low',
      });
    }

    return questions.sort((a, b) => {
      const order = { high: 3, medium: 2, low: 1 };
      return order[b.importance] - order[a.importance];
    });
  }
}
