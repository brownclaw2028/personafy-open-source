export type SourceType =
  | 'gmail'
  | 'amazon'
  | 'chatgpt'
  | 'claude'
  | 'notion'
  | 'gemini'
  | 'calendar';

export const ALL_SOURCE_TYPES: SourceType[] = [
  'gmail',
  'amazon',
  'chatgpt',
  'claude',
  'notion',
  'gemini',
  'calendar',
];

export const ALL_SOURCE_TYPE_SET: ReadonlySet<SourceType> = new Set(ALL_SOURCE_TYPES);

export const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  gmail: 'Gmail',
  amazon: 'Amazon',
  chatgpt: 'ChatGPT',
  claude: 'Claude',
  notion: 'Notion',
  gemini: 'Gemini',
  calendar: 'Calendar',
};

export function isSourceType(value: string): value is SourceType {
  return ALL_SOURCE_TYPE_SET.has(value as SourceType);
}
