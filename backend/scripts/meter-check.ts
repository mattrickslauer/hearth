/**
 * Verifies the METER against a real HTTP round-trip — the half `runs-check` can't reach.
 *
 * runs-check proves the arithmetic. This proves we actually READ the number: it stands up a
 * local OpenAI-compatible endpoint that answers with the same `usage` block Model Studio
 * sends, points the real `author()`/`judge()` at it via QWEN_BASE_URL, and checks that the
 * tokens the "API" reported are the tokens we billed. It is the only check that would catch
 * DashScope's usage block being dropped on the floor again — which is exactly what the code
 * did before this change.
 *
 *   A) judge() reports the server's own token counts, priced off the rate card,
 *   B) a repair retry is billed for BOTH calls, not just the one that succeeded,
 *   C) a reply we can't parse still bills — we paid for it regardless,
 *   D) the mock path (no key) reports no usage at all, not a zero.
 *
 * No key and no network — the server is local:
 *
 *   npm run meter-check
 */

import { createServer, type Server } from 'node:http';

import { MODEL_RATES } from '../src/domain.ts';

let failures = 0;
const check = (name: string, ok: boolean, detail: string): void => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} — ${detail}`);
};
const near = (a: number, b: number, tol = 1e-9): boolean => Math.abs(a - b) <= tol;

/** What the stub will say next, and what it was asked. */
let replies: { content: string; promptTokens: number; completionTokens: number; model?: string }[] = [];
let received = 0;

const server: Server = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    received += 1;
    const r = replies.shift() ?? { content: '{}', promptTokens: 0, completionTokens: 0 };
    res.writeHead(200, { 'content-type': 'application/json' });
    // Exactly the shape DashScope's OpenAI-compatible endpoint returns.
    res.end(
      JSON.stringify({
        model: r.model ?? 'qwen-vl-plus',
        choices: [{ message: { content: r.content } }],
        usage: { prompt_tokens: r.promptTokens, completion_tokens: r.completionTokens, total_tokens: r.promptTokens + r.completionTokens },
      }),
    );
  });
});

await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const port = (server.address() as { port: number }).port;

// Point the real client at the stub BEFORE importing it — the module reads env at load.
process.env.QWEN_BASE_URL = `http://127.0.0.1:${port}/v1/chat/completions`;
process.env.QWEN_API_KEY = 'test-key';
process.env.QWEN_VL_MODEL = 'qwen-vl-plus';
process.env.QWEN_MODEL = 'qwen-plus';

const { judge, author } = await import('../src/qwen.ts');

// ---- A) judge reports the server's real counts --------------------------------------

{
  replies = [{ content: JSON.stringify({ fired: true, verdict: 'a stranger', reasoning: 'unfamiliar face' }), promptTokens: 1234, completionTokens: 88 }];
  received = 0;
  const { judgment, engine, usage } = await judge({
    title: 'Front door',
    trigger: 'someone at the door',
    questions: ['is this a stranger?'],
    scene: '(frame)',
    visitor: null,
    images: ['http://example.invalid/frame.jpg'],
  });
  check('A1 the call actually went out', received === 1, `${received} request(s)`);
  check('A2 engine is qwen', engine === 'qwen', engine);
  check('A3 verdict survives', judgment.fired && judgment.verdict === 'a stranger', judgment.verdict);
  check('A4 tokens are the SERVER’s numbers, not a guess', usage?.inTokens === 1234 && usage?.outTokens === 88, `${usage?.inTokens}in/${usage?.outTokens}out`);
  check('A5 model is what the API said it billed', usage?.model === 'qwen-vl-plus', String(usage?.model));
  const want = (1234 * MODEL_RATES['qwen-vl'].in + 88 * MODEL_RATES['qwen-vl'].out) / 1_000_000;
  check('A6 priced off the rate card', near(usage!.usd, want), `$${usage!.usd.toFixed(8)} == $${want.toFixed(8)}`);
  check('A7 latency is measured', (usage?.ms ?? -1) >= 0, `${usage?.ms}ms`);
}

// ---- B) a repair retry bills twice --------------------------------------------------

{
  // First reply is valid JSON but fails validateQuestion (unknown input) → author retries.
  const bad = JSON.stringify({ title: 'x', compiledSpec: { kind: 'local', local: { expr: { left: { input: 'nope.sensor' }, op: '>', right: 1 } } } });
  const good = JSON.stringify({
    title: 'Front door watch',
    text: 'w',
    trigger: 'someone at the door',
    action: 'notify me',
    boundInputs: [],
    actuates: [],
    compiledSpec: { kind: 'cloud', cloud: { model: 'qwen-vl', question: 'stranger?' } },
  });
  replies = [
    { content: bad, promptTokens: 400, completionTokens: 150, model: 'qwen-plus' },
    { content: good, promptTokens: 520, completionTokens: 160, model: 'qwen-plus' },
  ];
  received = 0;
  const { engine, usage } = await author('watch the front door');
  check('B1 it really retried', received === 2, `${received} requests`);
  check('B2 authored by qwen after repair', engine === 'qwen', engine);
  check('B3 BOTH attempts are billed', usage?.inTokens === 920 && usage?.outTokens === 310, `${usage?.inTokens}in/${usage?.outTokens}out`);
  const want = ((920 * MODEL_RATES['qwen-plus'].in) + (310 * MODEL_RATES['qwen-plus'].out)) / 1_000_000;
  check('B4 the repair’s cost is included, not overwritten', near(usage!.usd, want), `$${usage!.usd.toFixed(8)} == $${want.toFixed(8)}`);
}

