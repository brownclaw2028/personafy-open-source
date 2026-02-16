import type { Fact, Persona, ProfileSummary, FollowUpQuestion } from './types';
import { BaseExtractor } from './base-extractor';
import { generatePersonas } from './persona-generator';

// ============================================================================
// Gmail Types
// ============================================================================

export interface GmailEmail {
  id: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  date: string;
  labels: string[];
  threadId?: string;
  messageId?: string;
}


// ============================================================================
// Sender / Pattern Matching
// ============================================================================

const SHOPPING_SENDERS: Record<string, string> = {
  'amazon.com': 'Amazon',
  'target.com': 'Target',
  'walmart.com': 'Walmart',
  'bestbuy.com': 'Best Buy',
  'nordstrom.com': 'Nordstrom',
  'nike.com': 'Nike',
  'adidas.com': 'Adidas',
  'uniqlo.com': 'Uniqlo',
  'patagonia.com': 'Patagonia',
  'everlane.com': 'Everlane',
  'rei.com': 'REI',
  'apple.com': 'Apple',
  'bonobos.com': 'Bonobos',
  'jcrew.com': 'J.Crew',
  'gap.com': 'Gap',
};

const TRAVEL_SENDERS: Record<string, string> = {
  'united.com': 'United Airlines',
  'delta.com': 'Delta Air Lines',
  'aa.com': 'American Airlines',
  'southwest.com': 'Southwest Airlines',
  'marriott.com': 'Marriott',
  'hilton.com': 'Hilton',
  'airbnb.com': 'Airbnb',
  'booking.com': 'Booking.com',
  'expedia.com': 'Expedia',
  'kayak.com': 'Kayak',
};

const FOOD_SENDERS: Record<string, string> = {
  'doordash.com': 'DoorDash',
  'ubereats.com': 'Uber Eats',
  'grubhub.com': 'Grubhub',
  'opentable.com': 'OpenTable',
  'yelp.com': 'Yelp',
  'toasttab.com': 'Toast',
  'resy.com': 'Resy',
};

const SUBSCRIPTION_SENDERS: Record<string, string> = {
  'netflix.com': 'Netflix',
  'spotify.com': 'Spotify',
  'nytimes.com': 'New York Times',
  'hulu.com': 'Hulu',
  'disneyplus.com': 'Disney+',
  'hbomax.com': 'HBO Max',
  'audible.com': 'Audible',
  'apple.com': 'Apple',
  'youtube.com': 'YouTube',
  'adobe.com': 'Adobe',
  'figma.com': 'Figma',
};

const FINANCE_SENDERS: Record<string, string> = {
  'chase.com': 'Chase',
  'bankofamerica.com': 'Bank of America',
  'wellsfargo.com': 'Wells Fargo',
  'citi.com': 'Citi',
  'americanexpress.com': 'American Express',
  'capitalone.com': 'Capital One',
  'fidelity.com': 'Fidelity',
  'vanguard.com': 'Vanguard',
  'schwab.com': 'Schwab',
  'venmo.com': 'Venmo',
  'paypal.com': 'PayPal',
};

const HEALTH_SENDERS: Record<string, string> = {
  'myfitnesspal.com': 'MyFitnessPal',
  'strava.com': 'Strava',
  'peloton.com': 'Peloton',
  'equinox.com': 'Equinox',
  'orangetheory.com': 'Orangetheory',
  'classpass.com': 'ClassPass',
  'zocdoc.com': 'Zocdoc',
  'onemedical.com': 'One Medical',
};

const ENTERTAINMENT_SENDERS: Record<string, string> = {
  'netflix.com': 'Netflix',
  'hulu.com': 'Hulu',
  'disneyplus.com': 'Disney+',
  'hbomax.com': 'HBO Max',
  'spotify.com': 'Spotify',
  'twitch.tv': 'Twitch',
  'playstation.com': 'PlayStation',
  'xbox.com': 'Xbox',
  'nintendo.com': 'Nintendo',
  'steampowered.com': 'Steam',
  'epicgames.com': 'Epic Games',
};

const HOME_SENDERS: Record<string, string> = {
  'wayfair.com': 'Wayfair',
  'ikea.com': 'IKEA',
  'westelm.com': 'West Elm',
  'potterybarn.com': 'Pottery Barn',
  'crateandbarrel.com': 'Crate & Barrel',
  'homedepot.com': 'Home Depot',
  'lowes.com': 'Lowes',
  'chewy.com': 'Chewy',
  'petco.com': 'Petco',
  'petsmart.com': 'PetSmart',
};

const WELLNESS_SENDERS: Record<string, string> = {
  'headspace.com': 'Headspace',
  'calm.com': 'Calm',
  'betterhelp.com': 'BetterHelp',
  'talkspace.com': 'Talkspace',
  'noom.com': 'Noom',
  'care.com': 'Care.com',
};

function normalizeSenderDomain(domain: string): string {
  const normalized = domain.trim().toLowerCase().replace(/^www\./, '');
  if (!normalized) return '';
  if (normalized.endsWith('.example.com')) {
    const prefix = normalized.slice(0, -'.example.com'.length);
    if (prefix) return `${prefix}.com`;
  }
  return normalized;
}

function resolveSenderLabel(map: Record<string, string>, domain: string): string | undefined {
  const normalizedDomain = normalizeSenderDomain(domain);
  if (!normalizedDomain) return undefined;
  if (map[normalizedDomain]) return map[normalizedDomain];
  for (const [knownDomain, label] of Object.entries(map)) {
    if (normalizedDomain.endsWith(`.${knownDomain}`)) return label;
  }
  return undefined;
}

// ============================================================================
// Extraction Patterns
// ============================================================================

