export interface ChatGPTExport {
  title: string;
  create_time: number;
  update_time: number;
  mapping: Record<string, ChatGPTNode>;
  [key: string]: unknown;
}

export type ChatGPTAuthorRole = 'user' | 'assistant' | 'system' | 'tool' | string;

export type ChatGPTContentPart =
  | string
  | number
  | boolean
  | null
  | {
      text?: string;
      content?: string;
      type?: string;
      content_type?: string;
      [key: string]: unknown;
    };

export interface ChatGPTMessageContent {
  content_type?: string;
  parts?: ChatGPTContentPart[];
  text?: string;
  [key: string]: unknown;
}

export interface ChatGPTMessage {
  id?: string;
  author: {
    role: ChatGPTAuthorRole;
    name?: string | null;
    metadata?: Record<string, unknown>;
    [key: string]: unknown;
  };
  content: ChatGPTMessageContent;
  create_time?: number;
  update_time?: number | null;
  metadata?: Record<string, unknown>;
  recipient?: string;
  [key: string]: unknown;
}

export interface ChatGPTNode {
  id: string;
  message?: ChatGPTMessage | null;
  parent?: string | null;
  children: string[];
  [key: string]: unknown;
}

interface ExtractionMetadata {
  sourceType: 'chatgpt' | 'gmail' | 'amazon' | 'claude' | 'notion' | 'gemini' | 'calendar';
  sourceId: string;
  extractedAt: string;
  patternId: string;
}

export interface Fact {
  key: string;
  value: string;
  confidence: number; // 0-1
  sensitivity: 'low' | 'medium' | 'high';
  source: string; // conversation title
  extractedAt: number; // timestamp
  negated?: boolean;
  extractionCount?: number;
  metadata?: ExtractionMetadata;
}

export interface Persona {
  id: string;
  name: string;
  category: PersonaCategory;
  description: string;
  icon: string;
  facts: Fact[];
  completionScore: number; // 0-1
}

export type PersonaCategory =
  | 'Shopping'
  | 'Travel'
  | 'Food & Dining'
  | 'Work'
  | 'Fitness'
  | 'Gift Giving'
  | 'Entertainment'
  | 'Home & Living'
  | 'Health & Wellness';

export interface ProfileSummary {
  narrative: string;
  keyTraits: string[];
  confidence: number;
}

export interface FollowUpQuestion {
  id: string;
  persona: PersonaCategory;
  question: string;
  type: 'text' | 'multiple-choice' | 'boolean';
  options?: string[];
  importance: 'high' | 'medium' | 'low';
  answered?: boolean;
  answer?: string;
}

export interface PrivacyPosture {
  id: string;
  name: string;
  description: string;
  icon: string;
  features: string[];
  recommended?: boolean;
}

export interface ImportProgress {
  stage: 'parsing' | 'extracting' | 'analyzing' | 'complete';
  progress: number; // 0-100
  message: string;
}

export interface VaultConfig {
  passphrase: string;
  useBiometrics: boolean;
  derivedOnly: boolean;
  vaultName: string;
}
