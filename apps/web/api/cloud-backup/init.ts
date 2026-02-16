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
  buildHippiusSnapshotKey,
  computeMultipartPartCount,
  createHippiusMultipartSession,
  getHippiusConfig,
  sanitizePartSizeBytes,
} from '../_storage/hippiusClient';

export default async function handler(req: ApiRequest, res: ApiResponse) {
  const requestId = generateRequestId();
  const start = Date.now();

  if (!rateLimit(req, res, 20)) return;

  if (req.method !== 'POST') {
    json(res, 405, { error: 'Method not allowed' });
    logRequest(requestId, req.method ?? 'UNKNOWN', '/api/cloud-backup/init', 405, Date.now() - start);
    return;
  }

  try {
    const user = await requireUser(req, res);
    if (!user) {
      logRequest(requestId, 'POST', '/api/cloud-backup/init', res.statusCode, Date.now() - start);
      return;
    }

    const body = ensureObject(req.body);
    if (!body) {
      json(res, 400, { error: 'Invalid JSON body' });
      logRequest(requestId, 'POST', '/api/cloud-backup/init', 400, Date.now() - start);
      return;
    }

    const snapshotId = typeof body.snapshotId === 'string' ? body.snapshotId.trim() : '';
    if (!snapshotId || snapshotId.length > 120) {
      json(res, 400, { error: 'snapshotId is required (max 120 chars)' });
      logRequest(requestId, 'POST', '/api/cloud-backup/init', 400, Date.now() - start);
      return;
    }

    const sizeBytes = Number(body.sizeBytes);
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
      json(res, 400, { error: 'sizeBytes must be a positive number' });
      logRequest(requestId, 'POST', '/api/cloud-backup/init', 400, Date.now() - start);
      return;
    }

    const requestedPartSize = body.partSizeBytes == null ? null : Number(body.partSizeBytes);
    const partSizeBytes = sanitizePartSizeBytes(requestedPartSize);

    let partCount = 0;
    try {
      partCount = computeMultipartPartCount(sizeBytes, partSizeBytes);
    } catch (err: unknown) {
      json(res, 400, { error: getErrorMessage(err, 'Invalid multipart size parameters') });
      logRequest(requestId, 'POST', '/api/cloud-backup/init', 400, Date.now() - start);
      return;
    }

    const contentType = typeof body.contentType === 'string' && body.contentType.trim()
      ? body.contentType.trim()
      : 'application/octet-stream';

    const key = buildHippiusSnapshotKey(user.id, snapshotId);
    const session = await createHippiusMultipartSession({ key, contentType });
    const cfg = getHippiusConfig();

    json(res, 200, {
      provider: 'hippius',
      bucket: session.bucket,
      key: session.key,
      uploadId: session.uploadId,
      partSizeBytes,
      partCount,
      maxPartsPerRequest: cfg.presignBatchSize,
    });
    logRequest(requestId, 'POST', '/api/cloud-backup/init', 200, Date.now() - start);
  } catch (err: unknown) {
    const errMsg = getErrorMessage(err);
    json(res, 500, { error: safeErrorMessage(requestId, errMsg), requestId });
    logRequest(requestId, 'POST', '/api/cloud-backup/init', 500, Date.now() - start, errMsg);
  }
}
