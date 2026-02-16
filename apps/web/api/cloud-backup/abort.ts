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
  abortHippiusMultipartUpload,
  isHippiusKeyOwnedByUser,
} from '../_storage/hippiusClient';

export default async function handler(req: ApiRequest, res: ApiResponse) {
  const requestId = generateRequestId();
  const start = Date.now();

  if (!rateLimit(req, res, 20)) return;

  if (req.method !== 'POST') {
    json(res, 405, { error: 'Method not allowed' });
    logRequest(requestId, req.method ?? 'UNKNOWN', '/api/cloud-backup/abort', 405, Date.now() - start);
    return;
  }

  try {
    const user = await requireUser(req, res);
    if (!user) {
      logRequest(requestId, 'POST', '/api/cloud-backup/abort', res.statusCode, Date.now() - start);
      return;
    }

    const body = ensureObject(req.body);
    if (!body) {
      json(res, 400, { error: 'Invalid JSON body' });
      logRequest(requestId, 'POST', '/api/cloud-backup/abort', 400, Date.now() - start);
      return;
    }

    const key = typeof body.key === 'string' ? body.key.trim() : '';
    if (!key) {
      json(res, 400, { error: 'key is required' });
      logRequest(requestId, 'POST', '/api/cloud-backup/abort', 400, Date.now() - start);
      return;
    }

    if (!isHippiusKeyOwnedByUser(user.id, key)) {
      json(res, 403, { error: 'Forbidden: key ownership mismatch' });
      logRequest(requestId, 'POST', '/api/cloud-backup/abort', 403, Date.now() - start);
      return;
    }

    const uploadId = typeof body.uploadId === 'string' ? body.uploadId.trim() : '';
    if (!uploadId) {
      json(res, 400, { error: 'uploadId is required' });
      logRequest(requestId, 'POST', '/api/cloud-backup/abort', 400, Date.now() - start);
      return;
    }

    await abortHippiusMultipartUpload({ key, uploadId });
    json(res, 200, { key, uploadId, aborted: true });
    logRequest(requestId, 'POST', '/api/cloud-backup/abort', 200, Date.now() - start);
  } catch (err: unknown) {
    const errMsg = getErrorMessage(err);
    json(res, 500, { error: safeErrorMessage(requestId, errMsg), requestId });
    logRequest(requestId, 'POST', '/api/cloud-backup/abort', 500, Date.now() - start, errMsg);
  }
}
