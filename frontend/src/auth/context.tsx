/**
 * Auth context — holds the session and exposes the OTP sign-in steps. Non-blocking:
 * the app renders for guests; signing in just populates `account`. On mount it
 * rehydrates a stored token via /auth/me (and clears it if the server rejects it).
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { fetchMe, requestOtp, verifyOtp, type Account } from './client';
import { clearToken, loadToken, saveToken } from './storage';

type Status = 'loading' | 'signedOut' | 'signedIn';

interface AuthValue {
  status: Status;
  account: Account | null;
  token: string | null;
  /** Ask the backend to email a code. Returns whether it was accepted. */
  requestCode: (email: string) => Promise<{ ok: boolean; note?: string }>;
  /** Verify a code; on success the user is signed in. */
  verifyCode: (email: string, code: string) => Promise<{ ok: boolean; error?: string }>;
  signOut: () => void;
}

const Ctx = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [account, setAccount] = useState<Account | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    const stored = loadToken();
    if (!stored) {
      setStatus('signedOut');
      return;
    }
    fetchMe(stored).then((acct) => {
      if (!alive.current) return;
      if (acct) {
        setAccount(acct);
        setToken(stored);
        setStatus('signedIn');
      } else {
        clearToken();
        setStatus('signedOut');
      }
    });
    return () => {
      alive.current = false;
    };
  }, []);

  const requestCode = useCallback(async (email: string) => {
    const r = await requestOtp(email.trim());
    return { ok: r.ok, note: r.note };
  }, []);

  const verifyCode = useCallback(async (email: string, code: string) => {
    const r = await verifyOtp(email.trim(), code.trim());
    if (r.ok && r.token) {
      saveToken(r.token);
      setToken(r.token);
      setAccount(r.account ?? null);
      setStatus('signedIn');
      return { ok: true };
    }
    return { ok: false, error: r.error ?? 'verification failed' };
  }, []);

  const signOut = useCallback(() => {
    clearToken();
    setToken(null);
    setAccount(null);
    setStatus('signedOut');
  }, []);

  const value = useMemo<AuthValue>(
    () => ({ status, account, token, requestCode, verifyCode, signOut }),
    [status, account, token, requestCode, verifyCode, signOut],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used within <AuthProvider>');
  return v;
}
