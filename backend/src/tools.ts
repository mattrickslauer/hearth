/**
 * The Home MCP tool catalog (docs/03). Composable, typed primitives — Qwen calls
 * these to perceive and act on the home. Transport-agnostic: exposed over HTTP as
 * both an MCP-style tool list and plain function-calling schemas (see server.ts).
 *
 * Runtime is deliberately constrained: perceive/investigate freely, but actuation
 * only fires a Question's pre-authored effects. Authoring holds the creative latitude.
 *
 * OSS (snapshots) and IoT device-shadow (actuation transport) are stubbed with a
 * clear `provisioned:false` marker until the Alibaba account exists — the shapes are
 * final so wiring them later is fill-in-the-blank.
 */

import { author as qwenAuthor, hasKey, validateQuestion } from './qwen';
import { parseDuration, defaultRecord, type Question, type RecordPolicy } from './domain';
import type { Agg, HomeStore, Scalar } from './store';

export interface ToolCtx {
  store: HomeStore;
}

export interface Tool {
  name: string;
  description: string;
  mode: ('authoring' | 'runtime')[];
  parameters: Record<string, unknown>; // JSON Schema (function-calling compatible)
  handler: (args: Record<string, unknown>, ctx: ToolCtx) => Promise<unknown>;
}

let qseq = 0;
const nextQid = () => `q-${Date.now().toString(36)}-${(qseq += 1)}`;

