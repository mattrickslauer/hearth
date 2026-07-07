/**
 * /qwen — the key-holding proxy to Qwen Cloud.
 *
 * All of this runs ON THE SERVER (Expo Router API route), so QWEN_API_KEY is
 * never shipped to the browser. It does the two Qwen-load-bearing jobs:
 *   task="author"  — plain-language wish  → a compiled deployment (JSON)
 *   task="judge"   — a live situation     → a verdict + reasoning (JSON)
 *
 * With no key set it falls back to the same deterministic brain the client uses,
 * so the demo always works; set QWEN_API_KEY (and EXPO_PUBLIC_USE_QWEN=1 on the
 * client) and the identical shapes come from Qwen instead.
 */

import { mockAuthor, mockJudge, type AuthoredQuestion } from '@/demo/brain/mock';
import {
  authorSystemPrompt,
  authorUserPrompt,
  judgeSystemPrompt,
  judgeUserPrompt,
  type CapabilityLite,
} from '@/demo/brain/prompts';
import { CAPABILITIES } from '@/demo/home';
import type { Judgment } from '@/demo/types';

const ENDPOINT =
  process.env.QWEN_BASE_URL ??
  'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions';
const TEXT_MODEL = process.env.QWEN_MODEL ?? 'qwen-plus';

// Backend that verifies session tokens. Only authenticated callers get to spend the
// (metered, paid) Qwen key; everyone else is served the deterministic mock, so the
// public demo keeps working while anonymous traffic can't run up the DashScope bill.
const BACKEND =
  process.env.EXPO_PUBLIC_BACKEND_URL?.replace(/\/$/, '') ||
  'https://hearth-mcp-gqfuhlkzpo.ap-southeast-1.fcapp.run';

