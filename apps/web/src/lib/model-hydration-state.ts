export type ModelHydrationStatus =
  | 'not_downloaded'
  | 'downloading'
  | 'warming'
  | 'ready'
  | 'failed';

export interface ModelHydrationState {
  modelId: string;
  status: ModelHydrationStatus;
  updatedAt: number;
  progress: number;
  error?: string;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const STORAGE_PREFIX = 'personafy.semantic.modelHydration';

function safeWindowStorage(): StorageLike | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

function normalizeModelId(modelId: string): string {
  const normalized = modelId.trim();
  return normalized.length > 0 ? normalized : 'unknown-model';
}

function normalizeProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  return Math.max(0, Math.min(1, progress));
}

function normalizeState(input: Partial<ModelHydrationState> & { modelId: string }): ModelHydrationState {
  const status = input.status ?? 'not_downloaded';
  const progress = status === 'ready'
    ? 1
    : status === 'failed'
      ? normalizeProgress(input.progress ?? 0)
      : normalizeProgress(input.progress ?? 0);

  return {
    modelId: normalizeModelId(input.modelId),
    status,
    progress,
    updatedAt: input.updatedAt ?? Date.now(),
    error: input.error,
  };
}

export function hydrationStorageKey(modelId: string): string {
  return `${STORAGE_PREFIX}.${normalizeModelId(modelId)}`;
}

export function readModelHydrationState(modelId: string, storage: StorageLike | null = safeWindowStorage()): ModelHydrationState {
  const key = hydrationStorageKey(modelId);
  if (!storage) {
    return normalizeState({ modelId, status: 'not_downloaded', progress: 0 });
  }

  const raw = storage.getItem(key);
  if (!raw) {
    return normalizeState({ modelId, status: 'not_downloaded', progress: 0 });
  }

  try {
    const parsed = JSON.parse(raw) as Partial<ModelHydrationState>;
    return normalizeState({ ...parsed, modelId });
  } catch {
    return normalizeState({ modelId, status: 'not_downloaded', progress: 0 });
  }
}

export function writeModelHydrationState(state: ModelHydrationState, storage: StorageLike | null = safeWindowStorage()): ModelHydrationState {
  const normalized = normalizeState(state);
  if (!storage) return normalized;

  try {
    storage.setItem(hydrationStorageKey(normalized.modelId), JSON.stringify(normalized));
  } catch {
    // ignore storage limitations
  }

  return normalized;
}

export function resetModelHydrationState(modelId: string, storage: StorageLike | null = safeWindowStorage()): ModelHydrationState {
  const normalizedModelId = normalizeModelId(modelId);
  if (storage) {
    try {
      storage.removeItem(hydrationStorageKey(normalizedModelId));
    } catch {
      // ignore storage limitations
    }
  }
  return normalizeState({ modelId: normalizedModelId, status: 'not_downloaded', progress: 0 });
}

export function markModelHydrationDownloading(
  modelId: string,
  progress = 0.1,
  storage: StorageLike | null = safeWindowStorage(),
): ModelHydrationState {
  return writeModelHydrationState({
    modelId,
    status: 'downloading',
    progress: normalizeProgress(progress),
    updatedAt: Date.now(),
  }, storage);
}

export function markModelHydrationWarming(
  modelId: string,
  progress = 0.85,
  storage: StorageLike | null = safeWindowStorage(),
): ModelHydrationState {
  return writeModelHydrationState({
    modelId,
    status: 'warming',
    progress: normalizeProgress(progress),
    updatedAt: Date.now(),
  }, storage);
}

export function markModelHydrationReady(
  modelId: string,
  storage: StorageLike | null = safeWindowStorage(),
): ModelHydrationState {
  return writeModelHydrationState({
    modelId,
    status: 'ready',
    progress: 1,
    updatedAt: Date.now(),
  }, storage);
}

export function markModelHydrationFailed(
  modelId: string,
  error: string,
  storage: StorageLike | null = safeWindowStorage(),
): ModelHydrationState {
  return writeModelHydrationState({
    modelId,
    status: 'failed',
    progress: 0,
    error: error.trim() || 'Unknown model hydration error',
    updatedAt: Date.now(),
  }, storage);
}

export function bumpModelHydrationProgress(
  modelId: string,
  nextProgress: number,
  storage: StorageLike | null = safeWindowStorage(),
): ModelHydrationState {
  const current = readModelHydrationState(modelId, storage);
  const progress = Math.max(current.progress, normalizeProgress(nextProgress));

  if (current.status === 'ready') {
    return current;
  }

  const status: ModelHydrationStatus = progress >= 0.8 ? 'warming' : 'downloading';
  return writeModelHydrationState({
    ...current,
    status,
    progress,
    updatedAt: Date.now(),
  }, storage);
}