const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export const TOOLS: Tool[] = [
  {
    name: 'describe_home',
    description: 'World-model summary: zones, devices, inputs and how they are placed.',
    mode: ['authoring', 'runtime'],
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    handler: (_a, { store }) => store.describeHome(),
  },
  {
    name: 'list_inputs',
    description: 'List bindable inputs with their kind and human semantics.',
    mode: ['authoring'],
    parameters: {
      type: 'object',
      properties: { filter: { type: 'string', enum: ['sensor', 'actuator'] } },
      additionalProperties: false,
    },
    handler: (a, { store }) => store.listInputs(a.filter as 'sensor' | 'actuator' | undefined),
  },
  {
    name: 'read_input',
    description: 'Latest or aggregated scalar reading for an input over an optional window.',
    mode: ['authoring', 'runtime'],
    parameters: {
      type: 'object',
      properties: {
        input: { type: 'string' },
        agg: { type: 'string', enum: ['latest', 'mean', 'min', 'max', 'count'] },
        window: { type: 'string', description: 'Duration e.g. "5m"' },
      },
      required: ['input'],
      additionalProperties: false,
    },
    handler: (a, { store }) =>
      store.readInput(str(a.input), (str(a.agg, 'latest') as Agg) || 'latest', parseDuration(str(a.window) || undefined), Date.now()),
  },
  {
    name: 'query_history',
    description: 'Time-series slice of an input between two epoch-ms timestamps.',
    mode: ['authoring', 'runtime'],
    parameters: {
      type: 'object',
      properties: { input: { type: 'string' }, from: { type: 'number' }, to: { type: 'number' } },
      required: ['input'],
      additionalProperties: false,
    },
    handler: (a, { store }) => store.history(str(a.input), num(a.from, 0), num(a.to, Date.now())),
  },
  {
    name: 'get_snapshot',
    description: 'Fetch a camera frame for Qwen-VL (OSS presigned GET). Raw stays local; only minimized frames leave.',
    mode: ['authoring', 'runtime'],
    parameters: {
      type: 'object',
      properties: { input: { type: 'string' }, at: { type: 'number' } },
      required: ['input'],
      additionalProperties: false,
    },
    // OSS not provisioned yet — return the shape with a clear marker.
    handler: async (a) => ({
      input: str(a.input),
      ts: num(a.at, Date.now()),
      ossUrl: null,
      mime: 'image/jpeg',
      provisioned: false,
      note: 'OSS presigned URLs land here once the Alibaba account + bucket exist (backend/README.md).',
    }),
  },
  {
    name: 'list_hub_devices',
    description:
      'Real devices reported by paired on-prem hubs: each ESP32 node, what it can sense, its latest readings, and whether it is online. This is live hardware in the home (distinct from any demo world). Their sensor readings are also queryable via read_input/query_history using the id "<nodeId>.<sensorKey>".',
    mode: ['authoring', 'runtime'],
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    handler: (_a, { store }) => store.listHubDevices(),
  },
  {
    name: 'list_questions',
    description: 'List the authored Questions (watches) currently deployed on the home.',
    mode: ['authoring', 'runtime'],
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    handler: (_a, { store }) => store.listQuestions(),
  },
  {
    name: 'list_events',
    description:
      'Recent run events (authored / fired / actuate / notify) with reasoning — the home activity feed.',
    mode: ['authoring', 'runtime'],
    parameters: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'Max events to return (default 20)' } },
      additionalProperties: false,
    },
    handler: (a, { store }) => store.listEvents(num(a.limit, 20) || 20),
  },
  {
    name: 'author_question',
    description:
      'Program synthesis: compile a plain-language wish into a runnable Question (local predicate or cloud/VL check) and persist it. The hero authoring path.',
    mode: ['authoring'],
    parameters: {
      type: 'object',
      properties: { wish: { type: 'string' } },
      required: ['wish'],
      additionalProperties: false,
    },
    handler: async (a, { store }) => {
      const { question, engine } = await qwenAuthor(str(a.wish));
      const q: Question = { ...question, id: nextQid() };
      if (q.compiledSpec.kind === 'cloud' && !q.record) {
        const inputId = q.boundInputs.find((b) => b.endsWith('.frame')) ?? q.boundInputs[0] ?? 'camera.frame';
        q.record = defaultRecord(inputId, q.compiledSpec.cloud.maxCadence ?? '10s');
      }
      await store.putQuestion(q);
      await store.appendEvent({ id: `ev-${q.id}`, ts: Date.now(), questionId: q.id, kind: 'authored', reasoning: `authored by ${engine}` });
      return { questionId: q.id, question: q, engine };
    },
  },
  {
    name: 'update_question',
    description:
      'Edit an authored Question: re-compile a revised plain-language wish into a fresh runnable Question and replace the existing one in place (same id). Editing always re-runs program synthesis — the trigger, action, bindings and local/cloud plan are re-derived from the new wording.',
    mode: ['authoring'],
    parameters: {
      type: 'object',
      properties: { id: { type: 'string' }, wish: { type: 'string' } },
      required: ['id', 'wish'],
      additionalProperties: false,
    },
    handler: async (a, { store }) => {
      const id = str(a.id);
      const existing = await store.getQuestion(id);
      if (!existing) throw new Error(`unknown question: ${id}`);
      // Recompile from scratch — same path as author_question — but keep the id.
      const { question, engine } = await qwenAuthor(str(a.wish));
      const q: Question = { ...question, id };
      if (q.compiledSpec.kind === 'cloud' && !q.record) {
        const inputId = q.boundInputs.find((b) => b.endsWith('.frame')) ?? q.boundInputs[0] ?? 'camera.frame';
        q.record = defaultRecord(inputId, q.compiledSpec.cloud.maxCadence ?? '10s');
      }
      await store.putQuestion(q);
      await store.appendEvent({ id: `ev-edit-${id}-${Date.now().toString(36)}`, ts: Date.now(), questionId: id, kind: 'edited', reasoning: `re-compiled by ${engine}` });
      return { questionId: q.id, question: q, engine };
    },
  },
  {
    name: 'delete_question',
    description: 'Permanently remove an authored Question (watch) from the home.',
    mode: ['authoring'],
    parameters: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
    handler: async (a, { store }) => {
      const id = str(a.id);
      const existed = await store.deleteQuestion(id);
      if (!existed) throw new Error(`unknown question: ${id}`);
      await store.appendEvent({ id: `ev-del-${id}-${Date.now().toString(36)}`, ts: Date.now(), questionId: id, kind: 'removed', reasoning: 'watch removed' });
      return { ok: true, questionId: id };
    },
  },
  {
    name: 'create_question',
    description: 'Persist an already-compiled Question spec (inputs are grounded against the registry).',
    mode: ['authoring'],
    parameters: {
      type: 'object',
      properties: { spec: { type: 'object' } },
      required: ['spec'],
      additionalProperties: false,
    },
    handler: async (a, { store }) => {
      const spec = (a.spec ?? {}) as Record<string, unknown>;
      const err = validateQuestion(spec);
      if (err) throw new Error(`invalid question: ${err}`);
      const q = { ...(spec as unknown as Question), id: nextQid() };
      await store.putQuestion(q);
      return { questionId: q.id };
    },
  },
  {
    name: 'set_record',
    description: 'Create or adjust a capture policy (the metered sample rate / frame rate) for an input.',
    mode: ['authoring'],
    parameters: {
      type: 'object',
      properties: {
        inputId: { type: 'string' },
        mode: { type: 'string', enum: ['interval', 'on_event'] },
        every: { type: 'string', description: 'Duration e.g. "10s"' },
        retain: { type: 'number' },
        transform: { type: 'string', enum: ['raw', 'crop', 'downscale', 'redact'] },
      },
      required: ['inputId'],
      additionalProperties: false,
    },
    handler: async (a, { store }) => {
      const policy: RecordPolicy = {
        inputId: str(a.inputId),
        mode: (str(a.mode, 'on_event') as RecordPolicy['mode']) || 'on_event',
        every: str(a.every, '10s') || '10s',
        retain: num(a.retain, 8),
        transform: (a.transform as RecordPolicy['transform']) ?? 'crop',
      };
      await store.putRecord(policy);
      return { record: policy };
    },
  },
  {
    name: 'actuate',
    description: 'Command an actuator (→ IoT shadow desired state, node-side safety veto). Logged with rationale.',
    mode: ['runtime'],
    parameters: {
      type: 'object',
      properties: { input: { type: 'string' }, value: {}, reason: { type: 'string' } },
      required: ['input', 'value', 'reason'],
      additionalProperties: false,
    },
    // IoT Platform shadow not provisioned — record intent + report the shape.
    handler: async (a, { store }) => {
      await store.appendEvent({
        id: `ev-act-${Date.now().toString(36)}`,
        ts: Date.now(),
        questionId: 'runtime',
        kind: 'actuate',
        reasoning: `${str(a.input)} := ${JSON.stringify(a.value)} — ${str(a.reason)}`,
      });
      return {
        input: str(a.input),
        desired: a.value as Scalar,
        status: 'sent',
        provisioned: false,
        note: 'Publishes to IoT Platform device shadow (desired) once the account + hub pairing exist.',
      };
    },
  },
  {
    name: 'notify',
    description: 'Deliver an Action to a channel (Expo push / Telegram / SMS / email).',
    mode: ['runtime'],
    parameters: {
      type: 'object',
      properties: { channelId: { type: 'string' }, message: { type: 'string' } },
      required: ['channelId', 'message'],
      additionalProperties: false,
    },
    handler: async (a, { store }) => {
      const channelId = str(a.channelId);
      const message = str(a.message);
      await store.appendEvent({ id: `ev-notify-${Date.now().toString(36)}`, ts: Date.now(), questionId: 'runtime', kind: 'notify', reasoning: `${channelId}: ${message}` });
      // Telegram works with just a bot token + chat id — the one channel that needs no Alibaba setup.
      const token = process.env.TELEGRAM_BOT_TOKEN;
      const chat = process.env.TELEGRAM_CHAT_ID;
      if (channelId.startsWith('telegram') && token && chat) {
        try {
          const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ chat_id: chat, text: message }),
          });
          return { ok: res.ok, channel: channelId, delivered: res.ok };
        } catch (e) {
          return { ok: false, channel: channelId, error: (e as Error).message };
        }
      }
      return { ok: true, channel: channelId, delivered: false, note: 'logged; wire Expo Push / SMS / DirectMail channels next.' };
    },
  },
  {
    name: 'suggest_runs',
    description: 'Propose useful Questions from the world model (onboarding hero beat).',
    mode: ['authoring'],
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    handler: async (_a, { store }) => {
      const caps = await store.listInputs();
      const ideas: string[] = [];
      const has = (id: string) => caps.some((c) => c.id === id);
      if (has('garage.door')) ideas.push('Warn me if the garage is left open for more than 5 minutes.');
      if (has('camera.frame')) ideas.push("Tell me if someone who isn't family is at the front door.");
      if (has('living.motion')) ideas.push('Turn on the living-room lamp when there is motion after dark.');
      if (has('garage.temp')) ideas.push('Switch on the garage heater if it drops below 5°C overnight.');
      return { suggestions: ideas, brain: hasKey() ? 'qwen' : 'mock' };
    },
  },
];

export const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

/** Function-calling catalog (OpenAI/Qwen tools schema) — the transport-agnostic view. */
export function toolSchemas() {
  return TOOLS.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}
