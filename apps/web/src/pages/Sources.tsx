import { useEffect, useMemo, useRef, useState } from 'react';
import { Layout } from '../components/Layout';
import { SkeletonPage } from '../components/LoadingSkeleton';
import { ModelHydrationStatus } from '../components/sources/ModelHydrationStatus';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { VaultErrorState } from '../components/VaultErrorState';
import { toast } from '../components/Toast';
import {
  Database,
  MessageSquare,
  Mail,
  FileText,
  CheckCircle,
  Clock,
  ArrowRight,
  Upload,
  RefreshCw,
  Calendar,
  Shield,
  ShoppingBag,
  Loader2,
  ExternalLink,
  Check,
  X,
  AlertTriangle,
} from 'lucide-react';
import { useVault } from '../lib/VaultProvider';
import type { AmazonOrder } from '../lib/amazon-extractor';
import type { GmailEmail } from '../lib/gmail-extractor';
import type { ClaudeExport } from '../lib/claude-extractor';
import type { NotionPage } from '../lib/notion-extractor';
import {
  getSourceLineage,
  loadCanonicalSourceDataset,
  type SourceLineage,
} from '../lib/canonical-package-lineage';
import { mergeImportedPersonas, parseExtractedAtMs } from '../lib/source-merge';
import {
  extractGeneralFactsWithEvidence,
  mergeFactCollections,
  type GeneralExtractedFact,
  type GeneralExtractionRecord,
} from '../lib/general-extractor';
import type { AtomicSieveResult } from '../lib/atomic-sieve';
import type {
  AtomicSieveWorkerRequest,
  AtomicSieveWorkerResponse,
} from '../lib/atomic-sieve-worker-types';
import { generatePersonas } from '../lib/persona-generator';
import type { Fact } from '../lib/types';
import type { SourceType } from '../lib/source-types';
import { gateGeneralFactsForReview, mergePendingFactReviews } from '../lib/fact-review-gate';
import { parseUniversalUploadFiles } from '../lib/upload-anything';
import type { PendingFactReview } from '../lib/vault';
import type {
  SemanticWorkerProgressUpdate,
  SemanticWorkerRequest,
  SemanticWorkerResponse,
  SemanticWorkerSuccessResponse,
} from '../lib/semantic-worker-types';
import { computeSemanticShadowMetrics } from '../lib/semantic-shadow-metrics';
import { formatFactKey } from '../lib/utils';
import {
  checkSecurityHeadersForSAB,
  summarizeSecurityHeadersIssues,
  type SecurityHeadersCheckResult,
} from '../lib/security-headers-check';
import {
  bumpModelHydrationProgress,
  markModelHydrationDownloading,
  markModelHydrationFailed,
  markModelHydrationReady,
  markModelHydrationWarming,
  readModelHydrationState,
  type ModelHydrationState,
} from '../lib/model-hydration-state';

interface SourcesProps {
  userName?: string;
  userInitials?: string;
  onNavClick?: (itemId: string) => void;
}

interface Source {
  id: SourceType;
  sourceType: SourceType;
  name: string;
  description: string;
  icon: typeof MessageSquare;
  status: 'connected' | 'coming_soon' | 'available';
  lastSync?: string;
  factsExtracted?: number;
  color: string;
  bg: string;
  exportHelp?: string;
}

const sources: Source[] = [
  {
    id: 'chatgpt',
    sourceType: 'chatgpt',
    name: 'ChatGPT Export',
    description: 'Import your conversations.json from OpenAI ChatGPT data export',
    icon: MessageSquare,
    status: 'connected',
    lastSync: '2026-02-09T15:30:00.000Z',
    factsExtracted: 26,
    color: 'text-accent',
    bg: 'bg-accent/10',
    exportHelp: 'https://help.openai.com/en/articles/7260999-how-do-i-export-my-chatgpt-history-and-data',
  },
  {
    id: 'amazon',
    sourceType: 'amazon',
    name: 'Amazon Order History',
    description: 'Import your Amazon order history to discover shopping preferences',
    icon: ShoppingBag,
    status: 'available',
    color: 'text-orange-400',
    bg: 'bg-orange-400/10',
    exportHelp: 'https://www.amazon.com/hz/privacy-central/data-requests/preview.html',
  },
  {
    id: 'claude',
    sourceType: 'claude',
    name: 'Claude Export',
    description: 'Import conversation history from Anthropic Claude',
    icon: MessageSquare,
    status: 'connected',
    lastSync: '2026-02-08T11:12:00.000Z',
    factsExtracted: 24,
    color: 'text-primary',
    bg: 'bg-primary/10',
  },
  {
    id: 'gemini',
    sourceType: 'gemini',
    name: 'Gemini Export',
    description: 'Import chat history from Google Gemini',
    icon: MessageSquare,
    status: 'coming_soon',
    color: 'text-yellow-400',
    bg: 'bg-yellow-400/10',
  },
  {
    id: 'gmail',
    sourceType: 'gmail',
    name: 'Gmail',
    description: 'Scan email receipts, travel confirmations, and preferences',
    icon: Mail,
    status: 'available',
    color: 'text-red-400',
    bg: 'bg-red-400/10',
    exportHelp: 'https://takeout.google.com/',
  },
  {
    id: 'notion',
    sourceType: 'notion',
    name: 'Notion',
    description: 'Extract preferences and context from your Notion workspace',
    icon: FileText,
    status: 'available',
    color: 'text-white',
    bg: 'bg-white/10',
  },
  {
    id: 'calendar',
    sourceType: 'calendar',
    name: 'Google Calendar',
    description: 'Travel patterns, meeting preferences, and scheduling habits',
    icon: Calendar,
    status: 'coming_soon',
    color: 'text-primary',
    bg: 'bg-primary/10',
  },
];

