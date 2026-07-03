/**
 * Auth client — thin calls to the backend's OTP endpoints. The frontend NEVER
 * generates or verifies codes; it only relays email/code and stores the returned
 * session token. All the security (hashing, TTL, attempt limits, signing) is
 * server-side (backend/src/auth.ts).
 *
 * Backend base URL comes from EXPO_PUBLIC_BACKEND_URL; defaults to the deployed
 * Function Compute function. For local dev: EXPO_PUBLIC_BACKEND_URL=http://localhost:9000
 */

export interface Account {
  id: string;
  email: string;
  createdAt?: number;
  lastLoginAt?: number;
}

const BASE =
  (process.env.EXPO_PUBLIC_BACKEND_URL?.replace(/\/$/, '') ||
    'https://hearth-mcp-gqfuhlkzpo.ap-southeast-1.fcapp.run');

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (await res.json()) as T;
}

export function requestOtp(email: string): Promise<{ ok: boolean; delivered: boolean; note?: string }> {
  return post('/auth/request-otp', { email });
}

export function verifyOtp(
  email: string,
  code: string,
): Promise<{ ok: boolean; token?: string; account?: Account; error?: string }> {
  return post('/auth/verify-otp', { email, code });
}

export async function fetchMe(token: string): Promise<Account | null> {
  try {
    const res = await fetch(`${BASE}/auth/me`, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const data = (await res.json()) as { account?: Account };
    return data.account ?? null;
  } catch {
    return null;
  }
}

/**
 * Decode a session JWT's payload WITHOUT verifying its signature — the server is the
 * only authority that verifies (it holds the secret). We read the claims client-side
 * purely to (a) restore auth state instantly on refresh before /auth/me resolves and
 * (b) self-expire a stale token locally instead of showing a signed-in UI for it.
 */
interface LocalSession {
  id: string;
  email: string;
  exp: number; // seconds since epoch
}

function b64urlDecode(seg: string): string {
  // atob exists on web, on Hermes (RN), and on Node 16+ (SSR). If it's somehow
  // missing the caller's try/catch turns the throw into a null (server still verifies).
  return atob(seg.replace(/-/g, '+').replace(/_/g, '/'));
}

export function decodeSession(token: string | null | undefined): LocalSession | null {
  if (!token) return null;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const p = JSON.parse(b64urlDecode(parts[1])) as Record<string, unknown>;
    if (typeof p.sub !== 'string' || typeof p.exp !== 'number') return null;
    return { id: p.sub, email: typeof p.email === 'string' ? p.email : '', exp: p.exp };
  } catch {
    return null;
  }
}

/** True only if the token decodes and its exp is still in the future (30s skew). */
export function sessionValidLocally(token: string | null | undefined): boolean {
  const s = decodeSession(token);
  return !!s && Date.now() / 1000 < s.exp - 30;
}

export const backendBase = BASE;
