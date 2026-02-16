import type { PackageAdapter } from './types';
import { parseNotionExportFiles } from '../notion-export-parser';
import { findFile, normalizePath, parseJsonArray } from './helpers';

const NOTION_ID_SUFFIX_REGEX
  = /(?:^|[\s(])([a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}|(?=[a-f0-9]*[a-f])(?=[a-f0-9]*\d)[a-f0-9]{6,}|[a-z0-9]+-[a-z0-9]+-\d{2,})\)?$/i;

function fileStem(pathValue: string): string {
  const filename = pathValue.split('/').pop() ?? pathValue;
  return filename.replace(/\.[^.]+$/, '');
}

function hasNotionStyleIdSuffix(pathValue: string): boolean {
  return NOTION_ID_SUFFIX_REGEX.test(fileStem(pathValue));
}

export const notionAdapter: PackageAdapter = {
  sourceType: 'notion',
  requiredPaths: ['notion-export/index.html'],
  canHandle(ctx) {
    if (ctx.selectedSource && ctx.selectedSource !== 'notion') return false;

    const normalizedPaths = ctx.files.map((file) => normalizePath(file.path));
    const hasLegacyJson = normalizedPaths.some(
      (path) => path.endsWith('notion-export/pages.json') || path.endsWith('notion.json'),
    );
    if (hasLegacyJson) return true;

    const notionContentPaths = normalizedPaths.filter(
      (path) => path.endsWith('.md') || path.endsWith('.csv'),
    );
    if (notionContentPaths.length === 0) return false;

    if (ctx.selectedSource === 'notion') return true;
    const hasExplicitNotionMarker = normalizedPaths.some(
      (path) => path.includes('notion') || path.endsWith('index.html'),
    );
    if (hasExplicitNotionMarker) return true;

    return notionContentPaths.some((path) => hasNotionStyleIdSuffix(path));
  },
  normalize(ctx) {
    const notionContentFiles = ctx.files.filter((file) => {
      const path = normalizePath(file.path);
      return path.endsWith('.md') || path.endsWith('.csv');
    });

    if (notionContentFiles.length > 0) {
      const parsed = parseNotionExportFiles(notionContentFiles);
      if (parsed.length > 0) return parsed;
    }

    const raw = findFile(
      ctx,
      (p) => p.endsWith('notion-export/pages.json') || p.endsWith('notion.json'),
    );
    if (!raw) {
      throw new Error('Notion package missing pages dataset');
    }
    return parseJsonArray(raw, 'Notion pages');
  },
};
