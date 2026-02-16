import type { SourceType } from '../../dev/types';

export interface PackageAdapterFile {
  path: string;
  content: string;
}

export interface PackageAdapterContext {
  files: PackageAdapterFile[];
  selectedSource?: SourceType;
}

export interface PackageAdapter<T = unknown> {
  sourceType: SourceType;
  requiredPaths: string[];
  canHandle: (ctx: PackageAdapterContext) => boolean;
  normalize: (ctx: PackageAdapterContext) => T[];
}
