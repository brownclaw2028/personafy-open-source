import type { PackageAdapter } from './types';
import { findFile, parseIcsCalendar, parseJsonArray } from './helpers';

export const calendarAdapter: PackageAdapter = {
  sourceType: 'calendar',
  requiredPaths: ['calendar.ics'],
  canHandle(ctx) {
    if (ctx.selectedSource && ctx.selectedSource !== 'calendar') return false;
    return ctx.files.some((f) => {
      const path = f.path.toLowerCase();
      return path.endsWith('calendar.ics') || path.endsWith('calendar.json');
    });
  },
  normalize(ctx) {
    const ics = findFile(ctx, (p) => p.endsWith('calendar.ics'));
    if (ics) return parseIcsCalendar(ics);

    const json = findFile(ctx, (p) => p.endsWith('calendar.json'));
    if (json) return parseJsonArray(json, 'Calendar events');

    throw new Error('Calendar package missing calendar.ics or calendar.json');
  },
};