const SIZE_PATTERNS = {
  shirtSize: /\b(size\s+)?(xs|small|s|medium|m|large|l|x-?large|xl|xxl|2xl)\b/i,
  pantSize: /\b(\d{2})(?:\s*[x/]\s*(\d{2}))?\b/,
  shoeSize: /\bsize\s+(\d+(?:\.\d)?)\b/i,
  waist: /\b(\d{2})\s*(?:waist|w)\b/i,
  inseam: /\b(\d{2})\s*(?:inseam|l)\b/i,
};

const PRICE_PATTERN = /\$\s*(\d+(?:\.\d{2})?)/g;
const CLOTHING_CONTEXT_PATTERN = /\b(shirt|tee|top|polo|pants|jeans|jacket|shoe|sneaker|boot|dress|coat|hoodie|sweater|apparel|clothing)\b/i;
const FOOD_DELIVERY_PATTERN = /\b(doordash|uber\s*eats|ubereats|grubhub|delivery fee|meal|restaurant)\b/i;

const DESTINATION_PATTERN = /(?:to|from|arriving|departing)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*(?:,\s*[A-Z]{2})?)/g;

// Brand/company names that commonly follow "from" but are NOT travel destinations
const DESTINATION_BLOCKLIST = new Set([
  'amazon', 'apple', 'google', 'netflix', 'spotify', 'uber', 'lyft',
  'walmart', 'target', 'costco', 'nordstrom', 'macys', 'nike', 'adidas',
  'patagonia', 'rei', 'etsy', 'ebay', 'paypal', 'venmo', 'stripe',
  'slack', 'zoom', 'microsoft', 'facebook', 'meta', 'instagram',
  'twitter', 'linkedin', 'github', 'notion', 'figma', 'canva',
  'shopify', 'squarespace', 'wordpress', 'substack', 'medium',
  'starbucks', 'chipotle', 'doordash', 'grubhub', 'instacart',
  'airbnb', 'tesla', 'samsung', 'sony', 'honda', 'toyota',
]);

