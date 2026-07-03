/**
 * Qwen orchestration — the cloud brain. Two jobs (docs/03):
 *   author(wish)  — NL intent → a compiled Question (program synthesis, one-shot)
 *   judge(input)  — a live situation → verdict + reasoning (per cloud eval)
 *
 * Talks to Model Studio / DashScope's OpenAI-compatible endpoint. With no key set
 * it falls back to the deterministic shared brain, so the backend always answers.
 * This is the same logic the demo's /qwen route proved, lifted server-side.
 */

import {
  CAPABILITIES,
  authorSystemPrompt,
  authorUserPrompt,
  judgeSystemPrompt,
  judgeUserPrompt,
  mockAuthor,
  mockJudge,
  type AuthoredQuestion,
  type CapabilityLite,
  type Judgment,
} from './domain';

const ENDPOINT =
  process.env.QWEN_BASE_URL ?? 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions';
const TEXT_MODEL = process.env.QWEN_MODEL ?? 'qwen-plus';

const CAPS: CapabilityLite[] = CAPABILITIES.map((c) => ({
  id: c.id,
  label: c.label,
  kind: c.kind,
  describes: c.describes,
  vision: c.vision,
}));
const CAP_IDS = new Set(CAPS.map((c) => c.id));

export interface JudgeInput {
  title: string;
  trigger: string;
  questions: string[];
  scene: string;
  visitor: { label: string; household: boolean; rfid: string | null } | null;
}

async function chatJSON(key: string, system: string, user: string): Promise<Record<string, unknown>> {
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
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return extractJSON(data.choices?.[0]?.message?.content ?? '');
}

function extractJSON(text: string): Record<string, unknown> {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('no JSON in reply');
  return JSON.parse(text.slice(start, end + 1));
}

/** Collect every inputId a compiledSpec references (grounding check). */
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

export function validateQuestion(raw: Record<string, unknown>): string | null {
  if (!raw.title) return 'missing title';
  const spec = raw.compiledSpec as Record<string, unknown> | undefined;
  if (!spec || (spec.kind !== 'local' && spec.kind !== 'cloud')) return 'missing/invalid compiledSpec';
  const bad = collectInputs(spec).filter((i) => !CAP_IDS.has(i));
  if (bad.length) return `unknown inputs referenced: ${bad.join(', ')}`;
  return null;
}

export const hasKey = () => !!process.env.QWEN_API_KEY;

/** NL wish → compiled Question, with one reflect-and-repair retry. Mock fallback. */
export async function author(wish: string): Promise<{ question: AuthoredQuestion; engine: 'qwen' | 'mock' }> {
  const key = process.env.QWEN_API_KEY;
  if (key) {
    const sys = authorSystemPrompt(CAPS);
    let user = authorUserPrompt(wish);
    let lastErr = 'unknown';
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const raw = await chatJSON(key, sys, user);
        const err = validateQuestion(raw);
        if (!err) return { question: { ...(raw as unknown as AuthoredQuestion), text: wish }, engine: 'qwen' };
        lastErr = err;
        user = `${authorUserPrompt(wish)}\n\nYour previous answer was invalid: ${err}. Fix it and return only the corrected JSON.`;
      } catch (e) {
        lastErr = (e as Error).message;
        break;
      }
    }
    console.warn('[qwen] author fell back to mock:', lastErr);
  }
  return { question: mockAuthor(wish), engine: 'mock' };
}

/** Judge a live situation. Mock fallback keeps the runtime honest without a key. */
export async function judge(input: JudgeInput): Promise<{ judgment: Judgment; engine: 'qwen' | 'mock' }> {
  const key = process.env.QWEN_API_KEY;
  if (key) {
    try {
      const raw = await chatJSON(key, judgeSystemPrompt(), judgeUserPrompt(input));
      if (typeof raw.fired !== 'boolean' || !raw.verdict) throw new Error('malformed judgment');
      return {
        judgment: {
          fired: !!raw.fired,
          verdict: String(raw.verdict),
          reasoning: String(raw.reasoning ?? ''),
          steps: Array.isArray(raw.steps) ? raw.steps.map(String) : [],
          privacyNote: raw.privacyNote ? String(raw.privacyNote) : undefined,
        },
        engine: 'qwen',
      };
    } catch (e) {
      console.warn('[qwen] judge fell back to mock:', (e as Error).message);
    }
  }
  const judgment = mockJudge({
    dep: { usesVision: true, trigger: input.trigger },
    visitor: input.visitor ? { id: 'v', emoji: '', ...input.visitor } : null,
    scene: input.scene,
  });
  return { judgment, engine: 'mock' };
}
