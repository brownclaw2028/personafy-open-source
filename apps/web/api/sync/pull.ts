import { type ApiRequest, type ApiResponse, generateRequestId, getErrorMessage, json, logRequest, rateLimit, requireUser, safeErrorMessage } from '../_utils';
import { resolveCloudSyncStorageProvider } from '../_storage/provider';

export default async function handler(req: ApiRequest, res: ApiResponse) {
  const requestId = generateRequestId();
  const start = Date.now();

  if (!rateLimit(req, res, 60)) return;

  if (req.method !== 'GET') {
    json(res, 405, { error: 'Method not allowed' });
    logRequest(requestId, req.method ?? 'UNKNOWN', '/api/sync/pull', 405, Date.now() - start);
    return;
  }

  try {
    const user = await requireUser(req, res);
    if (!user) {
      logRequest(requestId, 'GET', '/api/sync/pull', res.statusCode, Date.now() - start);
      return;
    }

    const provider = resolveCloudSyncStorageProvider();
    const latest = await provider.pullLatestVault({ userId: user.id });
    if (!latest) {
      json(res, 404, { error: 'Cloud vault not found' });
      logRequest(requestId, 'GET', '/api/sync/pull', 404, Date.now() - start);
      return;
    }

    json(res, 200, {
      envelope: latest.envelope,
      version: latest.version,
      updatedAt: latest.updatedAt,
    });
    logRequest(requestId, 'GET', '/api/sync/pull', 200, Date.now() - start);
  } catch (err: unknown) {
    const errMsg = getErrorMessage(err);
    json(res, 500, { error: safeErrorMessage(requestId, errMsg), requestId });
    logRequest(requestId, 'GET', '/api/sync/pull', 500, Date.now() - start, errMsg);
  }
}
