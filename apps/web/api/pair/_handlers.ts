import {
  type ApiRequest,
  type ApiResponse,
  ensureObject,
  generateDeviceToken,
  generatePairingCode,
  generateRequestId,
  getErrorMessage,
  hashToken,
  json,
  logRequest,
  parseApiError,
  rateLimit,
  requireUser,
  safeErrorMessage,
  supabaseRest,
} from '../_utils';

const VALID_TYPES = new Set(['agent', 'vault', 'mobile']);

export async function handlePairStart(req: ApiRequest, res: ApiResponse) {
  const requestId = generateRequestId();
  const start = Date.now();

  if (!rateLimit(req, res, 30)) return;

  if (req.method !== 'POST') {
    json(res, 405, { error: 'Method not allowed' });
    logRequest(requestId, req.method ?? 'UNKNOWN', '/api/pair/start', 405, Date.now() - start);
    return;
  }

  try {
    const user = await requireUser(req, res);
    if (!user) {
      logRequest(requestId, 'POST', '/api/pair/start', res.statusCode, Date.now() - start);
      return;
    }

    const body = ensureObject(req.body);
    if (!body) {
      json(res, 400, { error: 'Invalid JSON body' });
      logRequest(requestId, 'POST', '/api/pair/start', 400, Date.now() - start);
      return;
    }

    const deviceName = typeof body.deviceName === 'string' ? body.deviceName.trim() : '';
    const deviceType = typeof body.deviceType === 'string' ? body.deviceType.trim() : '';
    if (!deviceName || deviceName.length > 80) {
      json(res, 400, { error: 'deviceName is required (max 80 chars)' });
      logRequest(requestId, 'POST', '/api/pair/start', 400, Date.now() - start);
      return;
    }
    if (!VALID_TYPES.has(deviceType)) {
      json(res, 400, { error: 'deviceType must be agent, vault, or mobile' });
      logRequest(requestId, 'POST', '/api/pair/start', 400, Date.now() - start);
      return;
    }

    const code = generatePairingCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const insertRes = await supabaseRest('pairing_requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        owner_id: user.id,
        code,
        device_name: deviceName,
        device_type: deviceType,
        status: 'pending',
        expires_at: expiresAt,
      }),
    });

    if (!insertRes.ok) {
      const errMsg = await parseApiError(insertRes);
      json(res, 500, { error: safeErrorMessage(requestId, errMsg), requestId });
      logRequest(requestId, 'POST', '/api/pair/start', 500, Date.now() - start, errMsg);
      return;
    }

    json(res, 200, { code, expiresAt });
    logRequest(requestId, 'POST', '/api/pair/start', 200, Date.now() - start);
  } catch (err: unknown) {
    const errMsg = getErrorMessage(err);
    json(res, 500, { error: safeErrorMessage(requestId, errMsg), requestId });
    logRequest(requestId, 'POST', '/api/pair/start', 500, Date.now() - start, errMsg);
  }
}