// ---- C) an unparseable reply still cost us ------------------------------------------

{
  replies = [{ content: 'I am terribly sorry, but I cannot answer that.', promptTokens: 900, completionTokens: 20 }];
  received = 0;
  const { engine, usage } = await judge({
    title: 'Front door',
    trigger: 't',
    questions: ['q'],
    scene: '(frame)',
    visitor: null,
    images: ['http://example.invalid/frame.jpg'],
  });
  check('C1 falls back to the mock verdict', engine === 'mock', engine);
  check('C2 but the wasted call is STILL billed', usage?.inTokens === 900 && usage?.outTokens === 20, `${usage?.inTokens}in/${usage?.outTokens}out`);
  check('C3 and priced', (usage?.usd ?? 0) > 0, `$${usage?.usd?.toFixed(8)}`);
}

// ---- D) no key → no spend, and no fake zero -----------------------------------------

{
  delete process.env.QWEN_API_KEY;
  received = 0;
  const { engine, usage } = await judge({
    title: 'Front door',
    trigger: 't',
    questions: ['q'],
    scene: '(frame)',
    visitor: null,
  });
  check('D1 no key means no call', received === 0, `${received} requests`);
  check('D2 mock engine', engine === 'mock', engine);
  check('D3 usage is absent, not $0', usage === undefined, String(usage));
}

// ---- E) end-to-end through the MCP surface the dashboard actually calls --------------

{
  process.env.QWEN_API_KEY = 'test-key';
  const { TOOLS } = await import('../src/tools.ts');
  const { MemoryStore } = await import('../src/store.ts');
  const store = new MemoryStore(false);
// src/ has no exported mint for an AccountId — a script must say out loud that it's faking one.
const ctx = { store, accountId: 'acct-meter-check' as unknown as import('../src/auth.ts').AccountId };
  const tool = (name: string) => TOOLS.find((t) => t.name === name)!;

  const good = JSON.stringify({
    title: 'Front door watch',
    text: 'w',
    trigger: 'someone at the door',
    action: 'notify me',
    boundInputs: [],
    actuates: [],
    compiledSpec: { kind: 'cloud', cloud: { model: 'qwen-vl', question: 'stranger?' } },
  });
  replies = [{ content: good, promptTokens: 430, completionTokens: 140, model: 'qwen-plus' }];
  received = 0;

  await tool('author_question').handler({ wish: 'watch the front door' }, ctx);
  check('E1 authoring hit the model once', received === 1, `${received} request(s)`);

  const res = (await tool('search_runs').handler({ sinceMs: 60_000 }, ctx)) as {
    runs: { kind: string; usd?: number; model?: string; title?: string }[];
    totals: { rows: number; billed: number; usd: number; usdFormatted: string; tokensIn: number };
    truncated: boolean;
  };

  check('E2 the authoring run is in the log', res.runs.some((r) => r.kind === 'authored'), res.runs.map((r) => r.kind).join(','));
  const row = res.runs.find((r) => r.kind === 'authored')!;
  const want = ((430 * MODEL_RATES['qwen-plus'].in) + (140 * MODEL_RATES['qwen-plus'].out) ) / 1_000_000;
  check('E3 the row carries its measured cost', near(row.usd ?? -1, want), `$${row.usd?.toFixed(8)} == $${want.toFixed(8)}`);
  check('E4 the row carries the model', row.model === 'qwen-plus', String(row.model));
  check('E5 the row is searchable by title', row.title === 'Front door watch', String(row.title));
  check('E6 totals add it up', near(res.totals.usd, want) && res.totals.billed === 1, `${res.totals.billed} billed, $${res.totals.usd.toFixed(8)}`);
  check('E7 totals are money-formatted for display', typeof res.totals.usdFormatted === 'string', res.totals.usdFormatted);
  check('E8 tokens are the server’s', res.totals.tokensIn === 430, `${res.totals.tokensIn}in`);

  // The filters the dashboard chips send must actually reach the log.
  const byText = (await tool('search_runs').handler({ sinceMs: 60_000, text: 'front door' }, ctx)) as { totals: { rows: number } };
  check('E9 text search finds it', byText.totals.rows === 1, `${byText.totals.rows} row(s)`);
  const miss = (await tool('search_runs').handler({ sinceMs: 60_000, text: 'garage' }, ctx)) as { totals: { rows: number } };
  check('E10 text search excludes non-matches', miss.totals.rows === 0, `${miss.totals.rows} row(s)`);
  const billed = (await tool('search_runs').handler({ sinceMs: 60_000, billedOnly: true }, ctx)) as { totals: { rows: number } };
  check('E11 billedOnly keeps the paid run', billed.totals.rows === 1, `${billed.totals.rows} row(s)`);
  const old = (await tool('search_runs').handler({ from: 0, to: 1000 }, ctx)) as { totals: { rows: number } };
  check('E12 a window that excludes it returns nothing', old.totals.rows === 0, `${old.totals.rows} row(s)`);
}

server.close();
console.log(failures ? `\n${failures} FAILED` : '\nall meter checks passed');
process.exit(failures ? 1 : 0);
