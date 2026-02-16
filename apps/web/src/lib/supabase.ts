const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export interface SupabaseUser {
  id: string;
  email?: string;
}

export interface SupabaseSession {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  token_type: string;
  user?: SupabaseUser;
}

let cachedSession: SupabaseSession | null = null;
const listeners = new Set<(session: SupabaseSession | null) => void>();

export function hasSupabaseConfig(): boolean {
  return Boolean(supabaseUrl && supabaseAnonKey);
}

function notify(session: SupabaseSession | null) {
  listeners.forEach((cb) => cb(session));
}

function loadSession(): SupabaseSession | null {
  return cachedSession;
}

function saveSession(session: SupabaseSession | null) {
  cachedSession = session;
  notify(session);
}

function isExpiringSoon(session: SupabaseSession) {
  const now = Math.floor(Date.now() / 1000);
  return session.expires_at - now < 60;
}

async function refreshSession(session: SupabaseSession): Promise<SupabaseSession | null> {
  if (!hasSupabaseConfig()) return null;
  const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: supabaseAnonKey ?? '',
    },
    body: JSON.stringify({ refresh_token: session.refresh_token }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const expiresAt = Math.floor(Date.now() / 1000) + (data.expires_in ?? 0);
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? session.refresh_token,
    expires_at: expiresAt,
    token_type: data.token_type ?? 'bearer',
    user: data.user ?? session.user,
  };
}

async function fetchUser(accessToken: string): Promise<SupabaseUser | undefined> {
  if (!hasSupabaseConfig()) return undefined;
  const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: supabaseAnonKey ?? '',
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!res.ok) return undefined;
  const data = await res.json();
  if (!data?.id) return undefined;
  return { id: data.id, email: data.email };
}

export function consumeAuthRedirect(): SupabaseSession | null {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash;
  if (!hash || !hash.includes('access_token')) return null;
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const access_token = params.get('access_token');
  const refresh_token = params.get('refresh_token');
  const expires_in = params.get('expires_in');
  if (!access_token || !refresh_token) return null;
  const expiresAt = Math.floor(Date.now() / 1000) + (Number.parseInt(expires_in ?? '0', 10) || 0);
  const session: SupabaseSession = {
    access_token,
    refresh_token,
    expires_at: expiresAt,
    token_type: params.get('token_type') ?? 'bearer',
  };
  saveSession(session);
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
  return session;
}

let refreshPromise: Promise<SupabaseSession | null> | null = null;

export async function getSupabaseSession(): Promise<SupabaseSession | null> {
  if (!hasSupabaseConfig()) return null;
  let session = loadSession();
  if (!session) return null;

  if (isExpiringSoon(session)) {
    // Deduplicate concurrent refresh calls
    if (!refreshPromise) {
      refreshPromise = refreshSession(session).finally(() => {
        refreshPromise = null;
      });
    }
    const refreshed = await refreshPromise;
    if (refreshed) {
      session = refreshed;
      saveSession(session);
    }
  }

  if (!session.user) {
    const user = await fetchUser(session.access_token);
    if (user) {
      session = { ...session, user };
      saveSession(session);
    }
  }

  return session;
}

export async function getSupabaseAccessToken(): Promise<string | null> {
  const session = await getSupabaseSession();
  return session?.access_token ?? null;
}

export async function signInWithOtp(email: string, redirectTo: string) {
  if (!hasSupabaseConfig()) {
    return { error: 'Supabase not configured' };
  }
  // Validate redirect_to is a relative path or same-origin to prevent open redirect
  const isRelative = redirectTo.startsWith('/');
  const isSameOrigin = typeof window !== 'undefined' && redirectTo.startsWith(window.location.origin);
  if (!isRelative && !isSameOrigin) {
    redirectTo = typeof window !== 'undefined' ? window.location.origin : '/';
  }
  const res = await fetch(`${supabaseUrl}/auth/v1/otp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: supabaseAnonKey ?? '',
    },
    body: JSON.stringify({ email, create_user: true, redirect_to: redirectTo }),
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => null);
    return { error: payload?.error_description ?? payload?.msg ?? 'Failed to send magic link' };
  }
  return { error: null };
}

export function signOut() {
  saveSession(null);
}

export function onAuthStateChange(callback: (session: SupabaseSession | null) => void) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}
