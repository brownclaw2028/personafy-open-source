import { beforeEach, describe, expect, it } from 'vitest';
import {
  estimateCloudBackupMonthlyCost,
  finishCloudBackupRun,
  getCloudBackupMetricsSummary,
  recordCloudBackupHttpStatus,
  resetCloudBackupMetricsForTests,
  startCloudBackupRun,
} from '../cloud-backup-metrics';

describe('cloud backup metrics telemetry', () => {
  beforeEach(() => {
    resetCloudBackupMetricsForTests();
  });

  it('tracks completion rate, latency, retries, and 429 counts', () => {
    const completed = startCloudBackupRun({
      snapshotId: 'snap-1',
      provider: 'hippius',
      totalBytes: 1024,
      expectedPartCount: 2,
    });
    recordCloudBackupHttpStatus(completed, 200);
    recordCloudBackupHttpStatus(completed, 429);
    finishCloudBackupRun(completed, { outcome: 'completed', partRetries: 1 });

    const failed = startCloudBackupRun({
      snapshotId: 'snap-2',
      provider: 'hippius',
      totalBytes: 2048,
      expectedPartCount: 3,
    });
    recordCloudBackupHttpStatus(failed, 503);
    finishCloudBackupRun(failed, { outcome: 'failed', partRetries: 2, errorCode: 'api_request_failed' });

    const summary = getCloudBackupMetricsSummary();
    expect(summary.totalRuns).toBe(2);
    expect(summary.completedRuns).toBe(1);
    expect(summary.failedRuns).toBe(1);
    expect(summary.completionRate).toBeCloseTo(0.5, 5);
    expect(summary.totalPartRetries).toBe(3);
    expect(summary.total429Responses).toBe(1);
    expect(summary.avgLatencyMs).toBeGreaterThanOrEqual(0);
    expect(summary.p95LatencyMs).toBeGreaterThanOrEqual(0);
    expect(summary.lastRun?.snapshotId).toBe('snap-2');
  });

  it('estimates monthly storage and request cost from workload profile', () => {
    const estimate = estimateCloudBackupMonthlyCost(
      {
        storagePricePerGbMonthUsd: 0.02,
        requestPricePer1000Usd: 0.005,
      },
      {
        usedBytes: 5 * 1024 ** 3,
        monthlyPutRequests: 12_000,
      },
    );

    expect(estimate.storageCostUsd).toBeCloseTo(0.1, 5);
    expect(estimate.requestCostUsd).toBeCloseTo(0.06, 5);
    expect(estimate.totalCostUsd).toBeCloseTo(0.16, 5);
  });
});
