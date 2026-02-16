import { getSupabaseAccessToken, hasSupabaseConfig } from './supabase';

type PairError = {
  ok: false;
  error: string;
  status?: number;
};

type PairSuccess<T> = { ok: true } & T;

async function parseError(res: Response): Promise<string> {
  try {
    const payload = await res.json();
    if (payload && typeof payload.error === 'string') return payload.error;
  } catch {
    // ignore
  }
  return res.statusText || 'Request failed';
}

async function fetchWithAuth(path: string, options?: RequestInit): Promise<Response | PairError> {
  if (!hasSupabaseConfig()) {
    return { ok: false, error: 'Supabase not configured' };
  }
  const token = await getSupabaseAccessToken();
  if (!token) {
    return { ok: false, error: 'Sign in required', status: 401 };
  }
  return fetch(path, {
    ...options,
    headers: {
      ...(options?.headers ?? {}),
      Authorization: `Bearer ${token}`,
    },
  });
}

export async function startPairing(
  deviceName: string,
  deviceType: 'agent' | 'vault' | 'mobile',
): Promise<PairSuccess<{ code: string; expiresAt: string }> | PairError> {
  const res = await fetchWithAuth('/api/pair/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceName, deviceType }),
  });
  if (!(res instanceof Response)) return res;
  if (!res.ok) {
    const error = await parseError(res);
    return { ok: false, error, status: res.status };
  }
  const payload = await res.json();
  return { ok: true, code: payload.code, expiresAt: payload.expiresAt };
}

export async function checkPairingStatus(
  code: string,
): Promise<PairSuccess<{ status: string; deviceId?: string; deviceName?: string; deviceType?: string }> | PairError> {
  const res = await fetchWithAuth(`/api/pair/status?code=${encodeURIComponent(code)}`);
  if (!(res instanceof Response)) return res;
  if (!res.ok) {
    const error = await parseError(res);
    return { ok: false, error, status: res.status };
  }
  const payload = await res.json();
  return {
    ok: true,
    status: payload.status,
    deviceId: payload.deviceId,
    deviceName: payload.deviceName,
    deviceType: payload.deviceType,
  };
}

export async function revokeDevice(deviceId: string): Promise<PairSuccess<{ revoked: true }> | PairError> {
  const res = await fetchWithAuth('/api/pair/revoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId }),
  });
  if (!(res instanceof Response)) return res;
  if (!res.ok) {
    const error = await parseError(res);
    return { ok: false, error, status: res.status };
  }
  return { ok: true, revoked: true };
}