export async function handlePairClaim(req: ApiRequest, res: ApiResponse) {
  const requestId = generateRequestId();
  const start = Date.now();

  if (!rateLimit(req, res, 10)) return;

  if (req.method !== 'POST') {
    json(res, 405, { error: 'Method not allowed' });
    logRequest(requestId, req.method ?? 'UNKNOWN', '/api/pair/claim', 405, Date.now() - start);
    return;
  }

  const user = await requireUser(req, res);
  if (!user) {
    logRequest(requestId, 'POST', '/api/pair/claim', res.statusCode, Date.now() - start);
    return;
  }

  try {
    const body = ensureObject(req.body);
    if (!body) {
      json(res, 400, { error: 'Invalid JSON body' });
      logRequest(requestId, 'POST', '/api/pair/claim', 400, Date.now() - start);
      return;
    }

    const code = typeof body.code === 'string' ? body.code.trim() : '';
    if (!code || code.length > 32) {
      json(res, 400, { error: 'Invalid pairing code' });
      logRequest(requestId, 'POST', '/api/pair/claim', 400, Date.now() - start);
      return;
    }

    const params = new URLSearchParams({
      select: 'id,owner_id,device_name,device_type,status,expires_at',
      code: `eq.${code}`,
      status: 'eq.pending',
      owner_id: `eq.${user.id}`,
    });
    const reqRes = await supabaseRest(`pairing_requests?${params.toString()}`);
    if (!reqRes.ok) {
      const errMsg = await parseApiError(reqRes);
      json(res, 500, { error: safeErrorMessage(requestId, errMsg), requestId });
      logRequest(requestId, 'POST', '/api/pair/claim', 500, Date.now() - start, errMsg);
      return;
    }
    const requests = (await reqRes.json()) as Array<{
      id: string;
      owner_id: string;
      device_name: string;
      device_type: string;
      expires_at: string;
    }>;

    if (!requests || requests.length === 0) {
      json(res, 404, { error: 'Pairing request not found' });
      logRequest(requestId, 'POST', '/api/pair/claim', 404, Date.now() - start);
      return;
    }

    const request = requests[0];
    const expiresAt = new Date(request.expires_at);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() < Date.now()) {
      const expireParams = new URLSearchParams({ id: `eq.${request.id}` });
      await supabaseRest(`pairing_requests?${expireParams.toString()}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'expired' }),
      });
      json(res, 410, { error: 'Pairing code expired' });
      logRequest(requestId, 'POST', '/api/pair/claim', 410, Date.now() - start);
      return;
    }

    const deviceToken = generateDeviceToken();
    const tokenHash = hashToken(deviceToken);
    const now = new Date().toISOString();

    const deviceRes = await supabaseRest('devices?select=id', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({
        owner_id: user.id,
        name: request.device_name,
        type: request.device_type,
        status: 'connected',
        token_hash: tokenHash,
        last_seen: now,
        created_at: now,
        updated_at: now,
      }),
    });

    if (!deviceRes.ok) {
      const errMsg = await parseApiError(deviceRes);
      json(res, 500, { error: safeErrorMessage(requestId, errMsg), requestId });
      logRequest(requestId, 'POST', '/api/pair/claim', 500, Date.now() - start, errMsg);
      return;
    }

    const deviceRows = (await deviceRes.json()) as Array<{ id: string }>;
    const device = deviceRows?.[0];
    if (!device?.id) {
      json(res, 500, { error: safeErrorMessage(requestId, 'Failed to create device'), requestId });
      logRequest(requestId, 'POST', '/api/pair/claim', 500, Date.now() - start, 'Failed to create device');
      return;
    }

    const updateParams = new URLSearchParams({ id: `eq.${request.id}` });
    const updateRes = await supabaseRest(`pairing_requests?${updateParams.toString()}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'claimed', claimed_at: now, device_id: device.id }),
    });
    if (!updateRes.ok) {
      const errMsg = await parseApiError(updateRes);
      json(res, 500, { error: safeErrorMessage(requestId, errMsg), requestId });
      logRequest(requestId, 'POST', '/api/pair/claim', 500, Date.now() - start, errMsg);
      return;
    }

    json(res, 200, { deviceId: device.id, deviceToken });
    logRequest(requestId, 'POST', '/api/pair/claim', 200, Date.now() - start);
  } catch (err: unknown) {
    const errMsg = getErrorMessage(err);
    json(res, 500, { error: safeErrorMessage(requestId, errMsg), requestId });
    logRequest(requestId, 'POST', '/api/pair/claim', 500, Date.now() - start, errMsg);
  }
}

