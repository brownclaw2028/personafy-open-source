import { useEffect, useState } from 'react';
import type { SupabaseSession, SupabaseUser } from './supabase';
import { consumeAuthRedirect, getSupabaseSession, onAuthStateChange } from './supabase';

export function useSupabaseSession() {
  const [session, setSession] = useState<SupabaseSession | null>(null);
  const [user, setUser] = useState<SupabaseUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const init = async () => {
      const redirectSession = consumeAuthRedirect();
      if (redirectSession) {
        const hydrated = await getSupabaseSession();
        if (!mounted) return;
        setSession(hydrated ?? redirectSession);
        setUser((hydrated ?? redirectSession)?.user ?? null);
        setLoading(false);
        return;
      }

      const current = await getSupabaseSession();
      if (!mounted) return;
      setSession(current);
      setUser(current?.user ?? null);
      setLoading(false);
    };

    init();

    const unsubscribe = onAuthStateChange((next) => {
      if (!mounted) return;
      setSession(next);
      setUser(next?.user ?? null);
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  return { session, user, loading };
}
