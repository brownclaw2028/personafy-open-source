// 10 demo scenarios — 2 per persona — with pre-built facts, de-identification, and responses.

export interface DemoFact {
  key: string;
  value: string;
  sensitivity: 'low' | 'medium' | 'high';
  confidence: number;
}

export interface DeidentifyMapping {
  factKey: string;
  original: string;
  masked: string;
  method: 'generalize' | 'mask' | 'redact';
}

export interface DemoScenario {
  id: string;
  personaId: string;
  label: string;
  agentQuery: string;
  agentDomain: string;
  fieldsRequested: string[];
  facts: DemoFact[];
  deidentifyMappings: DeidentifyMapping[];
  agentResponse: string;
}

export const DEMO_SCENARIOS: DemoScenario[] = [
  // ── Alex Chen ──
  {
    id: 'alex-running-pants',
    personaId: 'alex',
    label: 'Find running pants',
    agentQuery: 'Find me lightweight running pants for trail running in cool weather.',
    agentDomain: 'shopping-agent.ai',
    fieldsRequested: ['apparel.*', 'fitness.*'],
    facts: [
      { key: 'apparel.pants.waist', value: '32', sensitivity: 'low', confidence: 0.95 },
      { key: 'apparel.pants.inseam', value: '32', sensitivity: 'low', confidence: 0.90 },
      { key: 'apparel.fit_preference', value: 'slim athletic', sensitivity: 'low', confidence: 0.85 },
      { key: 'apparel.material_likes', value: 'merino wool, recycled polyester', sensitivity: 'low', confidence: 0.80 },
      { key: 'fitness.running_shoes', value: 'Hoka Speedgoat 5, Size 10.5', sensitivity: 'low', confidence: 0.92 },
      { key: 'fitness.goal', value: 'trail ultramarathon training', sensitivity: 'low', confidence: 0.88 },
    ],
    deidentifyMappings: [],
    agentResponse: 'Based on your 32" waist, slim athletic fit preference, and love for sustainable materials, here are 3 trail running pants perfect for ultramarathon training:\n\n1. Patagonia Terrebonne Joggers (recycled polyester, slim fit)\n2. Arc\'teryx Norvan Shell Pants (lightweight, 32" inseam)\n3. Nike Trail Running Pants (Dri-FIT, athletic cut)',
  },
  {
    id: 'alex-trail-race',
    personaId: 'alex',
    label: 'Book a trail race trip',
    agentQuery: 'Help me book a trip to Portland for a trail running race next month.',
    agentDomain: 'travel-agent.ai',
    fieldsRequested: ['travel.*', 'fitness.*'],
    facts: [
      { key: 'travel.favorite_destinations', value: 'Pacific Northwest, Colorado', sensitivity: 'low', confidence: 0.85 },
      { key: 'travel.frequency', value: '4-6 trips/year', sensitivity: 'low', confidence: 0.80 },
      { key: 'fitness.goal', value: 'trail ultramarathon training', sensitivity: 'low', confidence: 0.88 },
      { key: 'fitness.frequency', value: '5-6 days/week', sensitivity: 'low', confidence: 0.90 },
      { key: 'travel.loyalty_programs', value: 'Alaska Airlines MVP, Marriott Bonvoy Gold', sensitivity: 'medium', confidence: 0.75 },
    ],
    deidentifyMappings: [
      { factKey: 'travel.loyalty_programs', original: 'Alaska Airlines MVP, Marriott Bonvoy Gold', masked: 'Airline loyalty (mid-tier), Hotel loyalty (mid-tier)', method: 'generalize' },
    ],
    agentResponse: 'Great choice — Portland\'s trail scene is perfect for your ultramarathon training! Here\'s a plan:\n\n- Flight: Alaska Airlines SEA→PDX (leveraging your loyalty status)\n- Hotel: Marriott Downtown Portland (Bonvoy member rate)\n- Trail recommendations: Forest Park, Wildwood Trail\n- Pre-race meal spots with runner-friendly menus',
  },

  // ── Sarah Mitchell ──
  {
    id: 'sarah-wine-dinner',
    personaId: 'sarah',
    label: 'Recommend wines for dinner',
    agentQuery: 'Recommend wines for a dinner party I\'m hosting this weekend. Serving lamb.',
    agentDomain: 'sommelier-agent.ai',
    fieldsRequested: ['food.*', 'dietary.*'],
    facts: [
      { key: 'food.favorite_cuisines', value: 'French, Italian, Mediterranean', sensitivity: 'low', confidence: 0.92 },
      { key: 'food.coffee_preferences', value: 'single-origin pour-over', sensitivity: 'low', confidence: 0.80 },
      { key: 'dietary.restrictions', value: 'none', sensitivity: 'low', confidence: 0.95 },
      { key: 'dietary.allergies', value: 'none', sensitivity: 'medium', confidence: 0.90 },
    ],
    deidentifyMappings: [
      { factKey: 'dietary.allergies', original: 'none', masked: 'no known allergies', method: 'generalize' },
    ],
    agentResponse: 'For your lamb dinner with a French/Mediterranean flair, I recommend:\n\n1. Châteauneuf-du-Pape (bold Rhône red, perfect with lamb)\n2. Barolo 2018 (Italian elegance, great with roasted meats)\n3. A crisp Sancerre as a starter white\n\nSince you enjoy single-origin coffee, you might also appreciate a digestif like Armagnac.',
  },
  {
    id: 'sarah-napa-trip',
    personaId: 'sarah',
    label: 'Plan Napa getaway',
    agentQuery: 'Plan a luxury wine tasting weekend in Napa Valley for two.',
    agentDomain: 'travel-agent.ai',
    fieldsRequested: ['travel.*', 'hotel.*'],
    facts: [
      { key: 'travel.favorite_destinations', value: 'Napa Valley, Tuscany, Provence', sensitivity: 'low', confidence: 0.88 },
      { key: 'hotel.room_preference', value: 'suite with vineyard view', sensitivity: 'low', confidence: 0.82 },
      { key: 'hotel.room_dislikes', value: 'street-facing rooms, no balcony', sensitivity: 'low', confidence: 0.78 },
      { key: 'travel.loyalty_programs', value: 'Hyatt Globalist, Delta Diamond', sensitivity: 'medium', confidence: 0.85 },
    ],
    deidentifyMappings: [
      { factKey: 'travel.loyalty_programs', original: 'Hyatt Globalist, Delta Diamond', masked: 'Hotel loyalty (top-tier), Airline loyalty (top-tier)', method: 'generalize' },
    ],
    agentResponse: 'Here\'s your luxury Napa weekend:\n\n- Stay: Alila Napa Valley (suite with vineyard view, leveraging your top-tier hotel status)\n- Day 1: Private tastings at Opus One + Stag\'s Leap\n- Day 2: Hot air balloon over vineyards + lunch at The French Laundry\n- Transportation: Private car service between wineries',
  },

  // ── Jordan Rivera ──
  {
    id: 'jordan-vintage-denim',
    personaId: 'jordan',
    label: 'Find vintage denim jackets',
    agentQuery: 'Find me authentic vintage denim jackets from the 70s or 80s.',
    agentDomain: 'shopping-agent.ai',
    fieldsRequested: ['apparel.*', 'budget.*'],
    facts: [
      { key: 'apparel.shirt.size', value: 'M', sensitivity: 'low', confidence: 0.90 },
      { key: 'apparel.fit_preference', value: 'oversized vintage', sensitivity: 'low', confidence: 0.88 },
      { key: 'apparel.preferred_brands', value: 'Levi\'s, Wrangler, Lee', sensitivity: 'low', confidence: 0.85 },
      { key: 'apparel.material_likes', value: 'raw denim, selvedge', sensitivity: 'low', confidence: 0.82 },
      { key: 'budget.monthly_clothing', value: '$200-400', sensitivity: 'medium', confidence: 0.75 },
    ],
    deidentifyMappings: [
      { factKey: 'budget.monthly_clothing', original: '$200-400', masked: 'mid-range budget', method: 'generalize' },
    ],
    agentResponse: 'Found 4 authentic vintage denim jackets matching your style:\n\n1. Levi\'s Type III Trucker (1978) — $185, oversized M fit\n2. Wrangler Western Denim (1982) — $145, raw denim\n3. Lee Storm Rider (1975) — $220, selvedge, lined\n4. Levi\'s Big E Jacket (1971) — $350, collector\'s piece\n\nAll within your budget and in your preferred oversized fit.',
  },
  {
    id: 'jordan-mexico-food',
    personaId: 'jordan',
    label: 'Plan Mexico City food tour',
    agentQuery: 'Plan a food tour in Mexico City — I want authentic street food and markets.',
    agentDomain: 'travel-agent.ai',
    fieldsRequested: ['travel.*', 'food.*'],
    facts: [
      { key: 'travel.favorite_destinations', value: 'Mexico City, Tokyo, Lisbon', sensitivity: 'low', confidence: 0.85 },
      { key: 'travel.frequency', value: '3-4 trips/year', sensitivity: 'low', confidence: 0.78 },
      { key: 'food.favorite_cuisines', value: 'Mexican, Japanese, Portuguese', sensitivity: 'low', confidence: 0.90 },
      { key: 'food.coffee_preferences', value: 'cortado, local roasters', sensitivity: 'low', confidence: 0.72 },
    ],
    deidentifyMappings: [],
    agentResponse: 'Here\'s your ultimate Mexico City food tour:\n\nDay 1: Mercado de la Merced + street tacos in Centro\nDay 2: Roma Norte food walk — Contramar (seafood tostadas) + local cortado spots\nDay 3: Coyoacán market + Xochimilco floating food stalls\n\nSince Mexican cuisine is one of your favorites, I\'ve included some hidden gems beyond the tourist spots.',
  },

  // ── Priya Sharma ──
  {
    id: 'priya-healthy-snacks',
    personaId: 'priya',
    label: 'Order healthy snacks',
    agentQuery: 'Order healthy after-school snacks for my three kids. No nuts!',
    agentDomain: 'grocery-agent.ai',
    fieldsRequested: ['dietary.*', 'food.*'],
    facts: [
      { key: 'dietary.restrictions', value: 'vegetarian household', sensitivity: 'low', confidence: 0.95 },
      { key: 'dietary.allergies', value: 'tree nuts (child), peanuts (child)', sensitivity: 'high', confidence: 0.98 },
      { key: 'food.favorite_cuisines', value: 'Indian, Mediterranean, Thai', sensitivity: 'low', confidence: 0.85 },
      { key: 'food.coffee_preferences', value: 'chai latte, turmeric latte', sensitivity: 'low', confidence: 0.70 },
    ],
    deidentifyMappings: [
      { factKey: 'dietary.allergies', original: 'tree nuts (child), peanuts (child)', masked: 'nut allergies present in household', method: 'generalize' },
    ],
    agentResponse: 'Here are nut-free, vegetarian snacks perfect for after school:\n\n1. Sunflower seed butter with apple slices\n2. Roasted chickpea bites (Indian spice blend!)\n3. Coconut yogurt parfaits with seeds\n4. Veggie samosas (mini, kid-friendly size)\n5. Rice cake sandwiches with cream cheese\n\nAll verified nut-free and vegetarian. Want me to add these to your grocery cart?',
  },
  {
    id: 'priya-family-resort',
    personaId: 'priya',
    label: 'Find family resort',
    agentQuery: 'Find a family-friendly beach resort for a week. Must accommodate dietary needs.',
    agentDomain: 'travel-agent.ai',
    fieldsRequested: ['travel.*', 'dietary.*'],
    facts: [
      { key: 'travel.favorite_destinations', value: 'Goa, Bali, Costa Rica', sensitivity: 'low', confidence: 0.82 },
      { key: 'travel.frequency', value: '2-3 family trips/year', sensitivity: 'low', confidence: 0.80 },
      { key: 'dietary.restrictions', value: 'vegetarian household', sensitivity: 'low', confidence: 0.95 },
      { key: 'dietary.allergies', value: 'tree nuts (child), peanuts (child)', sensitivity: 'high', confidence: 0.98 },
    ],
    deidentifyMappings: [
      { factKey: 'dietary.allergies', original: 'tree nuts (child), peanuts (child)', masked: 'nut allergies present in household', method: 'generalize' },
    ],
    agentResponse: 'Here are 3 family-friendly resorts with excellent allergy accommodations:\n\n1. Four Seasons Bali — dedicated kids\' club, nut-free kitchen option, vegetarian menu\n2. Andaz Costa Rica — allergy-aware dining, family suites, eco-tours\n3. Taj Exotica Goa — Indian vegetarian cuisine, allergy trained staff, kids\' pool\n\nAll three have confirmed nut-free meal preparation and vegetarian menus.',
  },

  // ── Marcus Thompson ──
  {
    id: 'marcus-woodworking-tools',
    personaId: 'marcus',
    label: 'Recommend woodworking tools',
    agentQuery: 'Recommend woodworking hand tools under $200 for building a dovetail workbench.',
    agentDomain: 'shopping-agent.ai',
    fieldsRequested: ['work.*', 'budget.*'],
    facts: [
      { key: 'work.tools', value: 'hand planes, chisels, marking gauges', sensitivity: 'low', confidence: 0.90 },
      { key: 'work.communication_style', value: 'detailed, methodical', sensitivity: 'low', confidence: 0.75 },
      { key: 'budget.monthly_clothing', value: '$100-200', sensitivity: 'medium', confidence: 0.70 },
    ],
    deidentifyMappings: [
      { factKey: 'budget.monthly_clothing', original: '$100-200', masked: 'moderate budget', method: 'generalize' },
    ],
    agentResponse: 'For your dovetail workbench project, here are hand tools within budget:\n\n1. Narex Premium Dovetail Chisel Set — $85 (great for precision joinery)\n2. Veritas Dovetail Saw — $79 (14 TPI, perfect for hardwoods)\n3. Starrett Combination Square — $45 (essential for layout)\n\nTotal: $209 — just above budget. The Narex set overlaps with your existing chisels, so you could skip it and come in at $124.',
  },
  {
    id: 'marcus-japanese-joinery',
    personaId: 'marcus',
    label: 'Find Japanese joinery books',
    agentQuery: 'Find me the best books on Japanese wood joinery techniques.',
    agentDomain: 'book-agent.ai',
    fieldsRequested: ['work.*', 'entertainment.*'],
    facts: [
      { key: 'work.tools', value: 'hand planes, chisels, marking gauges', sensitivity: 'low', confidence: 0.90 },
      { key: 'work.communication_style', value: 'detailed, methodical', sensitivity: 'low', confidence: 0.75 },
      { key: 'entertainment.reading_preferences', value: 'woodworking, Japanese craftsmanship, philosophy', sensitivity: 'low', confidence: 0.82 },
    ],
    deidentifyMappings: [],
    agentResponse: 'Here are the top Japanese joinery books, curated for your hand-tool focus:\n\n1. "The Art of Japanese Joinery" by Kiyosi Seike — foundational text\n2. "Japanese Woodworking Tools" by Toshio Odate — perfect for your hand plane interest\n3. "The Complete Japanese Joinery" by Hideo Sato — detailed diagrams\n4. "Japanese Wood Joints" — visual reference guide\n\nSince you appreciate detailed, methodical approaches, I\'d start with #2 — it bridges Western and Japanese hand tool techniques.',
  },
];

export function getScenariosForPersona(personaId: string): DemoScenario[] {
  return DEMO_SCENARIOS.filter((s) => s.personaId === personaId);
}
