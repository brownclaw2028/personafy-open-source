import type { PackageAdapter } from './types';
import { parseAmazonOrderHistoryCsvFiles } from '../amazon-csv-parser';
import { findFile, normalizePath, parseJsonArray } from './helpers';

function isAmazonOrderHistoryCsv(path: string): boolean {
  return path.endsWith('.csv') && path.includes('retail.orderhistory');
}

export const amazonAdapter: PackageAdapter = {
  sourceType: 'amazon',
  requiredPaths: ['retail.orderhistory.csv'],
  canHandle(ctx) {
    if (ctx.selectedSource && ctx.selectedSource !== 'amazon') return false;
    return ctx.files.some((f) => {
      const path = normalizePath(f.path);
      return (
        isAmazonOrderHistoryCsv(path)
        || path.endsWith('records/physical_orders.json')
        || path.endsWith('amazon.json')
      );
    });
  },
  normalize(ctx) {
    const csvFiles = ctx.files
      .filter((file) => isAmazonOrderHistoryCsv(normalizePath(file.path)))
      .map((file) => ({ path: file.path, content: file.content }));

    if (csvFiles.length > 0) {
      const records = parseAmazonOrderHistoryCsvFiles(csvFiles);
      if (records.length === 0) {
        throw new Error('Amazon CSV missing required columns or order rows');
      }
      return records;
    }

    const raw = findFile(
      ctx,
      (p) => p.endsWith('records/physical_orders.json') || p.endsWith('amazon.json'),
    );
    if (!raw) {
      throw new Error('Amazon package missing physical_orders dataset');
    }
    return parseJsonArray(raw, 'Amazon orders');
  },
};