const LOYALTY_PATTERN = /(?:mileageplus|skymiles|aadvantage|rapid\s*rewards|marriott\s*bonvoy|hilton\s*honors)[:\s#]*(\w+)/i;

const CUISINE_PATTERNS = [
  'sushi', 'ramen', 'thai', 'mediterranean', 'italian', 'mexican',
  'indian', 'chinese', 'japanese', 'korean', 'french', 'vietnamese',
  'ethiopian', 'greek', 'spanish', 'tapas', 'bbq', 'barbecue',
  'vegan', 'vegetarian', 'seafood', 'steakhouse', 'pizza', 'burgers',
];

// ============================================================================
// Gmail Extractor Class
// ============================================================================

export class GmailExtractor extends BaseExtractor {
  private emails: GmailEmail[] = [];
  private personas: Persona[] = [];
  private categoryCounts: Record<string, number> = {};

  constructor(emails: GmailEmail[]) {
    super('gmail');
    this.emails = emails;
    this.processEmails();
  }

  // Override to filter out brand-name false positives from destination matching
  override extractFromText(text: string, sourceId: string, sourceName: string) {
    const matches = super.extractFromText(text, sourceId, sourceName);
    return matches.filter(m =>
      m.patternId !== 'gmail-destination' || !DESTINATION_BLOCKLIST.has(m.value.toLowerCase()),
    );
  }

  protected override normalizeValue(value: string, key: string): string {
    const normalized = super.normalizeValue(value, key);
    if (key === 'apparel.shoe.size' || key === 'not_apparel.shoe.size') {
      const size = Number.parseFloat(normalized);
      if (!Number.isFinite(size) || size < 3 || size > 18) return '';
    }
    return normalized;
  }

  protected initPatterns(): void {
    // Shopping patterns
    this.addPattern('gmail-waist', 'Shopping', 'apparel.pants.waist', SIZE_PATTERNS.waist, 0.9, 'medium');
    this.addPattern('gmail-inseam', 'Shopping', 'apparel.pants.inseam', SIZE_PATTERNS.inseam, 0.9, 'medium');
    this.addPattern('gmail-shirt-size', 'Shopping', 'apparel.shirt.size', SIZE_PATTERNS.shirtSize, 0.85, 'medium');
    this.addPattern('gmail-shoe-size', 'Shopping', 'apparel.shoe.size', SIZE_PATTERNS.shoeSize, 0.85, 'medium');
    this.addPattern('gmail-price', 'Shopping', 'budget.monthly_clothing', PRICE_PATTERN, 0.5, 'medium');
    this.addPattern('gmail-tech-products', 'Shopping', 'shopping.categories', /macbook|iphone|ipad|airpods|kindle|echo|pixel|galaxy/i, 0.7, 'low');
    this.addPattern('gmail-book-products', 'Shopping', 'shopping.categories', /paperback|hardcover|kindle edition|audiobook|isbn/i, 0.7, 'low');
    this.addPattern('gmail-clothing-products', 'Shopping', 'shopping.categories', /shirt|pants|jacket|shoes|sneakers|boots|dress|coat/i, 0.7, 'low');

    // Travel patterns
    this.addPattern('gmail-boutique-hotel', 'Travel', 'hotel.room_preference', /boutique|design hotel|independent hotel/i, 0.85, 'low');
    this.addPattern('gmail-destination', 'Travel', 'travel.favorite_destinations', DESTINATION_PATTERN, 0.65, 'low');
    this.addPattern('gmail-window-seat', 'Travel', 'flight.seat_preference', /window seat/i, 0.9, 'low');
    this.addPattern('gmail-aisle-seat', 'Travel', 'flight.seat_preference', /aisle seat/i, 0.9, 'low');
    this.addPattern('gmail-premium-cabin', 'Travel', 'travel.cabin_preference', /first class|business class/i, 0.8, 'low');
    this.addPattern('gmail-economy-cabin', 'Travel', 'travel.cabin_preference', /economy|coach/i, 0.6, 'low');
    this.addPattern('gmail-loyalty', 'Travel', 'travel.loyalty_programs', LOYALTY_PATTERN, 0.9, 'medium');
    this.addPattern('gmail-tsa-precheck', 'Travel', 'travel.loyalty_programs', /tsa\s*pre\s*check|global\s*entry|clear\s*plus|nexus/i, 0.9, 'medium');

    // Food patterns
    this.addPattern('gmail-vegetarian', 'Food & Dining', 'dietary.restrictions', /vegetarian|veggie|plant-?based/i, 0.75, 'medium');
    this.addPattern('gmail-vegan', 'Food & Dining', 'dietary.restrictions', /vegan/i, 0.75, 'medium');
    this.addPattern('gmail-gluten-free', 'Food & Dining', 'dietary.restrictions', /gluten.?free/i, 0.75, 'medium');
    this.addPattern('gmail-dairy-free', 'Food & Dining', 'dietary.restrictions', /dairy.?free|lactose/i, 0.75, 'medium');
    this.addPattern('gmail-nut-allergy', 'Food & Dining', 'dietary.allergies', /nut.?free|peanut allergy|tree nut allergy/i, 0.9, 'high');
    this.addPattern('gmail-shellfish-allergy', 'Food & Dining', 'dietary.allergies', /shellfish allergy|no shellfish/i, 0.9, 'high');
    this.addPattern('gmail-pescatarian', 'Food & Dining', 'dietary.restrictions', /pescatarian/i, 0.85, 'medium');

    // Finance patterns
    this.addPattern('gmail-direct-deposit', 'Finance', 'finance.income_signal', /direct deposit|payroll|salary/i, 0.6, 'high');
    this.addPattern('gmail-investment', 'Finance', 'finance.investment_signal', /401k|ira|brokerage|dividend|portfolio/i, 0.6, 'high');
    this.addPattern('gmail-savings', 'Finance', 'finance.savings_signal', /savings|high.?yield|apy/i, 0.5, 'high');

    // Subscription patterns
    this.addPattern('gmail-streaming', 'Subscriptions', 'subscriptions.categories', /netflix|hulu|disney|hbo|prime video|paramount/i, 0.8, 'low');
    this.addPattern('gmail-music', 'Subscriptions', 'subscriptions.categories', /spotify|apple music|tidal|pandora|audible/i, 0.8, 'low');
    this.addPattern('gmail-news', 'Subscriptions', 'subscriptions.categories', /nytimes|wsj|economist|washington post|substack/i, 0.8, 'low');
    this.addPattern('gmail-productivity', 'Subscriptions', 'subscriptions.categories', /figma|adobe|notion|slack|github|dropbox/i, 0.8, 'low');
    this.addPattern('gmail-gym', 'Subscriptions', 'subscriptions.categories', /gym|equinox|orangetheory|crossfit|planet fitness|peloton|classpass/i, 0.8, 'low');

    // Health & Fitness patterns
    this.addPattern('gmail-running', 'Health & Fitness', 'fitness.activities', /run|running|5k|10k|half marathon|marathon/i, 0.8, 'low');
    this.addPattern('gmail-yoga', 'Health & Fitness', 'fitness.activities', /yoga|pilates/i, 0.8, 'low');
    this.addPattern('gmail-cycling', 'Health & Fitness', 'fitness.activities', /cycling|bike|spin/i, 0.8, 'low');
    this.addPattern('gmail-strength', 'Health & Fitness', 'fitness.activities', /weight|strength|lifting|gym session/i, 0.8, 'low');
    this.addPattern('gmail-health-appt', 'Health & Fitness', 'health.appointments', /appointment|dr\.|dentist|dermatologist|annual|physical|checkup/i, 0.6, 'high');

    // Entertainment patterns
    this.addPattern('gmail-streaming-service', 'Entertainment', 'entertainment.streaming_services', /netflix|hulu|disney\+?|hbo max|max|peacock|paramount\+?|crunchyroll|apple tv/i, 0.85, 'low');
    this.addPattern('gmail-music-service', 'Entertainment', 'entertainment.music_genres', /spotify|apple music|tidal|pandora|youtube music/i, 0.8, 'low');
    this.addPattern('gmail-podcast', 'Entertainment', 'entertainment.podcast_preferences', /podcast|episode|listen/i, 0.6, 'low');
    this.addPattern('gmail-gaming', 'Entertainment', 'entertainment.gaming_platforms', /playstation|ps5|xbox|nintendo|steam|epic games/i, 0.8, 'low');

    // Home & Living patterns
    this.addPattern('gmail-smart-home', 'Home & Living', 'home.smart_devices', /alexa|google home|echo|nest|ring|philips hue|homekit|smart speaker/i, 0.8, 'low');
    this.addPattern('gmail-pet-supply', 'Home & Living', 'home.pets', /chewy|petco|petsmart|dog food|cat food|pet supplies/i, 0.75, 'low');
    this.addPattern('gmail-furniture', 'Home & Living', 'home.furniture_style', /wayfair|ikea|west elm|pottery barn|crate.{0,5}barrel|restoration hardware/i, 0.7, 'low');
    this.addPattern('gmail-garden', 'Home & Living', 'home.garden_preferences', /garden|seeds|plant|nursery|compost|fertilizer/i, 0.65, 'low');

    // Health & Wellness patterns
    this.addPattern('gmail-supplements', 'Health & Wellness', 'health.supplements', /vitamin|supplement|protein powder|probiotic|omega|collagen|magnesium/i, 0.75, 'medium');
    this.addPattern('gmail-allergy', 'Health & Wellness', 'health.allergies', /allergy|allergist|antihistamine|epipen|allergen/i, 0.7, 'high');
    this.addPattern('gmail-meditation', 'Health & Wellness', 'health.mental_health', /headspace|calm app|meditation|mindfulness/i, 0.75, 'medium');
    this.addPattern('gmail-therapy', 'Health & Wellness', 'health.mental_health', /therapy|therapist|counseling|betterhelp|talkspace/i, 0.65, 'high');

    // Enriched Shopping patterns
    this.addPattern('gmail-return', 'Shopping', 'shopping.return_frequency', /return|refund|exchange|rma/i, 0.6, 'low');
    this.addPattern('gmail-seasonal', 'Shopping', 'shopping.seasonal_patterns', /black friday|cyber monday|prime day|holiday sale|back.?to.?school/i, 0.7, 'low');

    // Enriched Travel patterns
    this.addPattern('gmail-hotel-chain', 'Travel', 'travel.hotel_chain', /marriott|hilton|hyatt|ihg|best western|wyndham|four seasons|ritz/i, 0.85, 'low');

    // Enriched Fitness patterns
    this.addPattern('gmail-competition', 'Fitness', 'fitness.competition', /race|marathon|triathlon|tournament|5k|10k|spartan|ironman/i, 0.8, 'low');
    this.addPattern('gmail-equipment', 'Fitness', 'fitness.equipment_owned', /treadmill|peloton|rowing|dumbbells?|kettlebell|resistance band|yoga mat|foam roller/i, 0.75, 'low');
  }

  private processEmails() {
    for (const email of this.emails) {
      const senderDomain = this.extractDomain(email.from);
      this.categorizeAndExtract(email, senderDomain);
    }
    this.organizeExtractedFacts();
    this.generatePersonas();
  }

  private extractDomain(from: string): string {
    const match = from.match(/@([a-zA-Z0-9.-]+)/);
    return match ? normalizeSenderDomain(match[1]) : '';
  }

  private incrementCategory(category: string) {
    this.categoryCounts[category] = (this.categoryCounts[category] || 0) + 1;
  }

  private categorizeAndExtract(email: GmailEmail, domain: string) {
    const combinedText = `${email.subject} ${email.body}`;
    const lowerText = combinedText.toLowerCase();
    const lowerSubject = email.subject.toLowerCase();
    const shoppingSender = resolveSenderLabel(SHOPPING_SENDERS, domain);
    const travelSender = resolveSenderLabel(TRAVEL_SENDERS, domain);
    const foodSender = resolveSenderLabel(FOOD_SENDERS, domain);
    const financeSender = resolveSenderLabel(FINANCE_SENDERS, domain);
    const subscriptionSender = resolveSenderLabel(SUBSCRIPTION_SENDERS, domain);
    const healthSender = resolveSenderLabel(HEALTH_SENDERS, domain);
    const entertainmentSender = resolveSenderLabel(ENTERTAINMENT_SENDERS, domain);
    const homeSender = resolveSenderLabel(HOME_SENDERS, domain);
    const wellnessSender = resolveSenderLabel(WELLNESS_SENDERS, domain);

    // Shopping / Order confirmations
    if (!foodSender && (shoppingSender || lowerSubject.match(/order|confirmation|receipt|shipped|delivered/))) {
      this.incrementCategory('shopping');
      this.extractShoppingFacts(email, combinedText, lowerText, domain);
    }

    // Travel
    if (travelSender || lowerSubject.match(/flight|booking|reservation|itinerary|check-?in/)) {
      this.incrementCategory('travel');
      this.extractTravelFacts(email, combinedText, lowerText, domain);
    }

    // Food & Dining
    if (foodSender || lowerSubject.match(/delivery|restaurant|reservation|order.*(food|meal)/)) {
      this.incrementCategory('food');
      this.extractFoodFacts(email, combinedText, lowerText, domain);
    }

    // Finance
    if (financeSender || lowerSubject.match(/statement|payment|balance|deposit|transfer/)) {
      this.incrementCategory('finance');
      this.extractFinanceFacts(email, combinedText, lowerText, domain);
    }

    // Subscriptions
    if (subscriptionSender || lowerSubject.match(/subscription|renewal|billing|monthly charge/)) {
      this.incrementCategory('subscriptions');
      this.extractSubscriptionFacts(email, combinedText, lowerText, domain);
    }

    // Health & Fitness
    if (healthSender || lowerSubject.match(/workout|appointment|gym|fitness|health/)) {
      this.incrementCategory('health');
      this.extractHealthFacts(email, combinedText, lowerText, domain);
    }

    // Entertainment
    if (entertainmentSender || lowerSubject.match(/streaming|watch|gaming|playlist|episode/)) {
      this.incrementCategory('entertainment');
      this.extractEntertainmentFacts(email, combinedText, lowerText, domain);
    }

    // Home & Living
    if (homeSender || lowerSubject.match(/furniture|home|pet|garden|smart home/)) {
      this.incrementCategory('home');
      this.extractHomeLivingFacts(email, combinedText, lowerText, domain);
    }

    // Wellness
    if (wellnessSender || lowerSubject.match(/meditation|therapy|wellness|mental health|supplement/)) {
      this.incrementCategory('wellness');
      this.extractWellnessFacts(email, combinedText, lowerText, domain);
    }
  }

  // ── Shopping extraction ──

  private extractShoppingFacts(email: GmailEmail, text: string, lowerText: string, domain: string) {
    const source = `Gmail: ${email.subject}`;
    const brand = resolveSenderLabel(SHOPPING_SENDERS, domain);

    if (brand) {
      this.addSourceFact('apparel.preferred_brands', brand, 0.7, 'low', source, email.id, 'gmail-brand');
    }

    // Extract sizes from order details
    const waistMatch = lowerText.match(SIZE_PATTERNS.waist);
    if (waistMatch) {
      this.addSourceFact('apparel.pants.waist', waistMatch[1], 0.9, 'medium', source, email.id, 'gmail-waist');
    }

    const inseamMatch = lowerText.match(SIZE_PATTERNS.inseam);
    if (inseamMatch) {
      this.addSourceFact('apparel.pants.inseam', inseamMatch[1], 0.9, 'medium', source, email.id, 'gmail-inseam');
    }

    const shirtMatch = lowerText.match(SIZE_PATTERNS.shirtSize);
    if (shirtMatch && lowerText.match(/shirt|tee|top|polo|button/)) {
      this.addSourceFact('apparel.shirt.size', shirtMatch[2] || shirtMatch[1], 0.85, 'medium', source, email.id, 'gmail-shirt-size');
    }

    const shoeMatch = SIZE_PATTERNS.shoeSize.exec(lowerText);
    if (shoeMatch) {
      const matchIndex = shoeMatch.index ?? 0;
      const contextStart = Math.max(0, matchIndex - 30);
      const contextEnd = Math.min(lowerText.length, matchIndex + 45);
      const shoeContext = lowerText.slice(contextStart, contextEnd);
      const hasShoeContext = /\b(shoe|sneaker|boot|cleat|loafer|heel|sandal)\b/i.test(shoeContext);
      const size = Number.parseFloat(shoeMatch[1]);
      if (hasShoeContext && Number.isFinite(size) && size >= 3 && size <= 18) {
        this.addSourceFact('apparel.shoe.size', shoeMatch[1], 0.85, 'medium', source, email.id, 'gmail-shoe-size');
      }
    }

    // Extract spending signal (range, not exact)
    const prices = [...text.matchAll(PRICE_PATTERN)].map(m => parseFloat(m[1]));
    const hasClothingContext = CLOTHING_CONTEXT_PATTERN.test(lowerText);
    const hasFoodDeliverySignal = FOOD_DELIVERY_PATTERN.test(lowerText);
    if (prices.length > 0 && hasClothingContext && !hasFoodDeliverySignal) {
      const maxPrice = Math.max(...prices);
      if (maxPrice < 50) {
        this.addSourceFact('budget.monthly_clothing', 'budget-friendly ($0-50 range)', 0.5, 'medium', source, email.id, 'gmail-price');
      } else if (maxPrice < 150) {
        this.addSourceFact('budget.monthly_clothing', 'mid-range ($50-150 range)', 0.5, 'medium', source, email.id, 'gmail-price');
      } else if (maxPrice < 500) {
        this.addSourceFact('budget.monthly_clothing', 'premium ($150-500 range)', 0.5, 'medium', source, email.id, 'gmail-price');
      }
    }

    // Detect product categories (tech, books, clothing)
    if (lowerText.match(/macbook|iphone|ipad|airpods|kindle|echo|pixel|galaxy/)) {
      this.addSourceFact('shopping.categories', 'tech/electronics', 0.7, 'low', source, email.id, 'gmail-tech-products');
    }
    if (lowerText.match(/paperback|hardcover|kindle edition|audiobook|isbn/)) {
      this.addSourceFact('shopping.categories', 'books', 0.7, 'low', source, email.id, 'gmail-book-products');
    }
    if (lowerText.match(/shirt|pants|jacket|shoes|sneakers|boots|dress|coat/)) {
      this.addSourceFact('shopping.categories', 'clothing', 0.7, 'low', source, email.id, 'gmail-clothing-products');
    }
  }

  // ── Travel extraction ──

  private extractTravelFacts(email: GmailEmail, text: string, lowerText: string, domain: string) {
    const source = `Gmail: ${email.subject}`;

    // Airline preference
    const airline = resolveSenderLabel(TRAVEL_SENDERS, domain);
    if (airline && (airline.includes('Airlines') || airline.includes('Air Lines') || airline.includes('Southwest'))) {
      this.addSourceFact('travel.airline_preference', airline, 0.8, 'low', source, email.id, 'gmail-airline');
    }

    // Hotel preference
    if (airline === 'Marriott' || airline === 'Hilton') {
      this.addSourceFact('hotel.room_preference', airline, 0.8, 'low', source, email.id, 'gmail-hotel');
    }
    if (airline === 'Airbnb') {
      this.addSourceFact('hotel.room_preference', 'Airbnb / vacation rentals', 0.8, 'low', source, email.id, 'gmail-hotel');
    }
    if (lowerText.match(/boutique|design hotel|independent hotel/)) {
      this.addSourceFact('hotel.room_preference', 'boutique hotels', 0.85, 'low', source, email.id, 'gmail-boutique-hotel');
    }

    // Destinations
    const destinations = [...text.matchAll(DESTINATION_PATTERN)];
    for (const match of destinations) {
      const dest = match[1].trim();
      if (dest.length > 2 && dest.length < 40 && !DESTINATION_BLOCKLIST.has(dest.toLowerCase())) {
        this.addSourceFact('travel.favorite_destinations', dest.toLowerCase(), 0.65, 'low', source, email.id, 'gmail-destination');
      }
    }

    // Seat preference
    if (lowerText.includes('window seat')) {
      this.addSourceFact('flight.seat_preference', 'window seat', 0.9, 'low', source, email.id, 'gmail-window-seat');
    } else if (lowerText.includes('aisle seat')) {
      this.addSourceFact('flight.seat_preference', 'aisle seat', 0.9, 'low', source, email.id, 'gmail-aisle-seat');
    }

    // Cabin class
    if (lowerText.match(/first class|business class/)) {
      this.addSourceFact('travel.cabin_preference', 'premium cabin', 0.8, 'low', source, email.id, 'gmail-premium-cabin');
    } else if (lowerText.match(/economy|coach/)) {
      this.addSourceFact('travel.cabin_preference', 'economy', 0.6, 'low', source, email.id, 'gmail-economy-cabin');
    }

    // Loyalty programs
    const loyaltyMatch = text.match(LOYALTY_PATTERN);
    if (loyaltyMatch) {
      // Store program name only, not account number
      const programName = loyaltyMatch[0].split(/[:\s#]/)[0];
      this.addSourceFact('travel.loyalty_programs', programName, 0.9, 'medium', source, email.id, 'gmail-loyalty');
    }

    // TSA PreCheck / Global Entry
    if (lowerText.match(/tsa\s*pre\s*check|global\s*entry|clear\s*plus|nexus/)) {
      this.addSourceFact('travel.loyalty_programs', 'TSA PreCheck', 0.9, 'medium', source, email.id, 'gmail-tsa-precheck');
    }
  }

  // ── Food & Dining extraction ──

  private extractFoodFacts(email: GmailEmail, _text: string, lowerText: string, domain: string) {
    const source = `Gmail: ${email.subject}`;
    const service = resolveSenderLabel(FOOD_SENDERS, domain);

    if (service) {
      this.addSourceFact('food.delivery_services', service, 0.8, 'low', source, email.id, 'gmail-food-service');
    }

    // Cuisine preferences from restaurant names / order details
    for (const cuisine of CUISINE_PATTERNS) {
      if (lowerText.includes(cuisine)) {
        this.addSourceFact('food.favorite_cuisines', cuisine, 0.7, 'low', source, email.id, 'gmail-cuisine');
      }
    }

    // Dietary signals
    if (lowerText.match(/vegetarian|veggie|plant-?based/)) {
      this.addSourceFact('dietary.restrictions', 'vegetarian', 0.75, 'medium', source, email.id, 'gmail-vegetarian');
    }
    if (lowerText.match(/vegan/)) {
      this.addSourceFact('dietary.restrictions', 'vegan', 0.75, 'medium', source, email.id, 'gmail-vegan');
    }
    if (lowerText.match(/gluten.?free/)) {
      this.addSourceFact('dietary.restrictions', 'gluten-free', 0.75, 'medium', source, email.id, 'gmail-gluten-free');
    }
    if (lowerText.match(/dairy.?free|lactose/)) {
      this.addSourceFact('dietary.restrictions', 'dairy-free', 0.75, 'medium', source, email.id, 'gmail-dairy-free');
    }
    if (lowerText.match(/nut.?free|peanut allergy|tree nut allergy/)) {
      this.addSourceFact('dietary.allergies', 'nut allergy', 0.9, 'high', source, email.id, 'gmail-nut-allergy');
    }
    if (lowerText.match(/shellfish allergy|no shellfish/)) {
      this.addSourceFact('dietary.allergies', 'shellfish', 0.9, 'high', source, email.id, 'gmail-shellfish-allergy');
    }
    if (lowerText.match(/pescatarian/)) {
      this.addSourceFact('dietary.restrictions', 'pescatarian', 0.85, 'medium', source, email.id, 'gmail-pescatarian');
    }
  }

  // ── Finance extraction (signal only, no exact numbers) ──

  private extractFinanceFacts(email: GmailEmail, _text: string, lowerText: string, domain: string) {
    const source = `Gmail: ${email.subject}`;
    const institution = resolveSenderLabel(FINANCE_SENDERS, domain);

    if (institution) {
      this.addSourceFact('finance.institutions', institution, 0.7, 'high', source, email.id, 'gmail-finance-inst');
    }

    // Salary range signals — broad buckets only
    if (lowerText.match(/direct deposit|payroll|salary/)) {
      this.addSourceFact('finance.income_signal', 'has regular direct deposits', 0.6, 'high', source, email.id, 'gmail-direct-deposit');
    }

    // Investment signals
    if (lowerText.match(/401k|ira|brokerage|dividend|portfolio/)) {
      this.addSourceFact('finance.investment_signal', 'active investor', 0.6, 'high', source, email.id, 'gmail-investment');
    }

    // Banking features
    if (lowerText.match(/savings|high.?yield|apy/)) {
      this.addSourceFact('finance.savings_signal', 'has savings accounts', 0.5, 'high', source, email.id, 'gmail-savings');
    }
  }

  // ── Subscription extraction ──

  private extractSubscriptionFacts(email: GmailEmail, _text: string, lowerText: string, domain: string) {
    const source = `Gmail: ${email.subject}`;
    const service = resolveSenderLabel(SUBSCRIPTION_SENDERS, domain);

    if (service) {
      this.addSourceFact('subscriptions.services', service, 0.9, 'low', source, email.id, 'gmail-sub-service');
    }

    // Detect streaming vs productivity vs news
    if (lowerText.match(/netflix|hulu|disney|hbo|prime video|paramount/)) {
      this.addSourceFact('subscriptions.categories', 'streaming', 0.8, 'low', source, email.id, 'gmail-streaming');
    }
    if (lowerText.match(/spotify|apple music|tidal|pandora|audible/)) {
      this.addSourceFact('subscriptions.categories', 'music/audio', 0.8, 'low', source, email.id, 'gmail-music');
    }
    if (lowerText.match(/nytimes|wsj|economist|washington post|substack/)) {
      this.addSourceFact('subscriptions.categories', 'news/publications', 0.8, 'low', source, email.id, 'gmail-news');
    }
    if (lowerText.match(/figma|adobe|notion|slack|github|dropbox/)) {
      this.addSourceFact('subscriptions.categories', 'productivity tools', 0.8, 'low', source, email.id, 'gmail-productivity');
    }

    // Gym memberships
    if (lowerText.match(/gym|equinox|orangetheory|crossfit|planet fitness|peloton|classpass/)) {
      this.addSourceFact('subscriptions.categories', 'fitness', 0.8, 'low', source, email.id, 'gmail-gym');
    }
  }

  // ── Health & Fitness extraction ──

  private extractHealthFacts(email: GmailEmail, _text: string, lowerText: string, domain: string) {
    const source = `Gmail: ${email.subject}`;
    const service = resolveSenderLabel(HEALTH_SENDERS, domain);

    if (service) {
      this.addSourceFact('fitness.apps', service, 0.85, 'low', source, email.id, 'gmail-health-app');
    }

    // Fitness activity types
    if (lowerText.match(/run|running|5k|10k|half marathon|marathon/)) {
      this.addSourceFact('fitness.activities', 'running', 0.8, 'low', source, email.id, 'gmail-running');
    }
    if (lowerText.match(/yoga|pilates/)) {
      this.addSourceFact('fitness.activities', 'yoga/pilates', 0.8, 'low', source, email.id, 'gmail-yoga');
    }
    if (lowerText.match(/cycling|bike|spin/)) {
      this.addSourceFact('fitness.activities', 'cycling', 0.8, 'low', source, email.id, 'gmail-cycling');
    }
    if (lowerText.match(/weight|strength|lifting|gym session/)) {
      this.addSourceFact('fitness.activities', 'strength training', 0.8, 'low', source, email.id, 'gmail-strength');
    }

    // Health appointments
    if (lowerText.match(/appointment|dr\.|dentist|dermatologist|annual|physical|checkup/)) {
      this.addSourceFact('health.appointments', 'regular health checkups', 0.6, 'high', source, email.id, 'gmail-health-appt');
    }
  }

  // ── Entertainment extraction ──

  private extractEntertainmentFacts(email: GmailEmail, _text: string, lowerText: string, domain: string) {
    const source = `Gmail: ${email.subject}`;
    const service = resolveSenderLabel(ENTERTAINMENT_SENDERS, domain);

    if (service) {
      if (['Netflix', 'Hulu', 'Disney+', 'HBO Max'].includes(service)) {
        this.addSourceFact('entertainment.streaming_services', service, 0.9, 'low', source, email.id, 'gmail-streaming-service');
      }
      if (['PlayStation', 'Xbox', 'Nintendo', 'Steam', 'Epic Games'].includes(service)) {
        this.addSourceFact('entertainment.gaming_platforms', service, 0.85, 'low', source, email.id, 'gmail-gaming');
      }
      if (['Spotify', 'Twitch'].includes(service)) {
        this.addSourceFact('entertainment.streaming_services', service, 0.85, 'low', source, email.id, 'gmail-streaming-service');
      }
    }

    // Podcast signals
    if (lowerText.match(/podcast|new episode|listen now/)) {
      this.addSourceFact('entertainment.podcast_preferences', 'podcast listener', 0.7, 'low', source, email.id, 'gmail-podcast');
    }
  }

  // ── Home & Living extraction ──

  private extractHomeLivingFacts(email: GmailEmail, _text: string, lowerText: string, domain: string) {
    const source = `Gmail: ${email.subject}`;
    const store = resolveSenderLabel(HOME_SENDERS, domain);

    if (store) {
      if (['Chewy', 'Petco', 'PetSmart'].includes(store)) {
        this.addSourceFact('home.pets', 'pet owner', 0.8, 'low', source, email.id, 'gmail-pet-supply');
      } else {
        this.addSourceFact('home.furniture_style', store, 0.65, 'low', source, email.id, 'gmail-furniture');
      }
    }

    // Smart home
    if (lowerText.match(/alexa|echo|google home|nest|ring|philips hue|homekit|smart/)) {
      this.addSourceFact('home.smart_devices', 'smart home user', 0.75, 'low', source, email.id, 'gmail-smart-home');
    }

    // Garden
    if (lowerText.match(/garden|seeds|plant|nursery|compost/)) {
      this.addSourceFact('home.garden_preferences', 'gardener', 0.7, 'low', source, email.id, 'gmail-garden');
    }
  }

  // ── Wellness extraction ──

  private extractWellnessFacts(email: GmailEmail, _text: string, lowerText: string, domain: string) {
    const source = `Gmail: ${email.subject}`;
    const service = resolveSenderLabel(WELLNESS_SENDERS, domain);

    if (service) {
      if (['Headspace', 'Calm'].includes(service)) {
        this.addSourceFact('health.mental_health', 'meditation', 0.8, 'medium', source, email.id, 'gmail-meditation');
      }
      if (['BetterHelp', 'Talkspace'].includes(service)) {
        this.addSourceFact('health.mental_health', 'therapy', 0.75, 'high', source, email.id, 'gmail-therapy');
      }
    }

    // Supplements
    if (lowerText.match(/vitamin|supplement|protein|probiotic|omega|collagen|magnesium/)) {
      this.addSourceFact('health.supplements', 'takes supplements', 0.75, 'medium', source, email.id, 'gmail-supplements');
    }

    // Allergies from medical emails
    if (lowerText.match(/allergy|allergist|antihistamine|epipen/)) {
      this.addSourceFact('health.allergies', 'has allergies', 0.7, 'high', source, email.id, 'gmail-allergy');
    }
  }

  // ── Persona generation ──

  private generatePersonas() {
    this.personas = generatePersonas(this.extractedFacts);
  }

  // ── Public API ──

  public getPersonas(): Persona[] {
    return this.personas;
  }

  public override getAllFacts(): Fact[] {
    return this.extractedFacts;
  }

  public getCategoryCounts(): Record<string, number> {
    return { ...this.categoryCounts };
  }

  public generateProfileSummary(): ProfileSummary {
    const shoppingFacts = this.extractedFacts.filter(f => f.key.startsWith('apparel') || f.key.startsWith('shopping') || f.key.startsWith('budget.monthly'));
    const travelFacts = this.extractedFacts.filter(f => f.key.startsWith('travel') || f.key.startsWith('hotel') || f.key.startsWith('flight'));
    const foodFacts = this.extractedFacts.filter(f => f.key.startsWith('dietary') || f.key.startsWith('food'));
    const fitnessFacts = this.extractedFacts.filter(f => f.key.startsWith('fitness') || f.key.startsWith('health'));
    const subFacts = this.extractedFacts.filter(f => f.key.startsWith('subscriptions'));

    let narrative = 'Based on your email patterns, ';

    if (shoppingFacts.length > 0) {
      const brands = shoppingFacts.filter(f => f.key === 'apparel.preferred_brands').map(f => f.value);
      if (brands.length > 0) {
        narrative += `you frequently shop at ${brands.slice(0, 3).join(', ')}. `;
      }
    }

    if (travelFacts.length > 0) {
      const airlines = travelFacts.filter(f => f.key === 'travel.airline_preference').map(f => f.value);
      const destinations = travelFacts.filter(f => f.key === 'travel.favorite_destinations').map(f => f.value);
      if (airlines.length > 0) {
        narrative += `You travel with ${airlines[0]}`;
        if (destinations.length > 0) {
          narrative += ` to places like ${destinations.slice(0, 2).join(' and ')}`;
        }
        narrative += '. ';
      }
    }

    if (foodFacts.length > 0) {
      const cuisines = foodFacts.filter(f => f.key === 'food.favorite_cuisines').map(f => f.value);
      const dietary = foodFacts.filter(f => f.key === 'dietary.restrictions').map(f => f.value);
      if (dietary.length > 0) {
        narrative += `You follow a ${dietary[0]} diet. `;
      }
      if (cuisines.length > 0) {
        narrative += `You enjoy ${cuisines.slice(0, 3).join(', ')} cuisine. `;
      }
    }

    if (fitnessFacts.length > 0) {
      const activities = fitnessFacts.filter(f => f.key === 'fitness.activities').map(f => f.value);
      if (activities.length > 0) {
        narrative += `You stay active with ${activities.join(' and ')}. `;
      }
    }

    if (subFacts.length > 0) {
      const services = this.extractedFacts.filter(f => f.key === 'subscriptions.services').map(f => f.value);
      if (services.length > 0) {
        narrative += `You subscribe to ${services.slice(0, 3).join(', ')}.`;
      }
    }

    const keyTraits: string[] = [];
    if (shoppingFacts.length > 2) keyTraits.push('Active online shopper');
    if (travelFacts.length > 2) keyTraits.push('Frequent traveler');
    if (foodFacts.length > 1) keyTraits.push('Food enthusiast');
    if (fitnessFacts.length > 1) keyTraits.push('Fitness-focused');
    if (subFacts.length > 1) keyTraits.push('Digital subscriber');

    const totalFacts = this.extractedFacts.length;
    const avgConfidence = totalFacts > 0
      ? this.extractedFacts.reduce((sum, f) => sum + f.confidence, 0) / totalFacts
      : 0;

    return {
      narrative: narrative.trim(),
      keyTraits,
      confidence: avgConfidence,
    };
  }

  public generateFollowUpQuestions(): FollowUpQuestion[] {
    const questions: FollowUpQuestion[] = [];

    const hasAirline = this.extractedFacts.some(f => f.key === 'travel.airline_preference');
    const hasSeat = this.extractedFacts.some(f => f.key === 'flight.seat_preference');
    if (hasAirline && !hasSeat) {
      questions.push({
        id: 'gmail-seat-preference',
        persona: 'Travel',
        question: 'We see you fly often. Do you prefer window or aisle seats?',
        type: 'multiple-choice',
        options: ['Window', 'Aisle', 'No preference'],
        importance: 'low',
      });
    }

    const hasBrands = this.extractedFacts.some(f => f.key === 'apparel.preferred_brands');
    const hasSize = this.extractedFacts.some(f => f.key === 'apparel.shirt.size');
    if (hasBrands && !hasSize) {
      questions.push({
        id: 'gmail-shirt-size',
        persona: 'Shopping',
        question: 'We found shopping receipts but no clothing sizes. What is your shirt size?',
        type: 'multiple-choice',
        options: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
        importance: 'medium',
      });
    }

    const hasCuisine = this.extractedFacts.some(f => f.key === 'food.favorite_cuisines');
    const hasDietary = this.extractedFacts.some(f => f.key === 'dietary.restrictions');
    if (hasCuisine && !hasDietary) {
      questions.push({
        id: 'gmail-dietary',
        persona: 'Food & Dining',
        question: 'We see food delivery orders. Do you have any dietary restrictions?',
        type: 'text',
        importance: 'medium',
      });
    }

    const hasFinance = this.extractedFacts.some(f => f.key === 'finance.institutions');
    if (hasFinance) {
      questions.push({
        id: 'gmail-budget-comfort',
        persona: 'Shopping',
        question: 'What is your typical monthly budget for discretionary spending?',
        type: 'multiple-choice',
        options: ['Under $200', '$200-500', '$500-1000', '$1000+', 'Prefer not to say'],
        importance: 'low',
      });
    }

    return questions.sort((a, b) => {
      const order = { high: 3, medium: 2, low: 1 };
      return order[b.importance] - order[a.importance];
    });
  }
}
