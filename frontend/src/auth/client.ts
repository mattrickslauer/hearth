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

export const backendBase = BASE;
