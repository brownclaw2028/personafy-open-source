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
    logRequest(requestId, req.method ?? 'UNKNOWN', '/api/sync/init', 405, Date.now() - start);
    return;
  }

  try {
    const user = await requireUser(req, res);
    if (!user) {
      logRequest(requestId, 'POST', '/api/sync/init', res.statusCode, Date.now() - start);
      return;
    }

    const body = ensureObject(req.body);
    if (!body) {
      json(res, 400, { error: 'Invalid JSON body' });
      logRequest(requestId, 'POST', '/api/sync/init', 400, Date.now() - start);
      return;
    }

    const vaultName = typeof body.vaultName === 'string' ? body.vaultName.trim() : '';
    if (!vaultName || vaultName.length > 120) {
      json(res, 400, { error: 'vaultName is required (max 120 chars)' });
      logRequest(requestId, 'POST', '/api/sync/init', 400, Date.now() - start);
      return;
    }

    const envelope = body.envelope;
    if (!isEncryptedEnvelope(envelope)) {
      json(res, 400, { error: 'Invalid envelope' });
      logRequest(requestId, 'POST', '/api/sync/init', 400, Date.now() - start);
      return;
    }
    if (JSON.stringify(envelope).length > 1024 * 1024) {
      json(res, 413, { error: 'Envelope too large (max 1MB)' });
      logRequest(requestId, 'POST', '/api/sync/init', 413, Date.now() - start);
      return;
    }

    const version = typeof body.version === 'number' && body.version > 0 ? body.version : 1;
    const now = new Date().toISOString();

    const provider = resolveCloudSyncStorageProvider();
    const result = await provider.initVault({
      userId: user.id,
      vaultName,
      envelope,
      version,
      nowIso: now,
    });

    json(res, 200, { version: result.version, updatedAt: result.updatedAt ?? now });
    logRequest(requestId, 'POST', '/api/sync/init', 200, Date.now() - start);
  } catch (err: unknown) {
    const errMsg = getErrorMessage(err);
    json(res, 500, { error: safeErrorMessage(requestId, errMsg), requestId });
    logRequest(requestId, 'POST', '/api/sync/init', 500, Date.now() - start, errMsg);
  }
}
