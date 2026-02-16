// Canonical fact key helpers.
// This keeps legacy (underscore or older dotted) keys compatible with the current taxonomy.

const LEGACY_FACT_KEY_MAP: Record<string, string> = {
  // Shopping
  waist_size: 'apparel.pants.waist',
  inseam: 'apparel.pants.inseam',
  shirt_size: 'apparel.shirt.size',
  shoe_size: 'apparel.shoe.size',
  fit_preference: 'apparel.fit_preference',
  material_likes: 'apparel.material_likes',
  material_dislikes: 'apparel.material_dislikes',
  preferred_brands: 'apparel.preferred_brands',
  clothing_budget: 'budget.monthly_clothing',
  brand_loyalty: 'shopping.brand_loyalty',
  price_sensitivity: 'shopping.price_sensitivity',
  seasonal_patterns: 'shopping.seasonal_patterns',
  return_frequency: 'shopping.return_frequency',

  // Travel
  travel_frequency: 'travel.frequency',
  hotel_preference: 'hotel.room_preference',
  hotel_dislikes: 'hotel.room_dislikes',
  seat_preference: 'flight.seat_preference',
  travel_benefits: 'travel.loyalty_programs',
  frequent_destinations: 'travel.favorite_destinations',
  hotel_chain: 'travel.hotel_chain',
  travel_style: 'travel.travel_style',
  trip_frequency: 'travel.trip_frequency',

  // Food & Dining
  dietary_restrictions: 'dietary.restrictions',
  food_allergies: 'dietary.allergies',
  cuisine_preferences: 'food.favorite_cuisines',
  coffee_preferences: 'food.coffee_preferences',
  cooking_frequency: 'food.cooking_frequency',
  meal_prep: 'food.meal_prep',
  restaurant_budget: 'food.restaurant_budget',
  cuisine_exploration: 'food.cuisine_exploration',

  // Work
  work_tools: 'work.tools',
  communication_style: 'work.communication_style',

  // Fitness
  exercise_frequency: 'fitness.frequency',
  fitness_goals: 'fitness.goal',
  running_shoes: 'fitness.running_shoes',
  fitness_apps: 'fitness.apps',
  workout_frequency: 'fitness.workout_frequency',
  equipment_owned: 'fitness.equipment_owned',
  competition: 'fitness.competition',

  // Gift Giving
  partner_interests: 'gifts.partner_interests',
  mom_interests: 'gifts.mom_interests',
  gift_budget: 'budget.gift_range',
  budget_per_occasion: 'gifts.budget_per_occasion',
  gift_style: 'gifts.style',

  // Entertainment
  streaming_services: 'entertainment.streaming_services',
  music_genres: 'entertainment.music_genres',
  favorite_shows: 'entertainment.favorite_shows',
  favorite_movies: 'entertainment.favorite_movies',
  podcast_preferences: 'entertainment.podcast_preferences',
  gaming_platforms: 'entertainment.gaming_platforms',
  gaming_genres: 'entertainment.gaming_genres',

  // Home & Living
  furniture_style: 'home.furniture_style',
  home_size: 'home.size',
  pets: 'home.pets',
  pet_breeds: 'home.pet_breeds',
  garden_preferences: 'home.garden_preferences',
  smart_devices: 'home.smart_devices',

  // Health & Wellness
  health_dietary_restrictions: 'health.dietary_restrictions',
  allergies: 'health.allergies',
  supplements: 'health.supplements',
  sleep_schedule: 'health.sleep_schedule',
  medical_preferences: 'health.medical_preferences',
  mental_health: 'health.mental_health',

  // Legacy dotted variants observed in fixtures/docs
  'apparel.pants.waist_in': 'apparel.pants.waist',
  'apparel.pants.inseam_in': 'apparel.pants.inseam',
  'apparel.pants.fit_preferences': 'apparel.fit_preference',
  'apparel.shirts.size': 'apparel.shirt.size',
  'apparel.shoes.size': 'apparel.shoe.size',
};

export function normalizeFactKey(key: string | undefined | null): string {
  if (!key) return '';
  return LEGACY_FACT_KEY_MAP[key] ?? key;
}

