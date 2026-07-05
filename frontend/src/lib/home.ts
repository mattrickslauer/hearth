/**
 * Home client — thin calls to the backend's MCP surface (POST /mcp/call) for the
 * signed-in dashboard. The dashboard reads the live home model, authored watches,
 * activity, and sensor readings from the deployed Function Compute backend (or a
 * local `npm run dev` backend), selected by EXPO_PUBLIC_BACKEND_URL via backendBase.
 *
 * Note: the backend home is currently a single shared world (not yet per-account),
 * so all sessions see the same home until the store is keyed by account.
 */

import { backendBase } from '@/auth/client';

async function call<T>(
  tool: string,
  args: Record<string, unknown> = {},
  token?: string | null,
): Promise<T> {
  const res = await fetch(`${backendBase}/mcp/call`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ tool, args }),
  });
  if (!res.ok) {
    let detail = '';
    try {
      detail = ((await res.json()) as { error?: string }).error ?? '';
    } catch {
      /* non-JSON body */
    }
    throw new Error(detail || `${tool} failed (${res.status})`);
  }
  const data = (await res.json()) as { result: T };
  return data.result;
}

export interface HomeCapability {
  id: string;
  label: string;
  kind: 'sensor' | 'actuator';
  icon: string;
  unit?: string;
  describes: string;
  vision?: boolean;
}
export interface HomeZone {
  id: string;
  name: string;
  icon: string;
}
export interface HomeNode {
  id: string;
  name: string;
  zone: string;
  hardware: string;
  offGrid?: boolean;
  capabilities: HomeCapability[];
}
export interface HomeModel {
  zones: HomeZone[];
  nodes: HomeNode[];
  capabilities: HomeCapability[];
}

/** An authored Question, as the dashboard shows it. */
export interface Watch {
  id: string;
  title: string;
  text: string;
  trigger: string;
  action: string;
  boundInputs: string[];
  actuates: string[];
  runsLocally: boolean;
  usesVision: boolean;
  cost: 'none' | 'cloud';
  push?: boolean;
}

export interface RunEvent {
  id: string;
  ts: number;
  questionId: string;
  kind: string;
  answer?: boolean;
  reasoning?: string;
  evaluatedBy?: 'local' | 'qwen';
}

export interface Reading {
  input: string;
  ts: number;
  value: number | string | boolean;
}

export const describeHome = (token?: string | null) => call<HomeModel>('describe_home', {}, token);
export const listWatches = (token?: string | null) => call<Watch[]>('list_questions', {}, token);
export const listEvents = (limit = 20, token?: string | null) =>
  call<RunEvent[]>('list_events', { limit }, token);
export const readInput = (input: string, token?: string | null) =>
  call<Reading | null>('read_input', { input, agg: 'latest' }, token);
export const authorWatch = (wish: string, token?: string | null) =>
  call<{ questionId: string; question: Watch; engine: string }>('author_question', { wish }, token);
/** Edit a watch: re-compiles the new wording into a fresh Question, keeping its id. */
export const updateWatch = (id: string, wish: string, token?: string | null) =>
  call<{ questionId: string; question: Watch; engine: string }>('update_question', { id, wish }, token);
export const deleteWatch = (id: string, token?: string | null) =>
  call<{ ok: boolean; questionId: string }>('delete_question', { id }, token);
export const suggestRuns = (token?: string | null) =>
  call<{ suggestions: string[]; brain: string }>('suggest_runs', {}, token);

/* --- per-node sample cadence (REST, not an MCP tool) --------------------------- */

/** How fast each node is asked to sample, keyed by nodeId → interval in ms. */
export type Cadences = Record<string, number>;

async function cadenceReq<T>(init: RequestInit, token?: string | null): Promise<T> {
  const res = await fetch(`${backendBase}/nodes/cadence`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error((data.error as string) || `cadence request failed (${res.status})`);
  return data as T;
}

/** Read the account's desired per-node sample cadences. */
export const listCadences = (token?: string | null) =>
  cadenceReq<{ cadences: Cadences }>({ method: 'GET' }, token).then((r) => r.cadences);

/** Ask a node to sample every `intervalMs` (clamped server-side). Takes effect within a few seconds. */
export const setCadence = (nodeId: string, intervalMs: number, token?: string | null) =>
  cadenceReq<{ ok: boolean; nodeId: string; intervalMs: number }>(
    { method: 'POST', body: JSON.stringify({ nodeId, intervalMs }) },
    token,
  );
