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
  MODEL_RATES,
  authorSystemPrompt,
  authorUserPrompt,
  judgeSystemPrompt,
  judgeUserPrompt,
  mockAuthor,
  mockJudge,
  type AuthoredQuestion,
  type CapabilityLite,
  type CloudModel,
  type Judgment,
} from './domain';
import { predicateInputs } from './predicate-inputs';

const ENDPOINT =
  process.env.QWEN_BASE_URL ?? 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions';
const TEXT_MODEL = process.env.QWEN_MODEL ?? 'qwen-plus';
// Vision model for the runtime "reasoning about a real frame" role (Qwen-VL).
const VISION_MODEL = process.env.QWEN_VL_MODEL ?? 'qwen-vl-plus';

const CAPS: CapabilityLite[] = CAPABILITIES.map((c) => ({
  id: c.id,
  label: c.label,
  kind: c.kind,
  describes: c.describes,
  vision: c.vision,
}));
const CAP_IDS = new Set(CAPS.map((c) => c.id));

/**
 * What one billed model call actually cost — measured, not forecast.
 *
 * `pricing.ts` quotes a watch's *configuration* ahead of time (cadence × payload × model).
 * This is the other half: what the API says it really billed us, per call. The two are
 * meant to be compared — a quote that drifts from the meter is the bug worth catching.
 *
 * Priced with the SAME `MODEL_RATES` the quote uses, so there is one source of truth for
 * money. See `docs/02-data-model.md:241` for the RunEvent shape this feeds.
 */
export interface CallUsage {
  /** The model the API says it billed (response `model`), not necessarily what we asked for. */
  model: string;
  inTokens: number;
  outTokens: number;
  usd: number;
  /** Wall-clock for the call, including transport — what the user waited. */
  ms: number;
  /**
   * True when `model` matched no entry in MODEL_RATES, so `usd` is 0 but the call was
   * NOT free. Surfaced rather than silently zeroed: a rate table that has fallen behind
   * the deployed model should look wrong, not look cheap.
   */
  unrated?: boolean;
}

/**
 * Map a DashScope model id onto a rate-table key. The catalog names the family
 * (`qwen-vl`) while we deploy a member of it (`qwen-vl-plus`), so match longest-first —
 * `qwen-vl-max` must win before `qwen-vl` or every max call bills at plus rates.
 */
function rateKeyFor(model: string): CloudModel | null {
  const keys = Object.keys(MODEL_RATES) as CloudModel[];
  const hit = keys
    .filter((k) => model === k || model.startsWith(`${k}-`))
    .sort((a, b) => b.length - a.length)[0];
  return hit ?? null;
}

/** Price real token counts. Same rates as the quote — never a second table. */
export function priceCall(model: string, inTokens: number, outTokens: number): { usd: number; unrated: boolean } {
  const key = rateKeyFor(model);
  if (!key) return { usd: 0, unrated: true };
  const rate = MODEL_RATES[key];
  return { usd: (inTokens * rate.in + outTokens * rate.out) / 1_000_000, unrated: false };
}

/** Read the `usage` block off an OpenAI-compatible reply and price it. */
function meter(data: QwenReply, asked: string, ms: number): CallUsage {
  const model = data.model || asked;
  const inTokens = data.usage?.prompt_tokens ?? 0;
  const outTokens = data.usage?.completion_tokens ?? 0;
  const { usd, unrated } = priceCall(model, inTokens, outTokens);
  return { model, inTokens, outTokens, usd, ms, ...(unrated ? { unrated: true } : {}) };
}

