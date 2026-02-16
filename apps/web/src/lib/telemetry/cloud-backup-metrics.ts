export type CloudBackupRunOutcome = 'completed' | 'failed' | 'cancelled';

export interface CloudBackupRunRecord {
  snapshotId: string;
  provider: string;
  startedAtMs: number;
  finishedAtMs: number;
  durationMs: number;
  totalBytes: number;
  expectedPartCount: number;
  httpAttemptCount: number;
  throttle429Count: number;
  partRetries: number;
  outcome: CloudBackupRunOutcome;
  errorCode?: string;
}

export interface CloudBackupMetricsSummary {
  totalRuns: number;
  completedRuns: number;
  failedRuns: number;
  cancelledRuns: number;
  completionRate: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  totalPartRetries: number;
  total429Responses: number;
  lastRun?: CloudBackupRunRecord;
}

export interface CloudBackupRunTracker {
  snapshotId: string;
  provider: string;
  startedAtMs: number;
  totalBytes: number;
  expectedPartCount: number;
  httpAttemptCount: number;
  throttle429Count: number;
}

export interface CloudBackupPricingAssumptions {
  storagePricePerGbMonthUsd: number;
  requestPricePer1000Usd: number;
}

export interface CloudBackupWorkloadProfile {
  usedBytes: number;
  monthlyPutRequests: number;
}

export interface CloudBackupCostEstimate {
  storageCostUsd: number;
  requestCostUsd: number;
  totalCostUsd: number;
}

interface PersistedCloudBackupMetrics {
  version: 1;
  runs: CloudBackupRunRecord[];
}

const STORAGE_KEY = 'personafy_cloud_backup_metrics_v1';
const MAX_RUNS = 100;

let memoryStore: PersistedCloudBackupMetrics = { version: 1, runs: [] };

function canUseLocalStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function readStore(): PersistedCloudBackupMetrics {
  if (!canUseLocalStorage()) return memoryStore;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { version: 1, runs: [] };
    const parsed = JSON.parse(raw) as Partial<PersistedCloudBackupMetrics>;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.runs)) {
      return { version: 1, runs: [] };
    }
    return {
      version: 1,
      runs: parsed.runs.filter((run) => run && typeof run.durationMs === 'number'),
    };
  } catch {
    return { version: 1, runs: [] };
  }
}

function writeStore(store: PersistedCloudBackupMetrics): void {
  memoryStore = store;
  if (!canUseLocalStorage()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // ignore persistence failures
  }
}

function clampNonNegativeNumber(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return value;
}

function roundCurrency(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1));
  return sorted[idx];
}

export function startCloudBackupRun(input: {
  snapshotId: string;
  provider: string;
  totalBytes: number;
  expectedPartCount: number;
}): CloudBackupRunTracker {
  return {
    snapshotId: input.snapshotId,
    provider: input.provider,
    startedAtMs: Date.now(),
    totalBytes: clampNonNegativeNumber(input.totalBytes),
    expectedPartCount: clampNonNegativeNumber(input.expectedPartCount),
    httpAttemptCount: 0,
    throttle429Count: 0,
  };
}

export function recordCloudBackupHttpStatus(tracker: CloudBackupRunTracker, status: number): void {
  if (!Number.isFinite(status) || status <= 0) return;
  tracker.httpAttemptCount += 1;
  if (status === 429) {
    tracker.throttle429Count += 1;
  }
}

export function finishCloudBackupRun(
  tracker: CloudBackupRunTracker,
  input: {
    outcome: CloudBackupRunOutcome;
    partRetries: number;
    errorCode?: string;
  },
): CloudBackupRunRecord {
  const finishedAtMs = Date.now();
  const record: CloudBackupRunRecord = {
    snapshotId: tracker.snapshotId,
    provider: tracker.provider,
    startedAtMs: tracker.startedAtMs,
    finishedAtMs,
    durationMs: Math.max(0, finishedAtMs - tracker.startedAtMs),
    totalBytes: tracker.totalBytes,
    expectedPartCount: tracker.expectedPartCount,
    httpAttemptCount: tracker.httpAttemptCount,
    throttle429Count: tracker.throttle429Count,
    partRetries: clampNonNegativeNumber(input.partRetries),
    outcome: input.outcome,
    errorCode: input.errorCode,
  };

  const current = readStore();
  const nextRuns = [...current.runs, record].slice(-MAX_RUNS);
  writeStore({ version: 1, runs: nextRuns });
  return record;
}

export function getCloudBackupMetricsSummary(): CloudBackupMetricsSummary {
  const store = readStore();
  const totalRuns = store.runs.length;
  const completedRuns = store.runs.filter((run) => run.outcome === 'completed').length;
  const failedRuns = store.runs.filter((run) => run.outcome === 'failed').length;
  const cancelledRuns = store.runs.filter((run) => run.outcome === 'cancelled').length;
  const totalPartRetries = store.runs.reduce((sum, run) => sum + run.partRetries, 0);
  const total429Responses = store.runs.reduce((sum, run) => sum + run.throttle429Count, 0);
  const latencies = store.runs.map((run) => run.durationMs);
  const completionRate = totalRuns > 0 ? completedRuns / totalRuns : 0;
  const avgLatencyMs = totalRuns > 0
    ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / totalRuns)
    : 0;

  return {
    totalRuns,
    completedRuns,
    failedRuns,
    cancelledRuns,
    completionRate,
    avgLatencyMs,
    p95LatencyMs: percentile(latencies, 0.95),
    totalPartRetries,
    total429Responses,
    lastRun: store.runs.at(-1),
  };
}

export function estimateCloudBackupMonthlyCost(
  pricing: CloudBackupPricingAssumptions,
  profile: CloudBackupWorkloadProfile,
): CloudBackupCostEstimate {
  const usedGb = clampNonNegativeNumber(profile.usedBytes) / (1024 ** 3);
  const monthlyPutUnits = clampNonNegativeNumber(profile.monthlyPutRequests) / 1000;
  const storageCostUsd = usedGb * clampNonNegativeNumber(pricing.storagePricePerGbMonthUsd);
  const requestCostUsd = monthlyPutUnits * clampNonNegativeNumber(pricing.requestPricePer1000Usd);
  return {
    storageCostUsd: roundCurrency(storageCostUsd),
    requestCostUsd: roundCurrency(requestCostUsd),
    totalCostUsd: roundCurrency(storageCostUsd + requestCostUsd),
  };
}

export function resetCloudBackupMetricsForTests(): void {
  writeStore({ version: 1, runs: [] });
}
