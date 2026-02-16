import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  GetBucketCorsCommand,
  ListObjectsV2Command,
  PutBucketCorsCommand,
  S3Client,
  UploadPartCommand,
  type CompletedPart,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export const HIPPIUS_ENDPOINT = 'https://s3.hippius.com';
export const HIPPIUS_REGION = 'decentralized';

export const MIN_MULTIPART_PART_SIZE_BYTES = 5 * 1024 * 1024;
export const DEFAULT_MULTIPART_PART_SIZE_BYTES = 128 * 1024 * 1024;
export const MAX_MULTIPART_PART_SIZE_BYTES = 256 * 1024 * 1024;
export const MAX_MULTIPART_PARTS = 10_000;

export const DEFAULT_PART_PRESIGN_EXPIRY_SECONDS = 60 * 60;
export const MAX_PART_PRESIGN_EXPIRY_SECONDS = 60 * 60 * 24 * 7;
export const DEFAULT_PRESIGN_BATCH_SIZE = 8;

export interface HippiusConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  presignBatchSize: number;
}

export interface MultipartPartUrl {
  partNumber: number;
  url: string;
}

export interface CompletePartInput {
  partNumber: number;
  etag: string;
}

export interface ConfigureBucketCorsInput {
  bucket?: string;
  allowedOrigins: string[];
}

export interface SmokeTestBucketCorsInput {
  bucket?: string;
  expectedOrigins: string[];
}

export interface LatestHippiusSnapshot {
  key: string;
  snapshotId: string;
  lastModified?: string;
  sizeBytes?: number;
  envelopeText: string;
}

function sanitizeEnv(name: string): string | null {
  const value = process.env[name];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parsePositiveInt(raw: string | null, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function parsePresignBatchSize(): number {
  const configured = parsePositiveInt(sanitizeEnv('HIPPIUS_PRESIGN_BATCH_SIZE'), DEFAULT_PRESIGN_BATCH_SIZE);
  return Math.max(1, Math.min(32, configured));
}

function requiredEnv(name: string): string {
  const value = sanitizeEnv(name);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function getHippiusConfig(): HippiusConfig {
  const accessKeyId = requiredEnv('HIPPIUS_ACCESS_KEY_ID');
  const secretAccessKey = requiredEnv('HIPPIUS_SECRET_ACCESS_KEY');
  const bucket = requiredEnv('HIPPIUS_BUCKET').toLowerCase();

  if (!accessKeyId.startsWith('hip_')) {
    throw new Error("HIPPIUS_ACCESS_KEY_ID must start with 'hip_'");
  }

  const endpoint = sanitizeEnv('HIPPIUS_S3_ENDPOINT') ?? HIPPIUS_ENDPOINT;
  const region = sanitizeEnv('HIPPIUS_REGION') ?? HIPPIUS_REGION;

  if (endpoint !== HIPPIUS_ENDPOINT) {
    throw new Error(`Invalid HIPPIUS_S3_ENDPOINT. Expected ${HIPPIUS_ENDPOINT}`);
  }
  if (region !== HIPPIUS_REGION) {
    throw new Error(`Invalid HIPPIUS_REGION. Expected ${HIPPIUS_REGION}`);
  }

  return {
    endpoint,
    region,
    bucket,
    accessKeyId,
    secretAccessKey,
    presignBatchSize: parsePresignBatchSize(),
  };
}

export function makeHippiusClient(): S3Client {
  const cfg = getHippiusConfig();
  return new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
    forcePathStyle: true,
  });
}

function normalizeUserId(userId: string): string {
  return userId.trim().toLowerCase();
}

function ensureSafePathToken(value: string, fieldName: string): string {
  const token = value.trim();
  if (!token) {
    throw new Error(`${fieldName} is required`);
  }
  if (!/^[a-zA-Z0-9._:-]+$/.test(token)) {
    throw new Error(`${fieldName} contains invalid characters`);
  }
  return token;
}

export function buildHippiusSnapshotKey(userId: string, snapshotId: string): string {
  const owner = ensureSafePathToken(normalizeUserId(userId), 'userId');
  const snapshot = ensureSafePathToken(snapshotId, 'snapshotId');
  return `vaults/${owner}/${snapshot}.enc`;
}

export function buildHippiusSnapshotPrefix(userId: string): string {
  const owner = ensureSafePathToken(normalizeUserId(userId), 'userId');
  return `vaults/${owner}/`;
}

export function isHippiusKeyOwnedByUser(userId: string, key: string): boolean {
  const ownerPrefix = `vaults/${normalizeUserId(userId)}/`;
  return key.trim().toLowerCase().startsWith(ownerPrefix);
}

function snapshotIdFromKey(key: string): string | null {
  const trimmed = key.trim();
  if (!trimmed.endsWith('.enc')) return null;
  const filename = trimmed.split('/').at(-1);
  if (!filename) return null;
  return filename.slice(0, -4) || null;
}

async function bodyToUtf8(body: unknown): Promise<string> {
  if (typeof body === 'string') return body;
  if (body instanceof Uint8Array) {
    return Buffer.from(body).toString('utf-8');
  }
  if (!body || typeof body !== 'object') {
    throw new Error('Snapshot body is empty');
  }

  const asSdkBody = body as {
    transformToString?: (encoding?: string) => Promise<string>;
    arrayBuffer?: () => Promise<ArrayBuffer>;
    [Symbol.asyncIterator]?: () => AsyncIterator<Uint8Array | Buffer | string>;
  };

  if (typeof asSdkBody.transformToString === 'function') {
    return asSdkBody.transformToString('utf-8');
  }
  if (typeof asSdkBody.arrayBuffer === 'function') {
    const buf = await asSdkBody.arrayBuffer();
    return Buffer.from(buf).toString('utf-8');
  }
  if (typeof asSdkBody[Symbol.asyncIterator] === 'function') {
    const chunks: Buffer[] = [];
    for await (const chunk of asSdkBody as AsyncIterable<Uint8Array | Buffer | string>) {
      if (typeof chunk === 'string') {
        chunks.push(Buffer.from(chunk, 'utf-8'));
        continue;
      }
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString('utf-8');
  }

  throw new Error('Unsupported snapshot body type');
}

export async function readLatestHippiusSnapshotForUser(input: {
  userId: string;
  bucket?: string;
}): Promise<LatestHippiusSnapshot | null> {
  const cfg = getHippiusConfig();
  const bucket = input.bucket ?? cfg.bucket;
  const client = makeHippiusClient();
  const prefix = buildHippiusSnapshotPrefix(input.userId);

  const listed = await client.send(new ListObjectsV2Command({
    Bucket: bucket,
    Prefix: prefix,
    MaxKeys: 1000,
  }));

  const candidates = (listed.Contents ?? [])
    .filter((row) => typeof row.Key === 'string' && row.Key.endsWith('.enc'));

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((a, b) => {
    const aTime = a.LastModified?.getTime() ?? 0;
    const bTime = b.LastModified?.getTime() ?? 0;
    if (bTime !== aTime) return bTime - aTime;
    return (b.Key ?? '').localeCompare(a.Key ?? '');
  });

  const latest = candidates[0];
  const key = latest.Key;
  if (!key) return null;

  const snapshotId = snapshotIdFromKey(key);
  if (!snapshotId) {
    throw new Error(`Latest snapshot key is malformed: ${key}`);
  }

  const objectOut = await client.send(new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  }));
  const envelopeText = await bodyToUtf8(objectOut.Body);

  return {
    key,
    snapshotId,
    lastModified: latest.LastModified?.toISOString(),
    sizeBytes: typeof latest.Size === 'number' ? latest.Size : undefined,
    envelopeText,
  };
}