export async function handlePairStatus(req: ApiRequest, res: ApiResponse) {
  const requestId = generateRequestId();
  const start = Date.now();

  if (!rateLimit(req, res, 60)) return;

  if (req.method !== 'GET') {
    json(res, 405, { error: 'Method not allowed' });
    logRequest(requestId, req.method ?? 'UNKNOWN', '/api/pair/status', 405, Date.now() - start);
    return;
  }

  try {
    const user = await requireUser(req, res);
    if (!user) {
      logRequest(requestId, 'GET', '/api/pair/status', res.statusCode, Date.now() - start);
      return;
    }

    const code = typeof req.query?.code === 'string' ? req.query.code.trim() : '';
    if (!code) {
      json(res, 400, { error: 'code is required' });
      logRequest(requestId, 'GET', '/api/pair/status', 400, Date.now() - start);
      return;
    }
    if (code.length > 32) {
      json(res, 400, { error: 'Invalid code format' });
      logRequest(requestId, 'GET', '/api/pair/status', 400, Date.now() - start);
      return;
    }

    const params = new URLSearchParams({
      select: 'id,status,device_id,device_name,device_type,expires_at',
      owner_id: `eq.${user.id}`,
      code: `eq.${code}`,
      limit: '1',
    });
    const supaRes = await supabaseRest(`pairing_requests?${params.toString()}`);
    if (!supaRes.ok) {
      const errMsg = await parseApiError(supaRes);
      json(res, 500, { error: safeErrorMessage(requestId, errMsg), requestId });
      logRequest(requestId, 'GET', '/api/pair/status', 500, Date.now() - start, errMsg);
      return;
    }

    const rows = (await supaRes.json()) as Array<{
      id: string;
      status: string;
      device_id: string | null;
      device_name: string | null;
      device_type: string | null;
      expires_at: string;
    }>;
    if (!rows || rows.length === 0) {
      json(res, 404, { error: 'Pairing request not found' });
      logRequest(requestId, 'GET', '/api/pair/status', 404, Date.now() - start);
      return;
    }

    const row = rows[0];
    const expiresAt = new Date(row.expires_at);
    if (row.status === 'pending' && !Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() < Date.now()) {
      const updateParams = new URLSearchParams({ id: `eq.${row.id}` });
      await supabaseRest(`pairing_requests?${updateParams.toString()}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'expired' }),
      });
      json(res, 200, { status: 'expired' });
      logRequest(requestId, 'GET', '/api/pair/status', 200, Date.now() - start);
      return;
    }

    json(res, 200, {
      status: row.status,
      deviceId: row.device_id ?? undefined,
      deviceName: row.device_name ?? undefined,
      deviceType: row.device_type ?? undefined,
    });
    logRequest(requestId, 'GET', '/api/pair/status', 200, Date.now() - start);
  } catch (err: unknown) {
    const errMsg = getErrorMessage(err);
    json(res, 500, { error: safeErrorMessage(requestId, errMsg), requestId });
    logRequest(requestId, 'GET', '/api/pair/status', 500, Date.now() - start, errMsg);
  }
}

export async function handlePairRevoke(req: ApiRequest, res: ApiResponse) {
  const requestId = generateRequestId();
  const start = Date.now();

  if (!rateLimit(req, res, 30)) return;

  if (req.method !== 'POST') {
    json(res, 405, { error: 'Method not allowed' });
    logRequest(requestId, req.method ?? 'UNKNOWN', '/api/pair/revoke', 405, Date.now() - start);
    return;
  }

  try {
    const user = await requireUser(req, res);
    if (!user) {
      logRequest(requestId, 'POST', '/api/pair/revoke', res.statusCode, Date.now() - start);
      return;
    }

    const body = ensureObject(req.body);
    if (!body) {
      json(res, 400, { error: 'Invalid JSON body' });
      logRequest(requestId, 'POST', '/api/pair/revoke', 400, Date.now() - start);
      return;
    }

    const deviceId = typeof body.deviceId === 'string' ? body.deviceId.trim() : '';
    if (!deviceId) {
      json(res, 400, { error: 'deviceId is required' });
      logRequest(requestId, 'POST', '/api/pair/revoke', 400, Date.now() - start);
      return;
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(deviceId)) {
      json(res, 400, { error: 'Invalid deviceId format' });
      logRequest(requestId, 'POST', '/api/pair/revoke', 400, Date.now() - start);
      return;
    }

    const params = new URLSearchParams({ id: `eq.${deviceId}`, owner_id: `eq.${user.id}` });
    const deleteRes = await supabaseRest(`devices?${params.toString()}`, { method: 'DELETE' });
    if (!deleteRes.ok) {
      const errMsg = await parseApiError(deleteRes);
      json(res, 500, { error: safeErrorMessage(requestId, errMsg), requestId });
      logRequest(requestId, 'POST', '/api/pair/revoke', 500, Date.now() - start, errMsg);
      return;
    }

    json(res, 200, { ok: true });
    logRequest(requestId, 'POST', '/api/pair/revoke', 200, Date.now() - start);
  } catch (err: unknown) {
    const errMsg = getErrorMessage(err);
    json(res, 500, { error: safeErrorMessage(requestId, errMsg), requestId });
    logRequest(requestId, 'POST', '/api/pair/revoke', 500, Date.now() - start, errMsg);
  }
}
