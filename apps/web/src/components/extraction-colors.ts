export type HighlightTheme = 'dark' | 'light' | 'warm' | 'chatgpt';

const CATEGORY_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  Shopping:          { bg: 'bg-blue-500/15',   border: 'border-blue-400/40',   text: 'text-blue-300' },
  Travel:            { bg: 'bg-green-500/15',  border: 'border-green-400/40',  text: 'text-green-300' },
  'Food & Dining':   { bg: 'bg-orange-500/15', border: 'border-orange-400/40', text: 'text-orange-300' },
  Food:              { bg: 'bg-orange-500/15', border: 'border-orange-400/40', text: 'text-orange-300' },
  Fitness:           { bg: 'bg-purple-500/15', border: 'border-purple-400/40', text: 'text-purple-300' },
  'Health & Fitness': { bg: 'bg-purple-500/15', border: 'border-purple-400/40', text: 'text-purple-300' },
  Work:              { bg: 'bg-cyan-500/15',   border: 'border-cyan-400/40',   text: 'text-cyan-300' },
  'Gift Giving':     { bg: 'bg-pink-500/15',   border: 'border-pink-400/40',   text: 'text-pink-300' },
  Gifts:             { bg: 'bg-pink-500/15',   border: 'border-pink-400/40',   text: 'text-pink-300' },
  Finance:           { bg: 'bg-yellow-500/15', border: 'border-yellow-400/40', text: 'text-yellow-300' },
  Subscriptions:     { bg: 'bg-indigo-500/15', border: 'border-indigo-400/40', text: 'text-indigo-300' },
  Entertainment:     { bg: 'bg-rose-500/15',   border: 'border-rose-400/40',   text: 'text-rose-300' },
  'Home & Living':   { bg: 'bg-teal-500/15',   border: 'border-teal-400/40',   text: 'text-teal-300' },
  'Health & Wellness': { bg: 'bg-emerald-500/15', border: 'border-emerald-400/40', text: 'text-emerald-300' },
};

const CATEGORY_COLORS_LIGHT: Record<string, { bg: string; border: string; text: string }> = {
  Shopping:          { bg: 'bg-blue-100',    border: 'border-blue-400',    text: 'text-blue-800' },
  Travel:            { bg: 'bg-green-100',   border: 'border-green-400',   text: 'text-green-800' },
  'Food & Dining':   { bg: 'bg-orange-100',  border: 'border-orange-400',  text: 'text-orange-800' },
  Food:              { bg: 'bg-orange-100',  border: 'border-orange-400',  text: 'text-orange-800' },
  Fitness:           { bg: 'bg-purple-100',  border: 'border-purple-400',  text: 'text-purple-800' },
  'Health & Fitness': { bg: 'bg-purple-100',  border: 'border-purple-400',  text: 'text-purple-800' },
  Work:              { bg: 'bg-cyan-100',    border: 'border-cyan-400',    text: 'text-cyan-800' },
  'Gift Giving':     { bg: 'bg-pink-100',    border: 'border-pink-400',    text: 'text-pink-800' },
  Gifts:             { bg: 'bg-pink-100',    border: 'border-pink-400',    text: 'text-pink-800' },
  Finance:           { bg: 'bg-yellow-100',  border: 'border-yellow-400',  text: 'text-yellow-800' },
  Subscriptions:     { bg: 'bg-indigo-100',  border: 'border-indigo-400',  text: 'text-indigo-800' },
  Entertainment:     { bg: 'bg-rose-100',    border: 'border-rose-400',    text: 'text-rose-800' },
  'Home & Living':   { bg: 'bg-teal-100',    border: 'border-teal-400',    text: 'text-teal-800' },
  'Health & Wellness': { bg: 'bg-emerald-100', border: 'border-emerald-400', text: 'text-emerald-800' },
};