export function sanitizePartSizeBytes(input: number | null | undefined): number {
  if (input == null || !Number.isFinite(input)) return DEFAULT_MULTIPART_PART_SIZE_BYTES;
  const rounded = Math.floor(input);
  return Math.min(MAX_MULTIPART_PART_SIZE_BYTES, Math.max(MIN_MULTIPART_PART_SIZE_BYTES, rounded));
}

export function computeMultipartPartCount(sizeBytes: number, partSizeBytes: number): number {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    throw new Error('sizeBytes must be a positive number');
  }
  const partCount = Math.ceil(sizeBytes / partSizeBytes);
  if (partCount > MAX_MULTIPART_PARTS) {
    throw new Error(`Multipart upload exceeds ${MAX_MULTIPART_PARTS} parts`);
  }
  return partCount;
}

export function sanitizePartPresignExpirySeconds(input: number | null | undefined): number {
  if (input == null || !Number.isFinite(input)) return DEFAULT_PART_PRESIGN_EXPIRY_SECONDS;
  const rounded = Math.floor(input);
  return Math.min(MAX_PART_PRESIGN_EXPIRY_SECONDS, Math.max(60, rounded));
}

export function chunkPartNumbersForRateLimit(partNumbers: number[], batchSize: number): number[][] {
  const chunks: number[][] = [];
  for (let i = 0; i < partNumbers.length; i += batchSize) {
    chunks.push(partNumbers.slice(i, i + batchSize));
  }
  return chunks;
}

export async function createHippiusMultipartSession(input: {
  key: string;
  contentType?: string;
  bucket?: string;
}): Promise<{ bucket: string; key: string; uploadId: string }> {
  const cfg = getHippiusConfig();
  const bucket = input.bucket ?? cfg.bucket;
  const client = makeHippiusClient();

  const created = await client.send(new CreateMultipartUploadCommand({
    Bucket: bucket,
    Key: input.key,
    ContentType: input.contentType ?? 'application/octet-stream',
  }));

  if (!created.UploadId) {
    throw new Error('CreateMultipartUpload did not return UploadId');
  }

  return {
    bucket,
    key: input.key,
    uploadId: created.UploadId,
  };
}

