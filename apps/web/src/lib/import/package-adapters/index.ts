import type { SourceType } from '../../dev/types';
import type { PackageAdapter, PackageAdapterContext, PackageAdapterFile } from './types';
import { amazonAdapter } from './amazon-adapter';
import { calendarAdapter } from './calendar-adapter';
import { chatgptAdapter } from './chatgpt-adapter';
import { claudeAdapter } from './claude-adapter';
import { geminiAdapter } from './gemini-adapter';
import { gmailAdapter } from './gmail-adapter';
import { notionAdapter } from './notion-adapter';

export const PACKAGE_ADAPTERS: PackageAdapter[] = [
  gmailAdapter,
  amazonAdapter,
  claudeAdapter,
  notionAdapter,
  geminiAdapter,
  calendarAdapter,
  chatgptAdapter,
];

export function createAdapterContext(
  files: PackageAdapterFile[],
  selectedSource?: SourceType,
): PackageAdapterContext {
  return { files, selectedSource };
}

export function selectPackageAdapter(ctx: PackageAdapterContext): PackageAdapter {
  if (ctx.selectedSource) {
    const forced = PACKAGE_ADAPTERS.find((adapter) => adapter.sourceType === ctx.selectedSource);
    if (!forced) {
      throw new Error(`No adapter registered for source ${ctx.selectedSource}`);
    }
    return forced;
  }

  const detected = PACKAGE_ADAPTERS.find((adapter) => adapter.canHandle(ctx));
  if (!detected) {
    throw new Error('Could not detect source type from package contents');
  }
  return detected;
}

export type { PackageAdapter, PackageAdapterContext, PackageAdapterFile };
