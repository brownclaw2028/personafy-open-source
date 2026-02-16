import {
  type ApiRequest,
  type ApiResponse,
  ensureObject,
  generateRequestId,
  getErrorMessage,
  json,
  logRequest,
  rateLimit,
  requireUser,
  safeErrorMessage,
} from '../_utils';
import {
  chunkPartNumbersForRateLimit,
  getHippiusConfig,
  isHippiusKeyOwnedByUser,
  presignHippiusMultipartParts,
  sanitizePartPresignExpirySeconds,
} from '../_storage/hippiusClient';

function parsePartNumbers(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const out: number[] = [];
  for (const raw of value) {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1) return null;
    out.push(n);
  }
  return out;
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  const requestId = generateRequestId();
  const start = Date.now();

  if (!rateLimit(req, res, 30)) return;

  if (req.method !== 'POST') {
    json(res, 405, { error: 'Method not allowed' });
    logRequest(requestId, req.method ?? 'UNKNOWN', '/api/cloud-backup/presign-parts', 405, Date.now() - start);
    return;
  }

  try {
    const user = await requireUser(req, res);
    if (!user) {
      logRequest(requestId, 'POST', '/api/cloud-backup/presign-parts', res.statusCode, Date.now() - start);
      return;
    }

    const body = ensureObject(req.body);
    if (!body) {
      json(res, 400, { error: 'Invalid JSON body' });
      logRequest(requestId, 'POST', '/api/cloud-backup/presign-parts', 400, Date.now() - start);
      return;
    }

    const key = typeof body.key === 'string' ? body.key.trim() : '';
    if (!key) {
      json(res, 400, { error: 'key is required' });
      logRequest(requestId, 'POST', '/api/cloud-backup/presign-parts', 400, Date.now() - start);
      return;
    }

    if (!isHippiusKeyOwnedByUser(user.id, key)) {
      json(res, 403, { error: 'Forbidden: key ownership mismatch' });
      logRequest(requestId, 'POST', '/api/cloud-backup/presign-parts', 403, Date.now() - start);
      return;
    }

    const uploadId = typeof body.uploadId === 'string' ? body.uploadId.trim() : '';
    if (!uploadId) {
      json(res, 400, { error: 'uploadId is required' });
      logRequest(requestId, 'POST', '/api/cloud-backup/presign-parts', 400, Date.now() - start);
      return;
    }

    const partNumbers = parsePartNumbers(body.partNumbers);
    if (!partNumbers) {
      json(res, 400, { error: 'partNumbers must be a non-empty integer array' });
      logRequest(requestId, 'POST', '/api/cloud-backup/presign-parts', 400, Date.now() - start);
      return;
    }

    const expiresInSeconds = sanitizePartPresignExpirySeconds(
      body.expiresInSeconds == null ? null : Number(body.expiresInSeconds),
    );

    const cfg = getHippiusConfig();
    const chunkedParts = chunkPartNumbersForRateLimit(partNumbers, cfg.presignBatchSize);

    const urls: Array<{ partNumber: number; url: string }> = [];
    for (const chunk of chunkedParts) {
      const signed = await presignHippiusMultipartParts({
        key,
        uploadId,
        partNumbers: chunk,
        expiresInSeconds,
      });
      urls.push(...signed.urls);
    }

    urls.sort((a, b) => a.partNumber - b.partNumber);

    json(res, 200, {
      key,
      uploadId,
      expiresInSeconds,
      urls,
    });
    logRequest(requestId, 'POST', '/api/cloud-backup/presign-parts', 200, Date.now() - start);
  } catch (err: unknown) {
    const errMsg = getErrorMessage(err);
    json(res, 500, { error: safeErrorMessage(requestId, errMsg), requestId });
    logRequest(requestId, 'POST', '/api/cloud-backup/presign-parts', 500, Date.now() - start, errMsg);
  }
}