export async function presignHippiusMultipartParts(input: {
  bucket?: string;
  key: string;
  uploadId: string;
  partNumbers: number[];
  expiresInSeconds?: number;
}): Promise<{ urls: MultipartPartUrl[]; expiresInSeconds: number }> {
  const cfg = getHippiusConfig();
  const bucket = input.bucket ?? cfg.bucket;
  const expiresIn = sanitizePartPresignExpirySeconds(input.expiresInSeconds);
  const client = makeHippiusClient();

  const uniquePartNumbers = Array.from(new Set(input.partNumbers)).sort((a, b) => a - b);
  const urls: MultipartPartUrl[] = [];

  for (const partNumber of uniquePartNumbers) {
    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > MAX_MULTIPART_PARTS) {
      throw new Error(`Invalid part number: ${partNumber}`);
    }
    const command = new UploadPartCommand({
      Bucket: bucket,
      Key: input.key,
      UploadId: input.uploadId,
      PartNumber: partNumber,
    });
    const url = await getSignedUrl(client, command, { expiresIn });
    urls.push({ partNumber, url });
  }

  return {
    urls,
    expiresInSeconds: expiresIn,
  };
}

export function normalizeCompletionParts(parts: CompletePartInput[]): CompletedPart[] {
  const seen = new Set<number>();

  const normalized = parts
    .map((part) => {
      const partNumber = Number(part.partNumber);
      if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > MAX_MULTIPART_PARTS) {
        throw new Error(`Invalid part number in completion payload: ${part.partNumber}`);
      }
      const etag = String(part.etag ?? '').trim();
      if (!etag) {
        throw new Error(`Missing etag for part ${partNumber}`);
      }
      if (seen.has(partNumber)) {
        throw new Error(`Duplicate part number in completion payload: ${partNumber}`);
      }
      seen.add(partNumber);
      return {
        PartNumber: partNumber,
        ETag: etag,
      } satisfies CompletedPart;
    })
    .sort((a, b) => (a.PartNumber ?? 0) - (b.PartNumber ?? 0));

  return normalized;
}

export async function completeHippiusMultipartUpload(input: {
  bucket?: string;
  key: string;
  uploadId: string;
  parts: CompletePartInput[];
}): Promise<{ etag?: string; location?: string; versionId?: string }> {
  const cfg = getHippiusConfig();
  const bucket = input.bucket ?? cfg.bucket;
  const client = makeHippiusClient();

  const completedParts = normalizeCompletionParts(input.parts);

  const out = await client.send(new CompleteMultipartUploadCommand({
    Bucket: bucket,
    Key: input.key,
    UploadId: input.uploadId,
    MultipartUpload: {
      Parts: completedParts,
    },
  }));

  return {
    etag: out.ETag,
    location: out.Location,
    versionId: out.VersionId,
  };
}

export async function abortHippiusMultipartUpload(input: {
  bucket?: string;
  key: string;
  uploadId: string;
}): Promise<void> {
  const cfg = getHippiusConfig();
  const bucket = input.bucket ?? cfg.bucket;
  const client = makeHippiusClient();

  await client.send(new AbortMultipartUploadCommand({
    Bucket: bucket,
    Key: input.key,
    UploadId: input.uploadId,
  }));
}

export async function configureHippiusBucketCors(input: ConfigureBucketCorsInput): Promise<void> {
  const cfg = getHippiusConfig();
  const bucket = input.bucket ?? cfg.bucket;
  const client = makeHippiusClient();

  const uniqueOrigins = Array.from(new Set(input.allowedOrigins.map((origin) => origin.trim()).filter(Boolean)));
  if (uniqueOrigins.length === 0) {
    throw new Error('At least one CORS allowed origin is required');
  }

  await client.send(new PutBucketCorsCommand({
    Bucket: bucket,
    CORSConfiguration: {
      CORSRules: [
        {
          AllowedHeaders: ['Authorization', 'x-amz-date', 'x-amz-content-sha256', 'x-amz-acl', 'content-type'],
          AllowedMethods: ['GET', 'PUT', 'POST', 'HEAD'],
          AllowedOrigins: uniqueOrigins,
          ExposeHeaders: ['ETag', 'x-amz-request-id'],
          MaxAgeSeconds: 3600,
        },
      ],
    },
  }));
}

export async function smokeTestHippiusBucketCors(input: SmokeTestBucketCorsInput): Promise<{
  bucket: string;
  matchedOrigins: string[];
}> {
  const cfg = getHippiusConfig();
  const bucket = input.bucket ?? cfg.bucket;
  const client = makeHippiusClient();

  const out = await client.send(new GetBucketCorsCommand({ Bucket: bucket }));
  const allowedOrigins = new Set(
    (out.CORSRules ?? [])
      .flatMap((rule) => rule.AllowedOrigins ?? [])
      .map((origin) => origin.trim()),
  );

  const expected = Array.from(new Set(input.expectedOrigins.map((origin) => origin.trim()).filter(Boolean)));
  const missing = expected.filter((origin) => !allowedOrigins.has(origin));
  if (missing.length > 0) {
    throw new Error(`CORS smoke test failed. Missing origins: ${missing.join(', ')}`);
  }

  return {
    bucket,
    matchedOrigins: expected,
  };
}
