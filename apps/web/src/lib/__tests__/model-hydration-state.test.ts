import { describe, expect, it } from 'vitest';
import {
  bumpModelHydrationProgress,
  hydrationStorageKey,
  markModelHydrationDownloading,
  markModelHydrationFailed,
  markModelHydrationReady,
  markModelHydrationWarming,
  readModelHydrationState,
  resetModelHydrationState,
  writeModelHydrationState,
} from '../model-hydration-state';

class MemoryStorage {
  private store = new Map<string, string>();

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }
}

describe('model hydration state', () => {
  it('returns a not_downloaded default when state does not exist', () => {
    const storage = new MemoryStorage();

    const state = readModelHydrationState('Llama-3.2-1B-Instruct-q4f16_1', storage);

    expect(state.status).toBe('not_downloaded');
    expect(state.progress).toBe(0);
  });

  it('writes and reads state with normalized progress', () => {
    const storage = new MemoryStorage();

    writeModelHydrationState({
      modelId: 'Llama-3.2-1B-Instruct-q4f16_1',
      status: 'downloading',
      progress: 9,
      updatedAt: Date.now(),
    }, storage);

    const state = readModelHydrationState('Llama-3.2-1B-Instruct-q4f16_1', storage);

    expect(state.status).toBe('downloading');
    expect(state.progress).toBe(1);
  });

  it('supports lifecycle helpers for downloading/warming/ready/failed', () => {
    const storage = new MemoryStorage();
    const modelId = 'Llama-3.2-1B-Instruct-q4f16_1';

    const downloading = markModelHydrationDownloading(modelId, 0.2, storage);
    expect(downloading.status).toBe('downloading');
    expect(downloading.progress).toBe(0.2);

    const warming = markModelHydrationWarming(modelId, 0.91, storage);
    expect(warming.status).toBe('warming');
    expect(warming.progress).toBe(0.91);

    const ready = markModelHydrationReady(modelId, storage);
    expect(ready.status).toBe('ready');
    expect(ready.progress).toBe(1);

    const failed = markModelHydrationFailed(modelId, 'download timeout', storage);
    expect(failed.status).toBe('failed');
    expect(failed.error).toContain('download timeout');
  });

  it('bumps progress monotonically and transitions to warming at high progress', () => {
    const storage = new MemoryStorage();
    const modelId = 'Llama-3.2-1B-Instruct-q4f16_1';

    markModelHydrationDownloading(modelId, 0.25, storage);
    const unchanged = bumpModelHydrationProgress(modelId, 0.1, storage);
    expect(unchanged.progress).toBe(0.25);
    expect(unchanged.status).toBe('downloading');

    const warmed = bumpModelHydrationProgress(modelId, 0.82, storage);
    expect(warmed.progress).toBe(0.82);
    expect(warmed.status).toBe('warming');
  });

  it('resets stored hydration state', () => {
    const storage = new MemoryStorage();
    const modelId = 'Llama-3.2-1B-Instruct-q4f16_1';

    markModelHydrationReady(modelId, storage);
    expect(storage.getItem(hydrationStorageKey(modelId))).not.toBeNull();

    const reset = resetModelHydrationState(modelId, storage);
    expect(reset.status).toBe('not_downloaded');
    expect(storage.getItem(hydrationStorageKey(modelId))).toBeNull();
  });
});
