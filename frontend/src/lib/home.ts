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
import type { CompiledSpec, RecordPolicy } from '@/demo/engine/types';
import type { ContextSuggestion } from '@/demo/types';

export type { ContextSuggestion };

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
  /**
   * The compiled program and its capture policy. `list_questions` / `author_question`
   * have always returned the whole Question — this type just never declared these, so
   * the dashboard couldn't price a watch it already had the spec for. Optional because
   * a local watch has no record, and old stored rows may predate one.
   */
  compiledSpec?: CompiledSpec;
  record?: RecordPolicy;
  /** What Qwen recommends adding to make this (vision) watch work optimally. */
  contextSuggestions?: ContextSuggestion[];
  /** Reference-memory objects (household member ids) attached to this watch. */
  memoryIds?: string[];
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

/**
 * Pick whichever of two readings for the same input is fresher.
 *
 * Two writers race for the dashboard's reading state: the awaited read_input fetch and the
 * live socket. Whoever lands last used to win regardless of age, so a slow fetch could put a
 * stale number back on screen over a newer live one. Comparing `ts` makes the outcome depend
 * on the data rather than on arrival order. Ties favour `b` (the incoming value).
 */
export function newerReading(a: Reading | null | undefined, b: Reading | null | undefined): Reading | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return b.ts >= a.ts ? b : a;
}

export const describeHome = (token?: string | null) => call<HomeModel>('describe_home', {}, token);
export const listWatches = (token?: string | null) => call<Watch[]>('list_questions', {}, token);
export const listEvents = (limit = 20, token?: string | null) =>
  call<RunEvent[]>('list_events', { limit }, token);
export const readInput = (input: string, token?: string | null) =>
  call<Reading | null>('read_input', { input, agg: 'latest' }, token);

/** Latest camera frame for a vision input — a short-lived presigned OSS GET URL the hub pushed
 *  up (via /hub/frame). `ossUrl` is null until a frame has actually been stored, or if OSS is off. */
export interface Snapshot {
  input: string;
  ts: number;
  ossUrl: string | null;
  mime: string;
  provisioned: boolean;
}
export const getSnapshot = (input: string, token?: string | null) =>
  call<Snapshot>('get_snapshot', { input }, token);
export const authorWatch = (wish: string, token?: string | null) =>
  call<{ questionId: string; question: Watch; engine: string }>('author_question', { wish }, token);
/** Edit a watch: re-compiles the new wording into a fresh Question, keeping its id. */
export const updateWatch = (id: string, wish: string, token?: string | null) =>
  call<{ questionId: string; question: Watch; engine: string }>('update_question', { id, wish }, token);
export const deleteWatch = (id: string, token?: string | null) =>
  call<{ ok: boolean; questionId: string }>('delete_question', { id }, token);
/** Attach reference-memory objects to a watch (replaces its links; [] clears them). */
export const linkWatchMemory = (id: string, memoryIds: string[], token?: string | null) =>
  call<{ questionId: string; question: Watch }>('set_question_memory', { id, memoryIds }, token);
export const suggestRuns = (token?: string | null) =>
  call<{ suggestions: string[]; brain: string }>('suggest_runs', {}, token);

/* --- reference memory: named, tagged objects Qwen-VL reasons over (family, pets, vehicles…) --- */

export interface MemoryObject {
  id: string;
  label: string;
  tags?: string[];
  image: string; // presigned URL (from list) or a data: URI
  addedAt: number;
}

/** All reference objects, images resolved to fetchable URLs (backed by OSS when provisioned). */
export const listMemory = (token?: string | null) => call<MemoryObject[]>('list_household', {}, token);

/** Add a named, tagged reference object. `image` is a data: URI; it's persisted (to OSS) server-side. */
export const addMemoryObject = (
  label: string,
  image: string,
  tags: string[],
  token?: string | null,
) =>
  call<{ id: string; label: string; tags: string[]; addedAt: number; storage: string }>(
    'add_household_member',
    { label, image, tags },
    token,
  );

export const removeMemoryObject = (id: string, token?: string | null) =>
  call<{ ok: boolean; id: string }>('remove_household_member', { id }, token);

/* --- per-sensor sample cadence (REST, not an MCP tool) ------------------------- */

/** How fast each sensor is asked to sample, keyed by input id "<node>.<key>" → interval in ms. */
export type Cadences = Record<string, number>;

async function cadenceReq<T>(init: RequestInit, token?: string | null): Promise<T> {
  const res = await fetch(`${backendBase}/inputs/cadence`, {
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

/** Read the account's desired per-sensor sample cadences. */
export const listCadences = (token?: string | null) =>
  cadenceReq<{ cadences: Cadences }>({ method: 'GET' }, token).then((r) => r.cadences);

/** Ask a sensor to sample every `intervalMs` (clamped server-side). Takes effect within a few seconds. */
export const setCadence = (input: string, intervalMs: number, token?: string | null) =>
  cadenceReq<{ ok: boolean; input: string; intervalMs: number }>(
    { method: 'POST', body: JSON.stringify({ input, intervalMs }) },
    token,
  );
