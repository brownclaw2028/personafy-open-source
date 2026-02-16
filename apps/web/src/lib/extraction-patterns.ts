// ============================================================================
// Shared extraction patterns — single source of truth for brand, budget,
// and location regexes used by extractor.ts, claude-extractor.ts,
// and notion-extractor.ts.
// ============================================================================

export const BRANDS_PATTERNS = {
  clothing: /\b(nordstrom|j\.crew|nike|uniqlo|patagonia|banana republic|gap|zara|h&m|everlane|bonobos|wool & prince|outlier|smartwool|icebreaker|asket|sunspel|allbirds|lululemon)\b/gi,
  tech: /\b(apple|macbook|iphone|samsung|google|microsoft|dell|hp|lenovo|asus|acer|sony|bose|airpods|pixel)\b/gi,
  food: /\b(whole foods|trader joe's|costco|target|walmart|kroger|safeway|publix|aldi)\b/gi,
};

export const BUDGET_PATTERNS = /\$(\d+)(?:-\$?(\d+))?|\bbudget.{0,20}\$?(\d+)|\baround \$(\d+)|\bunder \$(\d+)/gi;

export const LOCATION_PATTERNS = /\b(chicago|nyc|new york|san francisco|sf|austin|boston|seattle|portland|denver|atlanta|miami|la|los angeles|dc|washington|tokyo|london|paris|kyoto|osaka|patagonia)\b/gi;
