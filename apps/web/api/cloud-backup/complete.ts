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
  completeHippiusMultipartUpload,
  isHippiusKeyOwnedByUser,
  normalizeCompletionParts,
  type CompletePartInput,
} from '../_storage/hippiusClient';

function parseParts(value: unknown): CompletePartInput[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;

  const out: CompletePartInput[] = [];
  for (const row of value) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
    const part = row as Record<string, unknown>;
    const partNumber = Number(part.partNumber);
    const etag = typeof part.etag === 'string' ? part.etag.trim() : '';
    if (!Number.isInteger(partNumber) || partNumber < 1 || !etag) return null;
    out.push({ partNumber, etag });
  }

  return out;
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  const requestId = generateRequestId();
  const start = Date.now();

  if (!rateLimit(req, res, 20)) return;

  if (req.method !== 'POST') {
    json(res, 405, { error: 'Method not allowed' });
    logRequest(requestId, req.method ?? 'UNKNOWN', '/api/cloud-backup/complete', 405, Date.now() - start);
    return;
  }

  try {
    const user = await requireUser(req, res);
    if (!user) {
      logRequest(requestId, 'POST', '/api/cloud-backup/complete', res.statusCode, Date.now() - start);
      return;
    }

    const body = ensureObject(req.body);
    if (!body) {
      json(res, 400, { error: 'Invalid JSON body' });
      logRequest(requestId, 'POST', '/api/cloud-backup/complete', 400, Date.now() - start);
      return;
    }

    const key = typeof body.key === 'string' ? body.key.trim() : '';
    if (!key) {
      json(res, 400, { error: 'key is required' });
      logRequest(requestId, 'POST', '/api/cloud-backup/complete', 400, Date.now() - start);
      return;
    }

    if (!isHippiusKeyOwnedByUser(user.id, key)) {
      json(res, 403, { error: 'Forbidden: key ownership mismatch' });
      logRequest(requestId, 'POST', '/api/cloud-backup/complete', 403, Date.now() - start);
      return;
    }

    const uploadId = typeof body.uploadId === 'string' ? body.uploadId.trim() : '';
    if (!uploadId) {
      json(res, 400, { error: 'uploadId is required' });
      logRequest(requestId, 'POST', '/api/cloud-backup/complete', 400, Date.now() - start);
      return;
    }

    const parts = parseParts(body.parts);
    if (!parts) {
      json(res, 400, { error: 'parts must be a non-empty array of { partNumber, etag }' });
      logRequest(requestId, 'POST', '/api/cloud-backup/complete', 400, Date.now() - start);
      return;
    }

    let normalized;
    try {
      normalized = normalizeCompletionParts(parts);
    } catch (err: unknown) {
      json(res, 400, { error: getErrorMessage(err, 'Invalid completion parts payload') });
      logRequest(requestId, 'POST', '/api/cloud-backup/complete', 400, Date.now() - start);
      return;
    }

    const expectedPartCount = body.expectedPartCount == null ? null : Number(body.expectedPartCount);
    if (expectedPartCount != null) {
      if (!Number.isInteger(expectedPartCount) || expectedPartCount < 1) {
        json(res, 400, { error: 'expectedPartCount must be a positive integer when provided' });
        logRequest(requestId, 'POST', '/api/cloud-backup/complete', 400, Date.now() - start);
        return;
      }
      if (normalized.length !== expectedPartCount) {
        json(res, 400, { error: 'parts length does not match expectedPartCount' });
        logRequest(requestId, 'POST', '/api/cloud-backup/complete', 400, Date.now() - start);
        return;
      }
      for (let i = 0; i < normalized.length; i += 1) {
        if (normalized[i].PartNumber !== i + 1) {
          json(res, 400, { error: 'parts must be contiguous and ordered from 1..expectedPartCount' });
          logRequest(requestId, 'POST', '/api/cloud-backup/complete', 400, Date.now() - start);
          return;
        }
      }
    }

    const result = await completeHippiusMultipartUpload({
      key,
      uploadId,
      parts: normalized.map((part) => ({
        partNumber: part.PartNumber ?? 0,
        etag: part.ETag ?? '',
      })),
    });

    json(res, 200, {
      key,
      uploadId,
      etag: result.etag,
      location: result.location,
      versionId: result.versionId,
    });
    logRequest(requestId, 'POST', '/api/cloud-backup/complete', 200, Date.now() - start);
  } catch (err: unknown) {
    const errMsg = getErrorMessage(err);
    json(res, 500, { error: safeErrorMessage(requestId, errMsg), requestId });
    logRequest(requestId, 'POST', '/api/cloud-backup/complete', 500, Date.now() - start, errMsg);
  }
}
