'use client';

import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';

interface AuthGateProps {
  children: React.ReactNode;
}

/**
 * Install a global `window.fetch` proxy that injects the latest Supabase
 * access token as a Bearer header on every request.
 *
 * Why we read the token from the live supabase client on each call (instead
 * of caching it in a ref at install time): Supabase access tokens expire
 * (~1 hour). If we cached, every fetch after expiry would 401. Reading from
 * `supabase.auth.getSession()` returns the cached session, and Supabase's
 * internal refresh timer keeps the token fresh as long as `autoRefreshToken`
 * is on (the default).
 *
 * The original `window.fetch` is captured once and restored on cleanup.
 */
function installAuthHeaderProxy(): () => void {
  if (typeof window === 'undefined') return () => {};
  const original = window.fetch.bind(window);
  window.fetch = (async (resource: RequestInfo | URL, config: RequestInit = {}) => {
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (token) {
        const headers = new Headers(config.headers);
        if (!headers.has('Authorization')) {
          headers.set('Authorization', `Bearer ${token}`);
        }
        config = { ...config, headers };
      }
    } catch {
      // If session lookup fails, fall through with no auth header —
      // the server will return 401 and the UI can react.
    }
    return original(resource, config);
  }) as typeof window.fetch;
  return () => {
    window.fetch = original;
  };
}

export default function AuthGate({ children }: AuthGateProps) {
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    // 1. Install the proxy once. It reads the live token from supabase
    //    on every call, so refreshes work automatically.
    cleanupRef.current = installAuthHeaderProxy();

    // 2. Subscribe to auth changes (login, logout, refresh).
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    // 3. Read the initial session.
    supabase.auth.getSession().then(({ data: { session: initialSession } }) => {
      setSession(initialSession);
      setLoading(false);
    });

    return () => {
      subscription.unsubscribe();
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, []);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');
    setSubmitting(true);

    try {
      if (isSignUp) {
        const { error } = await supabase.auth.signUp({
          email,
          password,
        });
        if (error) throw error;
        setSuccessMsg('Verification email sent! Please check your inbox.');
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Authentication failed.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#FAF8F5] flex flex-col items-center justify-center">
        <div className="w-8 h-8 border-2 border-t-[var(--accent-terracotta)] border-[#EAE5D9] rounded-full animate-spin"></div>
        <p className="mt-4 text-[var(--text-secondary)] text-xs font-bold uppercase tracking-wider">Establishing secure locker session...</p>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-[#FAF8F5] flex flex-col items-center justify-center px-4">
        <div className="w-full max-w-md bg-white border border-[#EAE5D9] p-8 rounded-3xl shadow-xl shadow-stone-200/50 space-y-6">
          <div className="text-center space-y-2">
            <div className="w-12 h-12 rounded-2xl bg-[var(--bg-card-primary)] border border-[#EAE5D9] flex items-center justify-center mx-auto shadow-inner p-1.5">
              <img src="/icon-192.png" alt="Atelier Logo" className="w-full h-full object-contain" />
            </div>
            <h2 className="text-xl font-extrabold text-[var(--text-primary)] tracking-tight">Atelier Closet Vault</h2>
            <p className="text-[var(--text-secondary)] text-xs font-semibold">Your personal wardrobe, isolated and secured.</p>
          </div>

          <form onSubmit={handleAuth} className="space-y-4">
            <div className="space-y-1">
              <label htmlFor="auth-email" className="text-[10px] uppercase font-bold text-[var(--text-secondary)]">Email Address</label>
              <input
                id="auth-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full bg-[#FAF8F5] border border-[#EAE5D9] rounded-xl p-3 text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-terracotta)]/40"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="auth-password" className="text-[10px] uppercase font-bold text-[var(--text-secondary)]">Locker Password</label>
              <input
                id="auth-password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-[#FAF8F5] border border-[#EAE5D9] rounded-xl p-3 text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-terracotta)]/40"
              />
            </div>

            {errorMsg && (
              <div role="alert" className="p-3.5 bg-rose-50 border border-rose-200 text-rose-600 rounded-xl text-xs font-bold leading-relaxed">
                ⚠️ {errorMsg}
              </div>
            )}

            {successMsg && (
              <div role="status" className="p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-600 rounded-xl text-xs font-bold leading-relaxed">
                ✉️ {successMsg}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3 bg-[var(--accent-terracotta)] text-white font-extrabold text-xs uppercase tracking-wider rounded-xl hover:bg-[var(--accent-terracotta)]/90 active:scale-[0.98] transition shadow-md"
            >
              {submitting ? 'Processing...' : isSignUp ? 'Create Secured Account' : 'Decrypt Closet Locker'}
            </button>
          </form>

          <div className="text-center pt-2">
            <button
              type="button"
              onClick={() => {
                setIsSignUp(!isSignUp);
                setErrorMsg('');
                setSuccessMsg('');
              }}
              className="text-xs text-[var(--accent-terracotta)] hover:underline font-bold"
            >
              {isSignUp ? 'Already have an account? Decrypt here' : "Need a personal locker? Register here"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}