const CATEGORY_COLORS_WARM: Record<string, { bg: string; border: string; text: string }> = {
  Shopping:          { bg: 'bg-blue-50',     border: 'border-blue-300',    text: 'text-blue-700' },
  Travel:            { bg: 'bg-green-50',    border: 'border-green-300',   text: 'text-green-700' },
  'Food & Dining':   { bg: 'bg-orange-50',   border: 'border-orange-300',  text: 'text-orange-700' },
  Food:              { bg: 'bg-orange-50',   border: 'border-orange-300',  text: 'text-orange-700' },
  Fitness:           { bg: 'bg-purple-50',   border: 'border-purple-300',  text: 'text-purple-700' },
  'Health & Fitness': { bg: 'bg-purple-50',   border: 'border-purple-300',  text: 'text-purple-700' },
  Work:              { bg: 'bg-cyan-50',     border: 'border-cyan-300',    text: 'text-cyan-700' },
  'Gift Giving':     { bg: 'bg-pink-50',     border: 'border-pink-300',    text: 'text-pink-700' },
  Gifts:             { bg: 'bg-pink-50',     border: 'border-pink-300',    text: 'text-pink-700' },
  Finance:           { bg: 'bg-yellow-50',   border: 'border-yellow-300',  text: 'text-yellow-700' },
  Subscriptions:     { bg: 'bg-indigo-50',   border: 'border-indigo-300',  text: 'text-indigo-700' },
  Entertainment:     { bg: 'bg-rose-50',     border: 'border-rose-300',    text: 'text-rose-700' },
  'Home & Living':   { bg: 'bg-teal-50',     border: 'border-teal-300',    text: 'text-teal-700' },
  'Health & Wellness': { bg: 'bg-emerald-50',  border: 'border-emerald-300', text: 'text-emerald-700' },
};

const CATEGORY_COLORS_CHATGPT: Record<string, { bg: string; border: string; text: string }> = {
  Shopping:          { bg: 'bg-blue-500/25',   border: 'border-blue-400/50',   text: 'text-blue-300' },
  Travel:            { bg: 'bg-green-500/25',  border: 'border-green-400/50',  text: 'text-green-300' },
  'Food & Dining':   { bg: 'bg-orange-500/25', border: 'border-orange-400/50', text: 'text-orange-300' },
  Food:              { bg: 'bg-orange-500/25', border: 'border-orange-400/50', text: 'text-orange-300' },
  Fitness:           { bg: 'bg-purple-500/25', border: 'border-purple-400/50', text: 'text-purple-300' },
  'Health & Fitness': { bg: 'bg-purple-500/25', border: 'border-purple-400/50', text: 'text-purple-300' },
  Work:              { bg: 'bg-cyan-500/25',   border: 'border-cyan-400/50',   text: 'text-cyan-300' },
  'Gift Giving':     { bg: 'bg-pink-500/25',   border: 'border-pink-400/50',   text: 'text-pink-300' },
  Gifts:             { bg: 'bg-pink-500/25',   border: 'border-pink-400/50',   text: 'text-pink-300' },
  Finance:           { bg: 'bg-yellow-500/25', border: 'border-yellow-400/50', text: 'text-yellow-300' },
  Subscriptions:     { bg: 'bg-indigo-500/25', border: 'border-indigo-400/50', text: 'text-indigo-300' },
  Entertainment:     { bg: 'bg-rose-500/25',   border: 'border-rose-400/50',   text: 'text-rose-300' },
  'Home & Living':   { bg: 'bg-teal-500/25',   border: 'border-teal-400/50',   text: 'text-teal-300' },
  'Health & Wellness': { bg: 'bg-emerald-500/25', border: 'border-emerald-400/50', text: 'text-emerald-300' },
};

// Raw hex colors per category for inline styles (e.g. border-left-color)
export const CATEGORY_HEX_COLORS: Record<string, string> = {
  Shopping:            '#3b82f6',
  Travel:              '#22c55e',
  'Food & Dining':     '#f97316',
  Food:                '#f97316',
  Fitness:             '#a855f7',
  'Health & Fitness':  '#a855f7',
  Work:                '#06b6d4',
  'Gift Giving':       '#ec4899',
  Gifts:               '#ec4899',
  Finance:             '#eab308',
  Subscriptions:       '#6366f1',
  Entertainment:       '#f43f5e',
  'Home & Living':     '#14b8a6',
  'Health & Wellness': '#10b981',
};

const DEFAULT_COLORS: Record<HighlightTheme, { bg: string; border: string; text: string }> = {
  dark:    { bg: 'bg-gray-500/15', border: 'border-gray-400/40', text: 'text-gray-300' },
  light:   { bg: 'bg-gray-100',    border: 'border-gray-400',    text: 'text-gray-800' },
  warm:    { bg: 'bg-gray-50',     border: 'border-gray-300',    text: 'text-gray-700' },
  chatgpt: { bg: 'bg-gray-500/25', border: 'border-gray-400/50', text: 'text-gray-300' },
};

const THEME_COLOR_MAPS: Record<HighlightTheme, Record<string, { bg: string; border: string; text: string }>> = {
  dark: CATEGORY_COLORS,
  light: CATEGORY_COLORS_LIGHT,
  warm: CATEGORY_COLORS_WARM,
  chatgpt: CATEGORY_COLORS_CHATGPT,
};

export function getColor(category: string, theme: HighlightTheme = 'dark') {
  return THEME_COLOR_MAPS[theme][category] ?? DEFAULT_COLORS[theme];
}