const statusLabels = {
  connected: { label: 'Connected', color: 'text-accent', bg: 'bg-accent/10' },
  available: { label: 'Available', color: 'text-primary', bg: 'bg-primary/10' },
  coming_soon: { label: 'Coming Soon', color: 'text-text-tertiary', bg: 'bg-white/10' },
};

const SEMANTIC_WORKER_TIMEOUT_MS = 120_000;
const ATOMIC_SIEVE_WORKER_TIMEOUT_MS = 45_000;
const SEMANTIC_ROLLOUT_MODE_STORAGE_KEY = 'personafy.semantic.rolloutMode';
const SEMANTIC_WEBGPU_STORAGE_KEY = 'personafy.semantic.webgpu';
const SEMANTIC_SHADOW_METRICS_STORAGE_KEY = 'personafy.semantic.shadowMetrics';
const SEMANTIC_WEBGPU_ENABLED = import.meta.env.VITE_SEMANTIC_WEBGPU_ENABLED === 'true';
const SEMANTIC_WEBGPU_MODEL = import.meta.env.VITE_SEMANTIC_WEBGPU_MODEL || 'Llama-3.2-1B-Instruct-q4f16_1-MLC';
const SEMANTIC_DEFAULT_ROLLOUT_MODE = (import.meta.env.VITE_SEMANTIC_ROLLOUT_MODE ?? 'shadow').toLowerCase();

type SemanticRolloutMode = 'off' | 'shadow' | 'merge';

function parseSemanticRolloutMode(input: string | null | undefined): SemanticRolloutMode {
  const value = input?.trim().toLowerCase();
  if (value === 'off' || value === 'shadow' || value === 'merge') return value;
  return 'shadow';
}

function safeLocalStorageGet(key: string): string | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeLocalStorageSet(key: string, value: string): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(key, value);
  } catch {
    // no-op: browser privacy/storage constraints should not break import flow
  }
}

function getSemanticRolloutMode(): SemanticRolloutMode {
  const localValue = safeLocalStorageGet(SEMANTIC_ROLLOUT_MODE_STORAGE_KEY);
  if (localValue != null) return parseSemanticRolloutMode(localValue);
  return parseSemanticRolloutMode(SEMANTIC_DEFAULT_ROLLOUT_MODE);
}

