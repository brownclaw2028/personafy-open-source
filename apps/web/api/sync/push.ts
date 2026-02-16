import {
  type ApiRequest,
  type ApiResponse,
  ensureObject,
  generateRequestId,
  getErrorMessage,
  isEncryptedEnvelope,
  json,
  logRequest,
  rateLimit,
  requireUser,
  safeErrorMessage,
} from '../_utils';
import { resolveCloudSyncStorageProvider } from '../_storage/provider';

export const config = {
  api: { bodyParser: { sizeLimit: '1mb' } },
};

export default async function handler(req: ApiRequest, res: ApiResponse) {
  const requestId = generateRequestId();
  const start = Date.now();

  if (!rateLimit(req, res, 30)) return;

  if (req.method !== 'POST') {
    json(res, 405, { error: 'Method not allowed' });
    logRequest(requestId, req.method ?? 'UNKNOWN', '/api/sync/push', 405, Date.now() - start);
    return;
  }

  try {
    const user = await requireUser(req, res);
    if (!user) {
      logRequest(requestId, 'POST', '/api/sync/push', res.statusCode, Date.now() - start);
      return;
    }

    const body = ensureObject(req.body);
    if (!body) {
      json(res, 400, { error: 'Invalid JSON body' });
      logRequest(requestId, 'POST', '/api/sync/push', 400, Date.now() - start);
      return;
    }

    const envelope = body.envelope;
    if (!isEncryptedEnvelope(envelope)) {
      json(res, 400, { error: 'Invalid envelope' });
      logRequest(requestId, 'POST', '/api/sync/push', 400, Date.now() - start);
      return;
    }
    if (JSON.stringify(envelope).length > 1024 * 1024) {
      json(res, 413, { error: 'Envelope too large (max 1MB)' });
      logRequest(requestId, 'POST', '/api/sync/push', 413, Date.now() - start);
      return;
    }

    const ifMatchVersion = typeof body.ifMatchVersion === 'number' ? body.ifMatchVersion : null;
    const version = typeof body.version === 'number' ? body.version : null;
    if (ifMatchVersion == null || version == null || version !== ifMatchVersion + 1) {
      json(res, 400, { error: 'Invalid version or ifMatchVersion' });
      logRequest(requestId, 'POST', '/api/sync/push', 400, Date.now() - start);
      return;
    }

    const now = new Date().toISOString();

    const provider = resolveCloudSyncStorageProvider();
    const result = await provider.pushVault({
      userId: user.id,
      envelope,
      ifMatchVersion,
      version,
      nowIso: now,
    });

    if (!result.ok) {
      const payload = {
        error: result.error,
        currentVersion: result.currentVersion ?? null,
        updatedAt: result.updatedAt ?? null,
      };
      json(res, 409, payload);
      logRequest(requestId, 'POST', '/api/sync/push', 409, Date.now() - start);
      return;
    }

    json(res, 200, { version: result.version, updatedAt: result.updatedAt ?? now });
    logRequest(requestId, 'POST', '/api/sync/push', 200, Date.now() - start);
  } catch (err: unknown) {
    const errMsg = getErrorMessage(err);
    json(res, 500, { error: safeErrorMessage(requestId, errMsg), requestId });
    logRequest(requestId, 'POST', '/api/sync/push', 500, Date.now() - start, errMsg);
  }
}
