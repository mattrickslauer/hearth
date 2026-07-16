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
import { parseDuration, defaultRecord, type CloudModel, type Question, type RecordPolicy } from './domain';
import type { Agg, HomeStore, Scalar } from './store';
import { ossProvisioned, putImage, putFrame, presignKey, frameKey, resolveImage } from './oss';
import { deliverNotification } from './notify';

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
let hmseq = 0;
const nextHmId = () => `hm-${Date.now().toString(36)}-${(hmseq += 1)}`;

const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
/** Coerce an actuate value (true/1/"on"/"open"/"high"…) to a boolean desired state. */
const truthy = (v: unknown): boolean => {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return ['on', 'open', 'true', '1', 'high', 'start'].includes(v.trim().toLowerCase());
  return false;
};

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
    handler: async (a) => {
      const input = str(a.input);
      if (!ossProvisioned()) {
        return {
          input,
          ts: num(a.at, Date.now()),
          ossUrl: null,
          mime: 'image/jpeg',
          provisioned: false,
          note: 'OSS not configured (set OSS_BUCKET). Frames travel inline as base64 until then.',
        };
      }
      // Presigned GET for the latest stored frame of this input (populated by put_snapshot /
      // the hub frame push). The URL 404s until a frame has actually been stored.
      const ossUrl = await presignKey(frameKey(input), 600).catch(() => null);
      return { input, ts: num(a.at, Date.now()), ossUrl, mime: 'image/jpeg', provisioned: true };
    },
  },
  {
    name: 'put_snapshot',
    description:
      'Store a camera frame (a data: URI) to OSS as the latest frame for an input, so get_snapshot and the Qwen-VL judge can fetch it by presigned URL instead of shipping base64. Raw frame stays out of the store; only OSS holds it.',
    mode: ['runtime'],
    parameters: {
      type: 'object',
      properties: { input: { type: 'string' }, image: { type: 'string', description: 'data: URI (base64 JPEG/PNG)' } },
      required: ['input', 'image'],
      additionalProperties: false,
    },
    handler: async (a) => {
      const input = str(a.input);
      const image = str(a.image);
      if (!input || !image) throw new Error('input and image (data: URI) required');
      if (!ossProvisioned()) return { provisioned: false, note: 'OSS not configured; frame not stored.' };
      const handle = await putFrame(input, image);
      if (!handle) throw new Error('image must be a data: URI');
      return { provisioned: true, input, key: handle, ts: Date.now() };
    },
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
      // Recompile from scratch — same path as author_question — but keep the id and any
      // reference-memory links the homeowner attached (those are their choice, not the brain's).
      const { question, engine } = await qwenAuthor(str(a.wish));
      const q: Question = { ...question, id, memoryIds: existing.memoryIds };
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
    name: 'configure_question',
    description:
      "Tune a cloud watch's budget knobs WITHOUT re-authoring it: how it samples (mode + rate), and which Qwen model runs its cloud check. Unlike update_question this never re-runs program synthesis — the trigger, bindings and action are left exactly as compiled. These are the three settings that decide what a watch costs.",
    mode: ['authoring'],
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'the watch (question) id' },
        mode: {
          type: 'string',
          enum: ['on_event', 'interval'],
          description: "on_event: evaluate only when the scene changes (cheap). interval: evaluate on a timer.",
        },
        every: { type: 'string', description: "sample interval as a duration, e.g. '10s', '2m'" },
        model: {
          type: 'string',
          enum: ['qwen-vl', 'qwen-vl-max', 'qwen-max', 'qwen-plus'],
          description: 'which model runs the cloud check',
        },
      },
      required: ['id'],
      additionalProperties: false,
    },
    handler: async (a, { store }) => {
      const id = str(a.id);
      const existing = await store.getQuestion(id);
      if (!existing) throw new Error(`unknown question: ${id}`);
      if (existing.compiledSpec.kind !== 'cloud') {
        // A local predicate runs on the hub for free — it has no cadence to tune and
        // no model to pick. Fail loudly rather than silently storing a dead setting.
        throw new Error(`question ${id} is a local watch — it has no cloud budget knobs`);
      }

      const rec =
        existing.record ??
        defaultRecord(
          existing.boundInputs.find((b) => b.endsWith('.frame')) ?? existing.boundInputs[0] ?? 'camera.frame',
          existing.compiledSpec.cloud.maxCadence ?? '10s',
        );
      const mode = a.mode === undefined ? rec.mode : (str(a.mode) as typeof rec.mode);
      const every = a.every === undefined ? rec.every : str(a.every);
      // Never accept a rate the compiled spec's own budget guard forbids.
      if (parseDuration(every) <= 0) throw new Error(`invalid duration: ${str(a.every)}`);

      const q: Question = {
        ...existing,
        record: { ...rec, mode, every },
        compiledSpec: {
          kind: 'cloud',
          cloud: {
            ...existing.compiledSpec.cloud,
            ...(a.model === undefined ? {} : { model: str(a.model) as CloudModel }),
          },
        },
      };
      await store.putQuestion(q);
      return { questionId: q.id, question: q };
    },
  },
  {
    name: 'set_question_memory',
    description:
      "Attach reference-memory objects to a watch: link the specific household members (people, pets, vehicles) Qwen-VL should reason over when this watch fires, by their ids. Replaces the watch's current links. Pass an empty array to clear them (the watch then reasons over all of memory). Unknown ids are ignored.",
    mode: ['authoring'],
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'the watch (question) id' },
        memoryIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'household member ids to link (from list_household); empty clears all links',
        },
      },
      required: ['id', 'memoryIds'],
      additionalProperties: false,
    },
    handler: async (a, { store }) => {
      const id = str(a.id);
      const existing = await store.getQuestion(id);
      if (!existing) throw new Error(`unknown question: ${id}`);
      const requested = Array.isArray(a.memoryIds) ? a.memoryIds.map((m) => str(m)).filter(Boolean) : [];
      // Keep only ids that name a real household member, preserving the caller's order and de-duping.
      const known = new Set((await store.listHousehold()).map((m) => m.id));
      const memoryIds = [...new Set(requested)].filter((m) => known.has(m));
      const q: Question = { ...existing, memoryIds };
      await store.putQuestion(q);
      return { questionId: q.id, question: q };
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
    name: 'add_household_member',
    description:
      "Add a named, tagged reference object to the home's persistent visual memory — a person, pet, vehicle, or thing Qwen-VL should recognise (tag \"family\" to tell household from strangers, or \"vehicle\"/\"allowed\"/\"pet\"/\"watch\"). image is a data: URI or an image URL.",
    mode: ['authoring'],
    parameters: {
      type: 'object',
      properties: {
        label: { type: 'string', description: 'name, e.g. "Alex", "the grey Honda"' },
        image: { type: 'string', description: 'data: URI or image URL' },
        tags: { type: 'array', items: { type: 'string' }, description: 'reasoning categories, e.g. ["family"]' },
      },
      required: ['label', 'image'],
      additionalProperties: false,
    },
    handler: async (a, { store }) => {
      const label = str(a.label).trim();
      const image = str(a.image).trim();
      if (!label) throw new Error('label required');
      if (!image) throw new Error('image required (data: URI or URL)');
      const tags = Array.isArray(a.tags) ? a.tags.map((t) => str(t).trim()).filter(Boolean) : [];
      const member = { id: nextHmId(), label, tags, image, addedAt: Date.now() };
      // Durable storage: push the reference photo to OSS and keep only the `oss://` handle in
      // the store (small + durable). Falls back to inline when OSS isn't configured or the
      // value is already a URL.
      if (ossProvisioned()) {
        const handle = await putImage('household', member.id, image).catch(() => null);
        if (handle) member.image = handle;
      }
      await store.putHouseholdMember(member);
      // Don't echo the (large) image back — just the record.
      return {
        id: member.id,
        label: member.label,
        tags: member.tags,
        addedAt: member.addedAt,
        storage: member.image.startsWith('oss://') ? 'oss' : 'inline',
      };
    },
  },
  {
    name: 'list_household',
    description: 'List household members and their reference photos (used to recognise family on the doorway camera).',
    mode: ['authoring', 'runtime'],
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    handler: async (_a, { store }) => {
      const members = await store.listHousehold();
      if (!ossProvisioned()) return members;
      // Resolve `oss://` handles to short-lived presigned GET URLs (local signing, no network)
      // so both the dashboard and Qwen-VL can fetch each reference photo.
      return Promise.all(
        members.map(async (m) => ({ ...m, image: await resolveImage(m.image, 3600).catch(() => m.image) })),
      );
    },
  },
  {
    name: 'remove_household_member',
    description: 'Remove a household member (and their reference photo) by id.',
    mode: ['authoring'],
    parameters: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
    handler: async (a, { store }) => {
      const id = str(a.id);
      const existed = await store.deleteHouseholdMember(id);
      if (!existed) throw new Error(`unknown household member: ${id}`);
      return { ok: true, id };
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
    description:
      'Command an actuator by input id "<nodeId>.<key>" (e.g. a relay/motor node). Sets the device-shadow desired state; the owning hub relays it to the node on its next sync, and the node converges its output to match and echoes it back. Logged with rationale. Falls back to a recorded intent for inputs that are not a live hub actuator.',
    mode: ['runtime'],
    parameters: {
      type: 'object',
      properties: { input: { type: 'string' }, value: {}, reason: { type: 'string' } },
      required: ['input', 'value', 'reason'],
      additionalProperties: false,
    },
    handler: async (a, { store }) => {
      const input = str(a.input);
      const reason = str(a.reason);
      const on = truthy(a.value);

      // Resolve the input to a REAL actuator on a paired hub's node before committing a
      // desired state — "<nodeId>.<key>" must match an actuator a node self-described.
      const owns = (await store.listHubDevices()).some((s) =>
        s.nodes.some((n) => (n.actuators ?? []).some((ac) => `${n.id}.${ac.key}` === input)),
      );

      await store.appendEvent({
        id: `ev-act-${Date.now().toString(36)}`,
        ts: Date.now(),
        questionId: 'runtime',
        kind: 'actuate',
        reasoning: `${input} := ${on ? 'on' : 'off'} — ${reason}`,
      });

      if (owns) {
        // Live hardware: write the desired shadow; the hub pulls it on its next device sync.
        await store.setDesired(input, on);
        return { input, desired: on ? 'on' : 'off', status: 'queued', provisioned: true };
      }

      // Not a live hub actuator (demo/unwired input) — record intent + report the shape.
      return {
        input,
        desired: a.value as Scalar,
        status: 'sent',
        provisioned: false,
        note: 'No live hub actuator matched this input; recorded intent. Pair a hub with a node that self-describes this actuator to command real hardware.',
      };
    },
  },
  {
    name: 'notify',
    description:
      "Push a message to the homeowner on every notification channel they configured (Telegram / email). No-op with a note if they haven't set one up.",
    mode: ['runtime'],
    parameters: {
      type: 'object',
      properties: { message: { type: 'string', description: 'What to tell the homeowner.' } },
      required: ['message'],
      additionalProperties: false,
    },
    handler: async (a, { store }) => {
      const message = str(a.message);
      // Channels come from the ACCOUNT's saved config (dashboard → /notify/config), not from
      // process env — so a notification reaches this homeowner's Telegram/inbox rather than
      // one hard-coded destination shared by every account. The model picks the words; the
      // homeowner picks the destination, so there's no channel argument to get wrong.
      const result = await deliverNotification(store, '🔥 Hearth', message);
      if (!result.channels.length) {
        return {
          ok: true,
          delivered: false,
          note: 'No notification channel configured for this account — add Telegram or an email in the dashboard.',
        };
      }
      // ok:false when every channel errored — a caller branching on `ok` must never report
      // "told the homeowner" for a message that never left the building.
      return { ok: result.ok, delivered: result.delivered > 0, channels: result.channels };

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