function getSemanticWebGpuEnabled(): boolean {
  const localValue = safeLocalStorageGet(SEMANTIC_WEBGPU_STORAGE_KEY);
  if (localValue != null) {
    const normalized = localValue.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return SEMANTIC_WEBGPU_ENABLED;
}

function appendSemanticShadowSample(sample: {
  sourceLabel: string;
  rolloutMode: SemanticRolloutMode;
  runtimeMode: string;
  usedWebGpu: boolean;
  modelId?: string;
  fallbackReason?: string;
  fallbackMessage?: string;
  baselineCount: number;
  semanticCount: number;
  overlapCount: number;
  semanticOnlyCount: number;
  baselineOnlyCount: number;
  precisionProxy: number;
  recallProxy: number;
  f1Proxy: number;
}): void {
  const existingRaw = safeLocalStorageGet(SEMANTIC_SHADOW_METRICS_STORAGE_KEY);
  let existing: unknown = [];
  if (existingRaw) {
    try {
      existing = JSON.parse(existingRaw) as unknown;
    } catch {
      existing = [];
    }
  }
  const list = Array.isArray(existing) ? existing : [];
  list.push({
    recordedAt: new Date().toISOString(),
    ...sample,
  });
  const trimmed = list.slice(-120);
  safeLocalStorageSet(SEMANTIC_SHADOW_METRICS_STORAGE_KEY, JSON.stringify(trimmed));
}

function runSemanticExtractorInWorker(
  records: GeneralExtractionRecord[],
  options: { enableWebGpu: boolean; webGpuModel: string },
  callbacks: { onProgress?: (update: SemanticWorkerProgressUpdate) => void } = {},
): Promise<SemanticWorkerSuccessResponse> {
  return new Promise((resolve, reject) => {
    try {
      const worker = new Worker(
        new URL('../workers/semanticExtractorWorker.ts', import.meta.url),
        { type: 'module' },
      );

      const timeout = setTimeout(() => {
        worker.terminate();
        reject(new Error('Semantic extractor worker timed out'));
      }, SEMANTIC_WORKER_TIMEOUT_MS);

      worker.onmessage = (event: MessageEvent<SemanticWorkerResponse>) => {
        if (event.data.ok && event.data.type === 'progress') {
          callbacks.onProgress?.(event.data.progress);
          return;
        }

        clearTimeout(timeout);
        worker.terminate();
        if (event.data.ok && event.data.type === 'result') {
          resolve(event.data);
          return;
        }
        if (!event.data.ok) {
          reject(new Error(event.data.error));
          return;
        }
        reject(new Error('Semantic worker returned an unknown response shape.'));
      };

      worker.onerror = (error) => {
        clearTimeout(timeout);
        worker.terminate();
        reject(error);
      };

      const request: SemanticWorkerRequest = {
        records,
        options: {
          enableWebGpu: options.enableWebGpu,
          webGpuModel: options.webGpuModel,
        },
      };
      worker.postMessage(request);
    } catch (error) {
      reject(error);
    }
  });
}

function toSemanticInputRecords(
  fallbackRecords: GeneralExtractionRecord[],
  sieveResult: AtomicSieveResult,
): GeneralExtractionRecord[] {
  if (sieveResult.chunks.length === 0) return fallbackRecords;

  return sieveResult.chunks.map((chunk) => ({
    sourceType: chunk.sourceType,
    sourceId: chunk.chunkId,
    sourceName: `${chunk.sourceName} [atomic]`,
    content: chunk.text,
  }));
}

function runAtomicSieveInWorker(
  records: GeneralExtractionRecord[],
): Promise<GeneralExtractionRecord[]> {
  return new Promise((resolve, reject) => {
    try {
      const worker = new Worker(
        new URL('../workers/atomicSieveWorker.ts', import.meta.url),
        { type: 'module' },
      );

      const timeout = setTimeout(() => {
        worker.terminate();
        reject(new Error('Atomic sieve worker timed out'));
      }, ATOMIC_SIEVE_WORKER_TIMEOUT_MS);

      worker.onmessage = (event: MessageEvent<AtomicSieveWorkerResponse>) => {
        clearTimeout(timeout);
        worker.terminate();
        if (!event.data.ok) {
          reject(new Error(event.data.error));
          return;
        }
        resolve(toSemanticInputRecords(records, event.data.result));
      };

      worker.onerror = (error) => {
        clearTimeout(timeout);
        worker.terminate();
        reject(error);
      };

      const request: AtomicSieveWorkerRequest = { records };
      worker.postMessage(request);
    } catch (error) {
      reject(error);
    }
  });
}

function sampleButtonClasses(sourceId: SourceType): string {
  switch (sourceId) {
    case 'amazon':
      return 'bg-orange-400/10 border-orange-400/30 text-orange-400 hover:bg-orange-400/20';
    case 'gmail':
      return 'bg-red-400/10 border-red-400/30 text-red-400 hover:bg-red-400/20';
    case 'claude':
      return 'bg-primary/10 border-primary/30 text-primary hover:bg-primary/20';
    case 'notion':
      return 'bg-white/10 border-white/30 text-white hover:bg-white/20';
    default:
      return 'bg-primary/10 border-primary/30 text-primary hover:bg-primary/20';
  }
}

function toHydrationStatus(update: SemanticWorkerProgressUpdate): ModelHydrationState {
  return {
    modelId: update.modelId,
    status: update.status,
    progress: Math.max(0, Math.min(1, update.progress)),
    updatedAt: Date.now(),
    error: update.status === 'failed' ? (update.message || 'Model hydration failed') : undefined,
  };
}

function buildGmailGeneralRecords(emails: GmailEmail[]): GeneralExtractionRecord[] {
  return emails.map((email) => ({
    sourceType: 'gmail',
    sourceId: email.id,
    sourceName: `Gmail: ${email.subject}`,
    content: `${email.subject}. ${email.body}`,
  }));
}

function buildAmazonGeneralRecords(orders: AmazonOrder[]): GeneralExtractionRecord[] {
  return orders.map((order) => {
    const itemsText = order.items
      .map((item) => [item.name, item.category, item.brand, item.size, item.color].filter(Boolean).join(' '))
      .join('. ');
    const content = `${itemsText}. Order status: ${order.status}. Destination: ${order.shippingAddress.city}, ${order.shippingAddress.state}.`;
    return {
      sourceType: 'amazon',
      sourceId: order.orderId,
      sourceName: `Amazon: ${order.orderId}`,
      content,
    };
  });
}

function buildClaudeGeneralRecords(conversations: ClaudeExport[]): GeneralExtractionRecord[] {
  return conversations.flatMap((conversation) =>
    conversation.chat_messages
      .filter((message) => {
        const sender = typeof message.sender === 'string' ? message.sender.trim().toLowerCase() : '';
        return sender === 'human' || sender === 'user';
      })
      .map((message) => ({
        sourceType: 'claude' as const,
        sourceId: message.uuid,
        sourceName: `Claude: ${conversation.name}`,
        content: message.text,
      }))
      .filter((record) => record.content.trim().length > 0),
  );
}

function buildNotionGeneralRecords(pages: NotionPage[]): GeneralExtractionRecord[] {
  return pages.map((page) => {
    const propsText = page.properties
      ? Object.entries(page.properties)
        .map(([key, value]) => `${key}: ${value}`)
        .join('. ')
      : '';
    return {
      sourceType: 'notion',
      sourceId: page.id,
      sourceName: `Notion: ${page.title}`,
      content: `${page.title}. ${page.content}. ${propsText}`,
    };
  });
}

export function Sources({
  userName = 'User',
  userInitials = 'U',
  onNavClick,
}: SourcesProps) {
  useDocumentTitle('Sources');
  const { vault, loading, error, locked, refresh, unlock, save } = useVault();
  const [importingAmazon, setImportingAmazon] = useState(false);
  const [importingGmail, setImportingGmail] = useState(false);
  const [importingClaude, setImportingClaude] = useState(false);
  const [importingNotion, setImportingNotion] = useState(false);
  const [importingUniversal, setImportingUniversal] = useState(false);
  const [reviewActionId, setReviewActionId] = useState<string | null>(null);
  const [importedSources, setImportedSources] = useState<Set<string>>(new Set());
  const [securityHeadersState, setSecurityHeadersState] = useState<SecurityHeadersCheckResult | null>(null);
  const [hydrationState, setHydrationState] = useState<ModelHydrationState>(() => (
    readModelHydrationState(SEMANTIC_WEBGPU_MODEL)
  ));
  const universalUploadRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    void checkSecurityHeadersForSAB()
      .then((result) => {
        if (cancelled) return;
        setSecurityHeadersState(result);
      })
      .catch(() => {
        if (cancelled) return;
        setSecurityHeadersState(null);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setHydrationState(readModelHydrationState(SEMANTIC_WEBGPU_MODEL));
  }, []);

  const liveSources = useMemo(() => sources.map((s) => {
    const sourceFacts = vault?.personas.flatMap((p) =>
      p.facts.filter((f) => f.source?.toLowerCase().includes(s.id)),
    ) ?? [];
    const factCount = sourceFacts.length;
    const latestExtractedAt = sourceFacts.reduce<number | null>((latest, fact) => {
      const timestamp = parseExtractedAtMs(fact.extractedAt);
      if (timestamp == null) return latest;
      return latest == null ? timestamp : Math.max(latest, timestamp);
    }, null);
    const lastSync = latestExtractedAt != null
      ? new Date(latestExtractedAt).toISOString()
      : s.lastSync;

    if (importedSources.has(s.id) || factCount > 0) {
      return {
        ...s,
        status: 'connected' as const,
        factsExtracted: factCount,
        lastSync,
      };
    }
    return s;
  }), [importedSources, vault]);

  const sourceLineage = useMemo<Record<SourceType, SourceLineage>>(() => {
    return liveSources.reduce((acc, source) => {
      acc[source.id] = getSourceLineage(source.sourceType, 'all');
      return acc;
    }, {} as Record<SourceType, SourceLineage>);
  }, [liveSources]);

  const pendingFactReviews = useMemo(
    () => (vault?.factReviewQueue ?? []).filter((item) => item.status === 'pending'),
    [vault],
  );

  const handleHydrationRetry = () => {
    safeLocalStorageSet(SEMANTIC_WEBGPU_STORAGE_KEY, 'true');
    const next = markModelHydrationDownloading(SEMANTIC_WEBGPU_MODEL, 0.05);
    setHydrationState(next);
    toast('Model hydration retry queued. WebGPU extraction will resume on next import.', 'info');
  };

  const handleHydrationCancel = () => {
    safeLocalStorageSet(SEMANTIC_WEBGPU_STORAGE_KEY, 'false');
    const next = markModelHydrationFailed(
      SEMANTIC_WEBGPU_MODEL,
      'Model hydration canceled. Re-enable WebGPU to retry.',
    );
    setHydrationState(next);
    toast('WebGPU semantic extraction disabled for now.', 'info');
  };

  const handleHydrationEnableWebGpu = () => {
    safeLocalStorageSet(SEMANTIC_WEBGPU_STORAGE_KEY, 'true');
    const current = readModelHydrationState(SEMANTIC_WEBGPU_MODEL);
    const next = current.status === 'ready'
      ? current
      : markModelHydrationDownloading(SEMANTIC_WEBGPU_MODEL, Math.max(current.progress, 0.05));
    setHydrationState(next);
    toast('WebGPU semantic extraction enabled.', 'success');
  };

  const applyGeneralLayerImport = async (
    sourceLabel: string,
    primaryFacts: Fact[],
    records: GeneralExtractionRecord[],
    connectedSourceIds: SourceType[] = [],
  ): Promise<boolean> => {
    if (!vault) return false;

    const rolloutMode = getSemanticRolloutMode();
    const semanticWebGpuEnabled = getSemanticWebGpuEnabled();
    const baselineFacts = extractGeneralFactsWithEvidence(records);
    let semanticFacts: GeneralExtractedFact[] = [];
    let semanticResult: SemanticWorkerSuccessResponse | null = null;

    if (rolloutMode !== 'off') {
      try {
        let semanticInputRecords = records;
        try {
          semanticInputRecords = await runAtomicSieveInWorker(records);
        } catch (error) {
          console.warn('Atomic sieve worker failed; using raw records for semantic extraction.', error);
        }

        if (semanticWebGpuEnabled) {
          const currentHydration = readModelHydrationState(SEMANTIC_WEBGPU_MODEL);
          const nextHydration = currentHydration.status === 'ready'
            ? currentHydration
            : currentHydration.status === 'not_downloaded' || currentHydration.status === 'failed'
              ? markModelHydrationDownloading(SEMANTIC_WEBGPU_MODEL, Math.max(currentHydration.progress, 0.05))
              : markModelHydrationWarming(SEMANTIC_WEBGPU_MODEL, Math.max(currentHydration.progress, 0.4));
          setHydrationState(nextHydration);
        }

        semanticResult = await runSemanticExtractorInWorker(semanticInputRecords, {
          enableWebGpu: semanticWebGpuEnabled,
          webGpuModel: SEMANTIC_WEBGPU_MODEL,
        }, {
          onProgress: (update) => {
            if (!semanticWebGpuEnabled) return;
            const next = toHydrationStatus(update);
            setHydrationState(next);
            if (next.status === 'ready') {
              markModelHydrationReady(next.modelId);
            } else if (next.status === 'failed') {
              markModelHydrationFailed(next.modelId, next.error ?? 'Hydration failed');
            } else {
              bumpModelHydrationProgress(next.modelId, next.progress);
            }
          },
        });
        semanticFacts = semanticResult.facts;

        if (semanticWebGpuEnabled) {
          if (semanticResult.runtime.usedWebGpu) {
            setHydrationState(markModelHydrationReady(SEMANTIC_WEBGPU_MODEL));
          } else if (semanticResult.runtime.fallbackReason === 'no_contracts') {
            // Model path can be active but still yield no accepted contracts.
            setHydrationState(markModelHydrationWarming(SEMANTIC_WEBGPU_MODEL, 0.95));
          } else {
            const reason = semanticResult.runtime.fallbackReason ?? 'unknown';
            setHydrationState(markModelHydrationFailed(
              SEMANTIC_WEBGPU_MODEL,
              `WebGPU path unavailable (${reason}); baseline extraction used.`,
            ));
          }
        }
      } catch (error) {
        console.warn('Semantic extraction worker failed; using baseline extraction only.', error);
        if (semanticWebGpuEnabled) {
          const message = error instanceof Error ? error.message : String(error);
          setHydrationState(markModelHydrationFailed(
            SEMANTIC_WEBGPU_MODEL,
            `Hydration failed: ${message}`,
          ));
        }
      }
    }

    const shadowMetrics = computeSemanticShadowMetrics(baselineFacts, semanticFacts);
    if (semanticResult) {
      appendSemanticShadowSample({
        sourceLabel,
        rolloutMode,
        runtimeMode: semanticResult.runtime.mode,
        usedWebGpu: semanticResult.runtime.usedWebGpu,
        modelId: semanticResult.runtime.modelId,
        fallbackReason: semanticResult.runtime.fallbackReason,
        fallbackMessage: semanticResult.runtime.fallbackMessage,
        baselineCount: shadowMetrics.baselineCount,
        semanticCount: shadowMetrics.semanticCount,
        overlapCount: shadowMetrics.overlapCount,
        semanticOnlyCount: shadowMetrics.semanticOnlyCount,
        baselineOnlyCount: shadowMetrics.baselineOnlyCount,
        precisionProxy: shadowMetrics.precisionProxy,
        recallProxy: shadowMetrics.recallProxy,
        f1Proxy: shadowMetrics.f1Proxy,
      });
      console.info('[semantic-shadow]', {
        source: sourceLabel,
        rolloutMode,
        runtime: semanticResult.runtime,
        metrics: shadowMetrics,
      });
    }

    const shouldMergeSemantic = rolloutMode === 'merge' && semanticFacts.length > 0;
    const generalFacts = shouldMergeSemantic
      ? (mergeFactCollections(baselineFacts, semanticFacts) as GeneralExtractedFact[])
      : baselineFacts;

    const gated = gateGeneralFactsForReview({
      primaryFacts,
      generalFacts,
    });

    const mergedFacts = mergeFactCollections(primaryFacts, gated.acceptedFacts);
    const personas = generatePersonas(mergedFacts);
    const mergedPersonas = mergeImportedPersonas(vault.personas, personas);
    const mergedReviewQueue = mergePendingFactReviews(vault.factReviewQueue ?? [], gated.pendingReviews);

    const ok = await save({
      ...vault,
      personas: mergedPersonas,
      factReviewQueue: mergedReviewQueue,
    });

    if (!ok) {
      toast(`${sourceLabel} import failed during save. Please retry.`, 'error');
      return false;
    }

    if (connectedSourceIds.length > 0) {
      setImportedSources((prev) => {
        const next = new Set(prev);
        for (const sourceId of connectedSourceIds) next.add(sourceId);
        return next;
      });
    }

    toast(
      `${sourceLabel} import complete: ${mergedFacts.length} facts saved, ${gated.stats.pending} queued for review.`,
      'success',
    );
    await refresh();
    return true;
  };

  const handleGmailImport = async () => {
    if (!vault || loading) return;

    setImportingGmail(true);
    try {
      await new Promise((r) => setTimeout(r, 600));
      const canonicalGmail = await loadCanonicalSourceDataset<GmailEmail>('gmail', 'all');
      await applyGeneralLayerImport(
        'Gmail',
        [],
        buildGmailGeneralRecords(canonicalGmail),
        ['gmail'],
      );
    } catch (err) {
      console.error('Gmail import failed:', err);
      toast('Failed to import Gmail data. Please try again.', 'error');
    } finally {
      setImportingGmail(false);
    }
  };

  const handleAmazonImport = async () => {
    if (!vault || loading) return;

    setImportingAmazon(true);
    try {
      await new Promise((r) => setTimeout(r, 600));
      const canonicalAmazon = await loadCanonicalSourceDataset<AmazonOrder>('amazon', 'all');
      await applyGeneralLayerImport(
        'Amazon',
        [],
        buildAmazonGeneralRecords(canonicalAmazon),
        ['amazon'],
      );
    } catch (err) {
      console.error('Amazon import failed:', err);
      toast('Failed to import Amazon data. Please try again.', 'error');
    } finally {
      setImportingAmazon(false);
    }
  };

  const handleClaudeImport = async () => {
    if (!vault || loading) return;

    setImportingClaude(true);
    try {
      await new Promise((r) => setTimeout(r, 600));
      const canonicalClaude = await loadCanonicalSourceDataset<ClaudeExport>('claude', 'all');
      await applyGeneralLayerImport(
        'Claude',
        [],
        buildClaudeGeneralRecords(canonicalClaude),
        ['claude'],
      );
    } catch (err) {
      console.error('Claude import failed:', err);
      toast('Failed to import Claude data. Please try again.', 'error');
    } finally {
      setImportingClaude(false);
    }
  };

  const handleNotionImport = async () => {
    if (!vault || loading) return;

    setImportingNotion(true);
    try {
      await new Promise((r) => setTimeout(r, 600));
      const canonicalNotion = await loadCanonicalSourceDataset<NotionPage>('notion', 'all');
      await applyGeneralLayerImport(
        'Notion',
        [],
        buildNotionGeneralRecords(canonicalNotion),
        ['notion'],
      );
    } catch (err) {
      console.error('Notion import failed:', err);
      toast('Failed to import Notion data. Please try again.', 'error');
    } finally {
      setImportingNotion(false);
    }
  };

  const handleUniversalUploadFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0 || !vault || loading) return;

    setImportingUniversal(true);
    try {
      const parseResult = await parseUniversalUploadFiles(fileList);
      for (const warning of parseResult.warnings.slice(0, 6)) {
        toast(warning, 'info');
      }

      if (parseResult.records.length === 0) {
        toast('No parseable content found in uploaded files.', 'info');
        return;
      }

      const sourceIds = [...new Set(parseResult.records.map((record) => record.sourceType))] as SourceType[];
      await applyGeneralLayerImport(
        'Universal upload',
        [],
        parseResult.records,
        sourceIds,
      );
    } catch (err) {
      console.error('Universal upload failed:', err);
      toast('Upload parsing failed. Please try different files.', 'error');
    } finally {
      setImportingUniversal(false);
    }
  };

  const resolvePendingReview = async (reviewId: string, decision: 'accept' | 'reject') => {
    if (!vault) return;

    const review = (vault.factReviewQueue ?? []).find((item) => item.id === reviewId);
    if (!review) return;

    setReviewActionId(reviewId);
    try {
      let nextPersonas = vault.personas;
      if (decision === 'accept') {
        const acceptedFact: Fact = {
          ...(review.fact as Fact),
          confidence: Math.max(0, Math.min(1, review.fact.confidence)),
          extractedAt: review.fact.extractedAt ?? Date.now(),
        };
        const acceptedPersonas = generatePersonas([acceptedFact]);
        nextPersonas = mergeImportedPersonas(vault.personas, acceptedPersonas);
      }

      const nextQueue = (vault.factReviewQueue ?? []).filter((item) => item.id !== reviewId);

      const ok = await save({
        ...vault,
        personas: nextPersonas,
        factReviewQueue: nextQueue,
      });

      if (!ok) {
        toast('Could not update review decision. Please retry.', 'error');
        return;
      }

      toast(
        decision === 'accept' ? 'Fact accepted and added to persona.' : 'Fact rejected and removed from review queue.',
        'success',
      );
      await refresh();
    } finally {
      setReviewActionId(null);
    }
  };

  if (loading || (!vault && !error && !locked)) {
    return (
      <Layout activeNav="sources" userName={userName} userInitials={userInitials} onNavClick={onNavClick}>
        <SkeletonPage cards={6} />
      </Layout>
    );
  }

  if (locked || (error && !vault)) {
    return (
      <Layout activeNav="sources" userName={userName} userInitials={userInitials} onNavClick={onNavClick}>
        <VaultErrorState error={error ?? 'Vault locked'} locked={locked} onUnlock={unlock} onRetry={refresh} />
      </Layout>
    );
  }

  const connectedSources = liveSources.filter((s) => s.status === 'connected').length;
  const totalFacts = liveSources
    .filter((s) => s.status === 'connected' && s.factsExtracted != null)
    .reduce((sum, s) => sum + (s.factsExtracted ?? 0), 0);
  const semanticWebGpuEnabled = getSemanticWebGpuEnabled();
  const sabFastPathReady = securityHeadersState?.fastPathReady ?? false;
  const sabIssueSummary = securityHeadersState
    ? summarizeSecurityHeadersIssues(securityHeadersState)
    : 'Checking COOP/COEP headers and isolation status...';

  return (
    <Layout activeNav="sources" userName={userName} userInitials={userInitials} onNavClick={onNavClick}>
      <div className="p-8 max-w-5xl animate-fade-in">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">Sources</h1>
          <p className="text-text-secondary">
            Connect data sources to automatically extract and update your personas.
            All extraction happens locally - your raw data never leaves your device.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <div className="glass-card p-4">
            <div className="text-2xl font-bold text-white mb-0.5">{connectedSources}</div>
            <div className="text-text-tertiary text-xs">Connected Sources</div>
          </div>
          <div className="glass-card p-4">
            <div className="text-2xl font-bold text-accent mb-0.5">{totalFacts}</div>
            <div className="text-text-tertiary text-xs">Facts Extracted</div>
          </div>
          <div className="glass-card p-4">
            <div className="text-2xl font-bold text-primary mb-0.5">{sources.length}</div>
            <div className="text-text-tertiary text-xs">Available Sources</div>
          </div>
        </div>

        <div className="glass-card p-4 mb-4 border-accent/20 flex items-start gap-3">
          <Shield className="w-5 h-5 text-accent flex-shrink-0 mt-0.5" />
          <p className="text-text-secondary text-sm">
            Personafy only stores <strong className="text-white">derived facts</strong> (preferences, sizes, patterns) -
            never raw conversations, emails, or documents. Source data is processed locally and discarded.
          </p>
        </div>

        <ModelHydrationStatus
          modelId={SEMANTIC_WEBGPU_MODEL}
          state={hydrationState}
          webGpuEnabled={semanticWebGpuEnabled}
          sabFastPathReady={sabFastPathReady}
          sabIssueSummary={sabIssueSummary}
          onRetry={handleHydrationRetry}
          onCancel={handleHydrationCancel}
          onEnableWebGpu={handleHydrationEnableWebGpu}
        />

        <div className="glass-card p-4 mb-6 border-primary/30 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-white font-semibold">Universal Upload (catch-all parser)</h3>
            <p className="text-text-secondary text-sm">
              Upload mixed files to run a parallel generalized extractor with evidence-backed review gating.
            </p>
          </div>
          <button
            onClick={() => universalUploadRef.current?.click()}
            disabled={importingUniversal || loading}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-60"
          >
            {importingUniversal ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Parsing uploads...
              </>
            ) : (
              <>
                <Upload className="w-4 h-4" />
                Upload Any File(s)
              </>
            )}
          </button>
          <input
            ref={universalUploadRef}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => {
              const { files } = event.target;
              void handleUniversalUploadFiles(files);
              event.target.value = '';
            }}
          />
        </div>

        <div className="space-y-3 stagger-children">
          {liveSources.map((source) => (
            <SourceCard
              key={source.id}
              source={source}
              onNavClick={onNavClick}
              vaultLoading={loading}
              onSampleImport={
                source.id === 'amazon' ? handleAmazonImport
                : source.id === 'gmail' ? handleGmailImport
                  : source.id === 'claude' ? handleClaudeImport
                    : source.id === 'notion' ? handleNotionImport
                      : undefined
              }
              importing={
                source.id === 'amazon' ? importingAmazon
                : source.id === 'gmail' ? importingGmail
                  : source.id === 'claude' ? importingClaude
                    : source.id === 'notion' ? importingNotion
                      : false
              }
              lineage={sourceLineage[source.id]}
            />
          ))}
        </div>

        {pendingFactReviews.length > 0 && (
          <div className="mt-8 glass-card p-5 border-yellow-400/25">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="w-4 h-4 text-yellow-300" />
              <h3 className="text-white font-semibold">Pending Fact Reviews</h3>
              <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-400/15 border border-yellow-400/30 text-yellow-300">
                {pendingFactReviews.length}
              </span>
            </div>
            <p className="text-text-secondary text-sm mb-4">
              Catch-all facts that are sensitive or low-confidence stay here until confirmed.
            </p>
            <div className="space-y-3">
              {pendingFactReviews.map((review) => (
                <PendingFactReviewCard
                  key={review.id}
                  review={review}
                  busy={reviewActionId === review.id}
                  onAccept={() => { void resolvePendingReview(review.id, 'accept'); }}
                  onReject={() => { void resolvePendingReview(review.id, 'reject'); }}
                />
              ))}
            </div>
          </div>
        )}

        <div className="mt-8 glass-card p-6 text-center">
          <Database className="w-8 h-8 text-text-tertiary mx-auto mb-3" />
          <h3 className="text-white font-medium mb-1">Need another source?</h3>
          <p className="text-text-tertiary text-sm mb-4">
            We're adding new data sources regularly. Let us know what you'd like to connect.
          </p>
          <button
            onClick={() => toast('Request noted. Open Settings to contact support with your source request.', 'info')}
            className="text-sm text-accent hover:text-accent/80 transition-colors"
          >
            Request a source -&gt;
          </button>
        </div>
      </div>
    </Layout>
  );
}

