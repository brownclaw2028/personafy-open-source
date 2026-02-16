import type { PackageAdapter } from './types';
import { findFile, parseJsonArray } from './helpers';

export const geminiAdapter: PackageAdapter = {
  sourceType: 'gemini',
  requiredPaths: ['gemini/conversations.json'],
  canHandle(ctx) {
    if (ctx.selectedSource && ctx.selectedSource !== 'gemini') return false;
    return ctx.files.some((f) => {
      const path = f.path.toLowerCase();
      return path.endsWith('gemini/conversations.json') || path.endsWith('gemini.json');
    });
  },
  normalize(ctx) {
    const raw = findFile(
      ctx,
      (p) => p.endsWith('gemini/conversations.json') || p.endsWith('gemini.json'),
    );
    if (!raw) {
      throw new Error('Gemini package missing conversations dataset');
    }
    return parseJsonArray(raw, 'Gemini conversations');
  },
};