/** The slice of the OpenAI-compatible reply we read. `usage` is what makes spend real. */
type QwenReply = {
  model?: string;
  choices?: { message?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

/** A parsed reply plus what it cost. Every model call in this file returns both. */
type Metered = { json: Record<string, unknown>; usage: CallUsage };

/**
 * A call that reached the model and billed us, then failed on OUR side (unparseable
 * reply, malformed judgment). It carries the usage so the caller can still charge it:
 * a reply we couldn't read is not a reply we didn't pay for — and it's precisely the
 * case that triggers a second, also-billed repair attempt.
 */
export class QwenCallError extends Error {
  constructor(
    message: string,
    readonly usage?: CallUsage,
  ) {
    super(message);
    this.name = 'QwenCallError';
  }
}

/** Sum the calls a single logical operation made — a repair retry bills twice, so it counts twice. */
export function sumUsage(parts: CallUsage[]): CallUsage | undefined {
  if (!parts.length) return undefined;
  const last = parts[parts.length - 1];
  return {
    model: last.model,
    inTokens: parts.reduce((n, p) => n + p.inTokens, 0),
    outTokens: parts.reduce((n, p) => n + p.outTokens, 0),
    usd: parts.reduce((n, p) => n + p.usd, 0),
    ms: parts.reduce((n, p) => n + p.ms, 0),
    ...(parts.some((p) => p.unrated) ? { unrated: true as const } : {}),
  };
}

export interface JudgeInput {
  title: string;
  trigger: string;
  questions: string[];
  scene: string;
  visitor: { label: string; household: boolean; rfid: string | null } | null;
  /**
   * Real camera frames for the Qwen-VL path — each an http(s) URL or a
   * `data:image/...;base64,...` URI. When present (and a key is set) the judge
   * routes to the vision model and actually LOOKS instead of reading `scene`.
   */
  images?: string[];
  /**
   * Household reference photos (label + image). Sent to Qwen-VL BEFORE the live
   * frame so it can tell family from strangers by comparison — the "facial
   * recognition" without a face-embedding model, done by the VLM itself.
   */
  references?: { label: string; image: string }[];
}

async function chatJSON(key: string, system: string, user: string): Promise<Metered> {
  const started = Date.now();
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
  const data = (await res.json()) as QwenReply;
  const usage = meter(data, TEXT_MODEL, Date.now() - started);
  return { json: parseOrCharge(data, usage), usage };
}

/** Parse the reply, but attach the (already-billed) usage to any parse failure. */
function parseOrCharge(data: QwenReply, usage: CallUsage): Record<string, unknown> {
  try {
    return extractJSON(data.choices?.[0]?.message?.content ?? '');
  } catch (e) {
    throw new QwenCallError((e as Error).message, usage);
  }
}

/**
 * Multimodal call — the runtime Qwen-VL path. Same OpenAI-compatible endpoint,
 * but the user turn carries the text prompt plus one or more images (URL or
 * base64 data URI). We deliberately do NOT set response_format here: the VL
 * models don't reliably honour json_object, so we let the prompt ask for JSON
 * and lean on extractJSON. Falls through to the caller's mock on throw.
 */
async function chatVisionJSON(key: string, system: string, user: string, images: string[]): Promise<Metered> {
  const content: unknown[] = [{ type: 'text', text: user }];
  for (const url of images) content.push({ type: 'image_url', image_url: { url } });
  const started = Date.now();
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: VISION_MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content },
      ],
      temperature: 0.2,
    }),
  });
  if (!res.ok) throw new Error(`qwen-vl ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as QwenReply;
  // The image tokens pricing.ts *estimates* from frame size arrive here as fact, in
  // prompt_tokens — this is the number the quote should be checked against.
  const usage = meter(data, VISION_MODEL, Date.now() - started);
  return { json: parseOrCharge(data, usage), usage };
}

function extractJSON(text: string): Record<string, unknown> {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('no JSON in reply');
  return JSON.parse(text.slice(start, end + 1));
}

/**
 * Bare Qwen-VL probe — asks a free-form question about one or more images and
 * returns the model's JSON answer verbatim. Used by the vision self-check and
 * handy for debugging the frame pipeline in isolation of the judge grammar.
 */
export async function probeVision(
  images: string[],
  question: string,
): Promise<{ answer: Record<string, unknown>; engine: 'qwen' | 'mock'; usage?: CallUsage }> {
  const key = process.env.QWEN_API_KEY;
  if (!key) return { answer: { note: 'no key — vision unavailable' }, engine: 'mock' };
  const { json, usage } = await chatVisionJSON(
    key,
    'You are a precise vision system. Answer only about what is actually visible in the image(s). Reply with ONLY a JSON object.',
    `${question}\nReturn JSON only.`,
    images,
  );
  return { answer: json, engine: 'qwen', usage };
}

/** Collect every inputId a compiledSpec references (grounding check). */
function collectInputs(spec: Record<string, unknown>): string[] {
  if (spec.kind === 'local') return predicateInputs((spec.local as { expr?: unknown })?.expr);
  if (spec.kind === 'cloud') return predicateInputs((spec.cloud as { gate?: unknown })?.gate);
  return [];
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

/**
 * NL wish → compiled Question, with one reflect-and-repair retry. Mock fallback.
 *
 * `usage` is the sum across attempts, not the last one: a repair round-trip is billed
 * twice and the meter has to say so. It's returned even on the mock fallback path,
 * because a call that failed validation still spent tokens before it did.
 */
export async function author(
  wish: string,
): Promise<{ question: AuthoredQuestion; engine: 'qwen' | 'mock'; usage?: CallUsage }> {
  const key = process.env.QWEN_API_KEY;
  const spent: CallUsage[] = [];
  if (key) {
    const sys = authorSystemPrompt(CAPS);
    let user = authorUserPrompt(wish);
    let lastErr = 'unknown';
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const { json: raw, usage } = await chatJSON(key, sys, user);
        spent.push(usage);
        const err = validateQuestion(raw);
        if (!err) {
          return {
            question: { ...(raw as unknown as AuthoredQuestion), text: wish },
            engine: 'qwen',
            usage: sumUsage(spent),
          };
        }
        lastErr = err;
        user = `${authorUserPrompt(wish)}\n\nYour previous answer was invalid: ${err}. Fix it and return only the corrected JSON.`;
      } catch (e) {
        if (e instanceof QwenCallError && e.usage) spent.push(e.usage);
        lastErr = (e as Error).message;
        break;
      }
    }
    console.warn('[qwen] author fell back to mock:', lastErr);
  }
  return { question: mockAuthor(wish), engine: 'mock', usage: sumUsage(spent) };
}

/**
 * Judge a live situation. Mock fallback keeps the runtime honest without a key.
 *
 * `usage` is the cost of one Look. Present whenever the model was actually reached —
 * including when the reply was malformed and we fell back to the mock, since that
 * verdict was free but the call that preceded it was not.
 */
export async function judge(
  input: JudgeInput,
): Promise<{ judgment: Judgment; engine: 'qwen' | 'mock'; usage?: CallUsage }> {
  const key = process.env.QWEN_API_KEY;
  const spent: CallUsage[] = [];
  if (key) {
    // Reference photos go FIRST, the live frame(s) LAST, so the model compares against family.
    const refs = input.references ?? [];
    const visionImages = [...refs.map((r) => r.image), ...(input.images ?? [])];
    const useVision = visionImages.length > 0;
    let user = judgeUserPrompt(input);
    if (refs.length) {
      const list = refs.map((r, i) => `  image ${i + 1} = ${r.label}`).join('\n');
      user += `\n\nReference images of known household members, in order:\n${list}\nThe FINAL image is the LIVE camera frame. Decide whether the person in the live frame is one of these household members (say which), or someone who is not in the household.`;
    }
    try {
      const { json: raw, usage } = useVision
        ? await chatVisionJSON(key, judgeSystemPrompt(), user, visionImages)
        : await chatJSON(key, judgeSystemPrompt(), user);
      spent.push(usage);
      if (typeof raw.fired !== 'boolean' || !raw.verdict) throw new QwenCallError('malformed judgment', usage);
      return {
        judgment: {
          fired: !!raw.fired,
          verdict: String(raw.verdict),
          reasoning: String(raw.reasoning ?? ''),
          steps: Array.isArray(raw.steps) ? raw.steps.map(String) : [],
          privacyNote: raw.privacyNote ? String(raw.privacyNote) : undefined,
        },
        engine: 'qwen',
        usage,
      };
    } catch (e) {
      // A QwenCallError already banked its usage above (or carries it, when the throw
      // beat the push). Anything else never reached the model, so there's nothing to bill.
      if (e instanceof QwenCallError && e.usage && !spent.includes(e.usage)) spent.push(e.usage);
      console.warn(`[qwen] judge (${useVision ? 'vision' : 'text'}) fell back to mock:`, (e as Error).message);
    }
  }
  const judgment = mockJudge({
    dep: { usesVision: true, trigger: input.trigger },
    visitor: input.visitor ? { id: 'v', emoji: '', ...input.visitor } : null,
    scene: input.scene,
  });
  return { judgment, engine: 'mock', usage: sumUsage(spent) };
}
