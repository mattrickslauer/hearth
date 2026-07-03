/**
 * Shared prompt construction for the Qwen brain. Pure (no React Native imports)
 * so the server-side API route can bundle it too.
 *
 * Authoring is program synthesis: NL wish → a compiled Question whose
 * `compiledSpec` the hub can run with no LLM. The grammar mirrors
 * docs/02 + docs/04 (PredicateNode + temporal `sustained`/`schedule`).
 */

export interface CapabilityLite {
  id: string;
  label: string;
  kind: 'sensor' | 'actuator';
  describes: string;
  vision?: boolean;
}

export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

const GRAMMAR = `PredicateNode (the compiled logic the hub evaluates over reading history + a clock):
  { "op": ">"|">="|"<"|"<="|"=="|"!=", "left": { "input": <inputId>, "agg"?: "latest"|"mean"|"min"|"max", "window"?: <Duration> }, "right": <number|string|boolean> }
  { "op": "and"|"or", "nodes": [ <PredicateNode>... ] }
  { "op": "not", "node": <PredicateNode> }
  { "op": "sustained", "node": <PredicateNode>, "for": <Duration> }     // node held CONTINUOUSLY ≥ for
  { "op": "schedule", "window": { "after"?: "HH:MM", "before"?: "HH:MM", "days"?: [0-6] } }  // real local time; overnight if after>before
  { "op": "changed", "input": <InputRef>, "window": <Duration> }
  { "op": "delta", "input": <InputRef>, "window": <Duration>, "threshold": <number> }
Durations are short strings: "30s", "5m", "1h".
RULES:
- If the wish says "for / after / more than N minutes/seconds" (a duration the state must HOLD), you MUST use "sustained". Never drop the duration.
- "after dark"/"at night"/a time of day → "schedule" (e.g. { after:"19:00", before:"07:00" }), NOT a boolean.
- Threshold/temporal logic over scalar inputs → compiledTo "local", runsLocally true, cost "none".
- Needs image/scene judgement (recognising a person, reading a scene) → compiledTo "cloud_vl", usesVision true, cost "cloud", runsLocally false; put a cheap local precondition in cloud.gate and the visual question in cloud.question.
- Set evalOn "interval" if the predicate contains sustained/schedule/changed/delta; otherwise "event".
- fire.edge is "rising" by default; add fire.cooldown (e.g. "10m") for nuisance-prone alerts.`;

export function authorSystemPrompt(caps: CapabilityLite[]): string {
  const registry = caps
    .map((c) => `- ${c.id} [${c.kind}${c.vision ? ', vision' : ''}]: ${c.describes}`)
    .join('\n');
  return `You are Hearth's authoring agent. Compile the homeowner's plain-language wish into ONE Question bound to the real inputs below. Never invent inputs that aren't listed.

INPUT REGISTRY (the only inputs that exist):
${registry}

${GRAMMAR}

Respond with ONLY a JSON object:
{
  "title": "short name (≤4 words)",
  "boundInputs": ["inputId", ...],
  "trigger": "plain-language trigger",
  "action": "plain-language action",
  "actuates": ["actuatorInputId", ...],
  "push": true|false,
  "usesVision": true|false,
  "runsLocally": true|false,
  "cost": "none"|"cloud",
  "compiledTo": "local"|"cloud_vl",
  "compiledSpec": { "kind":"local", "local": { "expr": <PredicateNode> } }
                | { "kind":"cloud", "cloud": { "model":"qwen-vl"|"qwen-vl-max"|"qwen-max"|"qwen-plus", "question":"<visual yes/no question>", "gate": <PredicateNode>, "maxCadence":"2s" } },
  "record": { "inputId":"<the sampled input, e.g. camera.frame>", "mode":"on_event"|"interval", "every":"10s", "retain": 8, "transform":"crop" },  // cloud only: how often to sample. Prefer "on_event" to save tokens; "interval" for a subject that lingers rather than arrives.
  "evalOn": "event"|"interval",
  "fire": { "edge":"rising"|"level", "cooldown"?: "<Duration>" },
  "authoring": ["≤3 short first-person notes on how you compiled it"]
}`;
}

export function authorUserPrompt(wish: string): string {
  return `Wish: "${wish}"\nCompile it now. JSON only.`;
}

export function judgeSystemPrompt(): string {
  return `You are Hearth's runtime reasoning agent. A Question's cheap local gate is already met; now judge whether it should actually fire, reasoning about the real situation like a thoughtful person — not a dumb threshold. If a camera frame is provided you are Qwen-VL reading the doorway scene. Household members must never be flagged as intruders. Be concise and explain yourself.

Respond with ONLY a JSON object:
{
  "fired": true|false,
  "verdict": "one word, e.g. MATCH | CLEAR | FIRED | HELD",
  "reasoning": "1-2 sentences, plain language, first person",
  "steps": ["≤3 short trace steps of what you did to be sure"],
  "privacyNote": "one short line on what did / didn't leave the home"
}`;
}

export function judgeUserPrompt(input: {
  title: string;
  trigger: string;
  questions: string[];
  scene: string;
  visitor: { label: string; household: boolean; rfid: string | null } | null;
}): string {
  const lines = [
    `Question: "${input.title}" — fires when: ${input.trigger}`,
    input.questions.filter(Boolean).length ? `Visual question to resolve: ${input.questions.filter(Boolean).join('; ')}` : '',
    `Camera scene: ${input.scene}`,
    input.visitor
      ? `Perceived person: ${input.visitor.label}; carries household RFID tag: ${input.visitor.rfid ? 'yes (' + input.visitor.rfid + ')' : 'no'}; known household member: ${input.visitor.household ? 'yes' : 'unknown'}`
      : 'No specific person perceived.',
    'Judge it now. JSON only.',
  ];
  return lines.filter(Boolean).join('\n');
}
