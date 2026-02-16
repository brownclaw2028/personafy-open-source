import {
  type ApiRequest,
  type ApiResponse,
  generateRequestId,
  getErrorMessage,
  isEncryptedEnvelope,
  json,
  logRequest,
  rateLimit,
  requireUser,
  safeErrorMessage,
} from '../_utils';
import { readLatestHippiusSnapshotForUser } from '../_storage/hippiusClient';

export default async function handler(req: ApiRequest, res: ApiResponse) {
  const requestId = generateRequestId();
  const start = Date.now();

  if (!rateLimit(req, res, 30)) return;

  if (req.method !== 'GET') {
    json(res, 405, { error: 'Method not allowed' });
    logRequest(requestId, req.method ?? 'UNKNOWN', '/api/cloud-backup/latest', 405, Date.now() - start);
    return;
  }

  try {
    const user = await requireUser(req, res);
    if (!user) {
      logRequest(requestId, 'GET', '/api/cloud-backup/latest', res.statusCode, Date.now() - start);
      return;
    }

    const latest = await readLatestHippiusSnapshotForUser({ userId: user.id });
    if (!latest) {
      json(res, 404, { error: 'Cloud backup snapshot not found' });
      logRequest(requestId, 'GET', '/api/cloud-backup/latest', 404, Date.now() - start);
      return;
    }

    let envelope: unknown;
    try {
      envelope = JSON.parse(latest.envelopeText);
    } catch {
      json(res, 502, { error: 'Cloud backup snapshot payload is not valid JSON' });
      logRequest(requestId, 'GET', '/api/cloud-backup/latest', 502, Date.now() - start);
      return;
    }

    if (!isEncryptedEnvelope(envelope)) {
      json(res, 502, { error: 'Cloud backup snapshot payload is not a valid encrypted envelope' });
      logRequest(requestId, 'GET', '/api/cloud-backup/latest', 502, Date.now() - start);
      return;
    }

    json(res, 200, {
      provider: 'hippius',
      key: latest.key,
      snapshotId: latest.snapshotId,
      lastModified: latest.lastModified,
      sizeBytes: latest.sizeBytes,
      envelope,
    });
    logRequest(requestId, 'GET', '/api/cloud-backup/latest', 200, Date.now() - start);
  } catch (err: unknown) {
    const errMsg = getErrorMessage(err);
    json(res, 500, { error: safeErrorMessage(requestId, errMsg), requestId });
    logRequest(requestId, 'GET', '/api/cloud-backup/latest', 500, Date.now() - start, errMsg);
  }
}
