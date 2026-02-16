import type { ExtractionMatch } from '../../components/ExtractionHighlight';
import type { GmailEmail } from '../../lib/gmail-extractor';
import {
  buildExtractionMatchesFromFactValues,
  buildGmailGeneralRecords,
  extractBrowseFactsFromRecords,
} from './record-fact-extraction';

export interface GmailScopedFact {
  key: string;
  value: string;
  confidence: number;
  category: string;
}

export interface SelectedEmailExtractionResult {
  matches: ExtractionMatch[];
  facts: GmailScopedFact[];
  processedEmailIds: string[];
}

export interface FilteredMailboxProgress {
  processed: number;
  total: number;
}

export interface FilteredMailboxExtractionResult {
  facts: GmailScopedFact[];
  processedEmailIds: string[];
}

export interface FilteredMailboxExtractionOptions {
  chunkSize?: number;
  signal?: AbortSignal;
  onProgress?: (progress: FilteredMailboxProgress) => void;
}

export class MailboxExtractionCancelledError extends Error {
  constructor() {
    super('Filtered mailbox extraction was cancelled');
    this.name = 'MailboxExtractionCancelledError';
  }
}

function dedupeFacts(facts: GmailScopedFact[]): GmailScopedFact[] {
  const unique = new Map<string, GmailScopedFact>();
  for (const fact of facts) {
    const key = `${fact.key}::${fact.value.toLowerCase()}`;
    const current = unique.get(key);
    if (!current || fact.confidence > current.confidence) {
      unique.set(key, fact);
    }
  }

  return Array.from(unique.values()).sort((a, b) => b.confidence - a.confidence);
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new MailboxExtractionCancelledError();
  }
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

export function extractSelectedEmailInsights(
  selectedEmail: GmailEmail | null,
): SelectedEmailExtractionResult {
  if (!selectedEmail) {
    return { matches: [], facts: [], processedEmailIds: [] };
  }

  const facts = dedupeFacts(extractBrowseFactsFromRecords(buildGmailGeneralRecords([selectedEmail])));
  const highlightMatches: ExtractionMatch[] = buildExtractionMatchesFromFactValues(
    selectedEmail.body,
    facts,
  );

  return {
    matches: highlightMatches,
    facts,
    processedEmailIds: [selectedEmail.id],
  };
}

export async function extractFilteredMailboxInsights(
  filteredEmails: GmailEmail[],
  options: FilteredMailboxExtractionOptions = {},
): Promise<FilteredMailboxExtractionResult> {
  const total = filteredEmails.length;
  if (total === 0) return { facts: [], processedEmailIds: [] };

  const chunkSize = Math.max(1, options.chunkSize ?? 25);
  const allFacts: GmailScopedFact[] = [];
  const processedEmailIds: string[] = [];
  let processed = 0;

  for (let start = 0; start < total; start += chunkSize) {
    assertNotAborted(options.signal);
    const batch = filteredEmails.slice(start, start + chunkSize);
    const batchRecords = buildGmailGeneralRecords(batch);
    const batchFacts = extractBrowseFactsFromRecords(batchRecords);
    allFacts.push(...batchFacts);

    for (let index = 0; index < batch.length; index += 1) {
      assertNotAborted(options.signal);
      processedEmailIds.push(batch[index].id);
    }

    processed += batch.length;
    options.onProgress?.({ processed, total });

    if (processed < total) {
      await yieldToEventLoop();
    }
  }

  return {
    facts: dedupeFacts(allFacts),
    processedEmailIds,
  };
}