function PendingFactReviewCard({
  review,
  busy,
  onAccept,
  onReject,
}: {
  review: PendingFactReview;
  busy: boolean;
  onAccept: () => void;
  onReject: () => void;
}) {
  const confidencePct = Math.round(Math.max(0, Math.min(1, review.fact.confidence)) * 100);
  const evidence = review.fact.evidence ?? [];

  return (
    <div className="p-4 rounded-xl border border-yellow-400/20 bg-yellow-400/5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-white font-medium">{formatFactKey(review.fact.key)}</span>
            <span className="text-[11px] px-2 py-0.5 rounded-full border border-card-border/60 bg-white/5 text-text-tertiary">
              {confidencePct}% confidence
            </span>
            <span className="text-[11px] px-2 py-0.5 rounded-full border border-card-border/60 bg-white/5 text-text-tertiary">
              {review.fact.sensitivity} sensitivity
            </span>
          </div>
          <div className="text-text-secondary text-sm mb-2">{review.fact.value}</div>
          <div className="text-[11px] text-text-tertiary mb-2">{review.reason}</div>
          <div className="space-y-1">
            {evidence.slice(0, 2).map((item) => (
              <div key={`${item.sourceId}-${item.segmentIndex}`} className="text-xs text-text-tertiary truncate">
                Evidence: "{item.snippet}"
              </div>
            ))}
            {evidence.length === 0 && (
              <div className="text-xs text-text-tertiary">No evidence snippet captured.</div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={onReject}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/20 text-text-secondary hover:text-white hover:border-white/40 transition-colors disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
            Reject
          </button>
          <button
            onClick={onAccept}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-accent/40 bg-accent/10 text-accent hover:bg-accent/20 transition-colors disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}

function SourceCard({
  source,
  onNavClick,
  onSampleImport,
  importing,
  vaultLoading,
  lineage,
}: {
  source: Source;
  onNavClick?: (id: string) => void;
  onSampleImport?: () => void;
  importing?: boolean;
  vaultLoading?: boolean;
  lineage: SourceLineage;
}) {
  const Icon = source.icon;
  const status = statusLabels[source.status];
  const isActive = source.status === 'connected';
  const isAvailable = source.status === 'available';

  return (
    <div
      data-testid="source-card"
      className={`glass-card p-5 transition-all duration-200 ${
        source.status === 'coming_soon' ? 'opacity-60' : 'hover:border-accent/20'
      }`}
    >
      <div className="flex items-center gap-4">
        <div className={`w-12 h-12 ${source.bg} rounded-xl flex items-center justify-center flex-shrink-0`}>
          <Icon className={`w-6 h-6 ${source.color}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-1">
            <span className="text-white font-semibold">{source.name}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full ${status.bg} ${status.color} font-medium`}>
              {status.label}
            </span>
            {lineage.contractStatus === 'experimental' && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-yellow-400/15 text-yellow-300 border border-yellow-400/30 font-medium uppercase tracking-wide">
                Experimental
              </span>
            )}
          </div>
          <p className="text-text-tertiary text-sm">
            {source.description}
            {source.exportHelp && (
              <a
                href={source.exportHelp}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 ml-2 px-2.5 py-1 rounded-full bg-accent/10 border border-accent/20 text-accent text-xs font-medium hover:bg-accent/20 hover:border-accent/30 transition-colors"
                onClick={(e) => e.stopPropagation()}
              >
                How to export <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </p>
          <div className="flex flex-wrap items-center gap-2 mt-2 text-[11px] text-text-tertiary">
            <span className={`px-2 py-0.5 rounded-full border ${
              lineage.contractVerified
                ? 'border-accent/40 text-accent bg-accent/10'
                : 'border-yellow-400/30 text-yellow-300 bg-yellow-400/10'
            }`}>
              Contract {lineage.contractVerified ? 'verified' : 'pending'}
            </span>
            <span className="px-2 py-0.5 rounded-full border border-card-border/50 bg-white/5">
              Format {lineage.packageFormat}
            </span>
            <span className="px-2 py-0.5 rounded-full border border-card-border/50 bg-white/5">
              Package v{lineage.packageVersion}
            </span>
          </div>
          {isActive && source.lastSync && (
            <div className="flex items-center gap-4 mt-2 text-xs text-text-tertiary">
              <div className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                Last sync: {new Date(source.lastSync).toLocaleDateString()}
              </div>
              {source.factsExtracted != null && (
                <div className="flex items-center gap-1">
                  <CheckCircle className="w-3 h-3 text-accent" />
                  {source.factsExtracted} facts extracted
                </div>
              )}
            </div>
          )}
        </div>
        <div className="flex-shrink-0">
          {isActive && (
            <button
              onClick={() => onNavClick?.('setup/import')}
              className="flex items-center gap-2 px-3 py-1.5 border border-card-border/50 rounded-lg text-text-secondary hover:text-white hover:border-accent/40 text-xs font-medium transition-colors"
            >
              <RefreshCw className="w-3 h-3" />
              Re-import
            </button>
          )}
          {isAvailable && onSampleImport && (
            <button
              onClick={onSampleImport}
              disabled={importing || vaultLoading}
              className={`flex items-center gap-2 px-3 py-1.5 border rounded-lg text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${sampleButtonClasses(source.id)}`}
            >
              {importing ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Importing...
                </>
              ) : (
                <>
                  <Upload className="w-3 h-3" />
                  Try Sample Data
                </>
              )}
            </button>
          )}
          {isAvailable && !onSampleImport && (
            <button
              onClick={() => toast(`${source.name} import coming soon!`, 'info')}
              className="flex items-center gap-2 px-3 py-1.5 bg-primary/10 border border-primary/30 rounded-lg text-primary hover:bg-primary/20 text-xs font-medium transition-colors"
            >
              <Upload className="w-3 h-3" />
              Connect
            </button>
          )}
          {source.status === 'coming_soon' && (
            <span className="text-text-tertiary/40 text-xs">
              <ArrowRight className="w-4 h-4" />
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