/** Resolve the caller's account id from their bearer token via the backend, or null. */
async function authedAccountId(request: Request): Promise<string | null> {
  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return null;
  try {
    const res = await fetch(`${BACKEND}/auth/me`, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const data = (await res.json()) as { account?: { id?: string } };
    return data.account?.id ?? null;
  } catch {
    return null;
  }
}

// Per-account rate limit (per serverless instance) to bound key spend even for a
// signed-in caller. Best-effort — a shared store would be needed for hard global limits.
const RL_MAX = 30;
const RL_WINDOW_MS = 60_000;
const rl = new Map<string, { count: number; resetAt: number }>();
function allowSpend(accountId: string): boolean {
  const now = Date.now();
  if (rl.size > 10_000) for (const [k, v] of rl) if (now > v.resetAt) rl.delete(k);
  const e = rl.get(accountId);
  if (!e || now > e.resetAt) {
    rl.set(accountId, { count: 1, resetAt: now + RL_WINDOW_MS });
    return true;
  }
  if (e.count >= RL_MAX) return false;
  e.count += 1;
  return true;
}

const CAPS: CapabilityLite[] = CAPABILITIES.map((c) => ({
  id: c.id,
  label: c.label,
  kind: c.kind,
  describes: c.describes,
  vision: c.vision,
}));

/** Call Qwen's OpenAI-compatible chat endpoint and parse a JSON object reply. */
async function chatJSON(
  key: string,
  system: string,
  user: string,
): Promise<Record<string, unknown>> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: TEXT_MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' },
    }),
  });
  if (!res.ok) throw new Error(`qwen ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const content: string = data?.choices?.[0]?.message?.content ?? '';
  return extractJSON(content);
}

/** Models sometimes wrap JSON in prose or fences — pull out the first object. */
function extractJSON(text: string): Record<string, unknown> {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('no JSON in reply');
  return JSON.parse(text.slice(start, end + 1));
}

/** Collect every inputId referenced by a compiledSpec (for grounding checks). */
function collectInputs(spec: Record<string, unknown>): string[] {
  const out: string[] = [];
  const walk = (n: unknown): void => {
    if (!n || typeof n !== 'object') return;
    const o = n as Record<string, unknown>;
    const left = o.left as { input?: string } | undefined;
    const inp = o.input as { input?: string } | undefined;
    if (left?.input) out.push(left.input);
    if (inp?.input) out.push(inp.input);
    if (Array.isArray(o.nodes)) o.nodes.forEach(walk);
    if (o.node) walk(o.node);
  };
  if (spec.kind === 'local') walk((spec.local as { expr?: unknown })?.expr);
  else if (spec.kind === 'cloud') walk((spec.cloud as { gate?: unknown })?.gate);
  return out;
}

function validateQuestion(raw: Record<string, unknown>): string | null {
  if (!raw.title) return 'missing title';
  const spec = raw.compiledSpec as Record<string, unknown> | undefined;
  if (!spec || (spec.kind !== 'local' && spec.kind !== 'cloud')) return 'missing/invalid compiledSpec';
  const ids = new Set(CAPS.map((c) => c.id));
  const bad = collectInputs(spec).filter((i) => !ids.has(i));
  if (bad.length) return `unknown inputs referenced: ${bad.join(', ')}`;
  return null;
}

/** Author with one reflect-and-repair retry so the model can fix a bad spec. */
async function authorWithQwen(wish: string, key: string): Promise<AuthoredQuestion> {
  const sys = authorSystemPrompt(CAPS);
  let user = authorUserPrompt(wish);
  let lastErr = 'unknown';
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await chatJSON(key, sys, user);
    const err = validateQuestion(raw);
    if (!err) return { ...(raw as unknown as AuthoredQuestion), text: wish };
    lastErr = err;
    user = `${authorUserPrompt(wish)}\n\nYour previous answer was invalid: ${err}. Fix it and return only the corrected JSON.`;
  }
  throw new Error(`author validation failed: ${lastErr}`);
}

async function judgeWithQwen(body: JudgeBody, key: string): Promise<Judgment> {
  const raw = await chatJSON(
    key,
    judgeSystemPrompt(),
    judgeUserPrompt({
      title: body.dep?.title ?? 'a watch',
      trigger: body.dep?.trigger ?? '',
      questions: body.questions ?? [],
      scene: body.scene ?? 'the doorway',
      visitor: body.visitor ?? null,
    }),
  );
  if (typeof raw.fired !== 'boolean' || !raw.verdict) throw new Error('malformed judgment');
  return {
    fired: !!raw.fired,
    verdict: String(raw.verdict),
    reasoning: String(raw.reasoning ?? ''),
    steps: Array.isArray(raw.steps) ? raw.steps.map(String) : [],
    privacyNote: raw.privacyNote ? String(raw.privacyNote) : undefined,
  };
}

interface JudgeBody {
  dep?: { title: string; trigger: string; usesVision?: boolean; actuates?: string[] };
  questions?: string[];
  scene?: string;
  visitor?: { label: string; household: boolean; rfid: string | null } | null;
}

export async function POST(request: Request): Promise<Response> {
  let body: (JudgeBody & { task?: string; wish?: string }) | null = null;
  try {
    body = await request.json();
  } catch {
    return new Response('bad request', { status: 400 });
  }
  // Spend the real key only for an authenticated, under-quota caller. Otherwise the
  // mock brain answers — identical shapes, zero cost, no abuse surface.
  const accountId = await authedAccountId(request);
  const key = accountId && allowSpend(accountId) ? process.env.QWEN_API_KEY : undefined;

  try {
    if (body?.task === 'author' && typeof body.wish === 'string') {
      if (key) {
        try {
          return Response.json({ question: await authorWithQwen(body.wish, key), engine: 'qwen' });
        } catch (e) {
          console.warn('[qwen] author fell back to mock:', (e as Error).message);
        }
      }
      return Response.json({ question: mockAuthor(body.wish), engine: 'mock' });
    }

    if (body?.task === 'judge') {
      if (key) {
        try {
          return Response.json({ judgment: await judgeWithQwen(body, key), engine: 'qwen' });
        } catch (e) {
          console.warn('[qwen] judge fell back to mock:', (e as Error).message);
        }
      }
      const dep = {
        title: body.dep?.title ?? '',
        trigger: body.dep?.trigger ?? '',
        usesVision: !!body.dep?.usesVision,
        actuates: body.dep?.actuates ?? [],
      };
      return Response.json({
        judgment: mockJudge({
          dep: dep as never,
          visitor: (body.visitor as never) ?? null,
          scene: body.scene ?? 'the doorway',
        }),
        engine: 'mock',
      });
    }

    return new Response('unknown task', { status: 400 });
  } catch (e) {
    return new Response(`error: ${(e as Error).message}`, { status: 500 });
  }
}
