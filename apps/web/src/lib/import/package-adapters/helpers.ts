import type { PackageAdapterContext } from './types';

export function normalizePath(input: string): string {
  return input.replace(/\\/g, '/').replace(/^\.\/+/, '').toLowerCase();
}

export function findFile(
  ctx: PackageAdapterContext,
  matcher: (normalizedPath: string) => boolean,
): string | null {
  const matched = ctx.files.find((f) => matcher(normalizePath(f.path)));
  return matched?.content ?? null;
}

export function parseJsonArray(input: string, sourceLabel: string): unknown[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch (error) {
    throw new Error(`${sourceLabel} file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`${sourceLabel} content must be a JSON array`);
  }

  return parsed;
}

export interface ParsedCalendarEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  location?: string;
  description?: string;
  status?: string;
  attendees?: Array<{ email: string; name?: string }>;
}

function parseIcsDate(value: string): string {
  const trimmed = value.trim();
  // Supports YYYYMMDDTHHMMSSZ and YYYYMMDDTHHMMSS.
  const match = trimmed.match(
    /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?(Z)?$/,
  );
  if (!match) return value;
  const [, y, m, d, hh = '00', mm = '00', ss = '00', z] = match;
  const iso = `${y}-${m}-${d}T${hh}:${mm}:${ss}${z ? 'Z' : ''}`;
  return iso;
}

function unfoldIcsLines(content: string): string[] {
  const raw = content.replace(/\r\n/g, '\n').split('\n');
  const lines: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }
  }
  return lines;
}

export function parseIcsCalendar(content: string): ParsedCalendarEvent[] {
  const lines = unfoldIcsLines(content);
  const events: ParsedCalendarEvent[] = [];
  let current: ParsedCalendarEvent | null = null;
  let attendeeList: ParsedCalendarEvent['attendees'] = [];

  for (const line of lines) {
    if (!line) continue;
    if (line === 'BEGIN:VEVENT') {
      current = {
        id: '',
        summary: '',
        start: '',
        end: '',
      };
      attendeeList = [];
      continue;
    }

    if (line === 'END:VEVENT') {
      if (current) {
        current.attendees = attendeeList.length > 0 ? attendeeList : undefined;
        if (!current.id) current.id = `evt-${events.length + 1}`;
        events.push(current);
      }
      current = null;
      attendeeList = [];
      continue;
    }

    if (!current) continue;

    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    const head = line.slice(0, separator);
    const rawValue = line.slice(separator + 1);
    const [key, ...params] = head.split(';');
    const upperKey = key.toUpperCase();

    if (upperKey === 'UID') current.id = rawValue.trim();
    if (upperKey === 'SUMMARY') current.summary = rawValue.trim();
    if (upperKey === 'DTSTART') current.start = parseIcsDate(rawValue);
    if (upperKey === 'DTEND') current.end = parseIcsDate(rawValue);
    if (upperKey === 'LOCATION') current.location = rawValue.trim();
    if (upperKey === 'DESCRIPTION') current.description = rawValue.trim();
    if (upperKey === 'STATUS') current.status = rawValue.trim().toLowerCase();
    if (upperKey === 'ATTENDEE') {
      const attendee: { email: string; name?: string } = { email: '' };
      for (const param of params) {
        const [paramKey, paramValue] = param.split('=');
        if (!paramKey || !paramValue) continue;
        if (paramKey.toUpperCase() === 'CN') attendee.name = paramValue;
      }

      if (rawValue.toLowerCase().startsWith('mailto:')) {
        attendee.email = rawValue.slice(7).trim();
      } else {
        attendee.email = rawValue.trim();
      }

      if (attendee.email) attendeeList.push(attendee);
    }
  }

  return events;
}
