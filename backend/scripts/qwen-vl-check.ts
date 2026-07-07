/**
 * Live check of the Qwen-VL (vision) path — proves the runtime "reason about a
 * real frame" role actually LOOKS at pixels, not a text scene string. Reads a
 * real image from the repo, base64-encodes it, and runs it through both the bare
 * probe and the production judge() path. Needs QWEN_API_KEY (real, not mock).
 *
 *   QWEN_API_KEY=... npm run qwen-vl-check
 */

import '../src/env.ts';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { probeVision, judge, hasKey } from '../src/qwen.ts';

const imgPath = fileURLToPath(new URL('../../docs/assets/hearth-landing.png', import.meta.url));
const dataUri = `data:image/png;base64,${readFileSync(imgPath).toString('base64')}`;

console.log(
  `key present: ${hasKey()}  vl model: ${process.env.QWEN_VL_MODEL ?? 'qwen-vl-plus'}  image: ${(readFileSync(imgPath).length / 1024).toFixed(0)}KB\n`,
);
if (!hasKey()) {
  console.error('FAIL — no QWEN_API_KEY; vision cannot be verified against real Qwen.');
  process.exit(1);
}

// 1) Bare probe: does the model actually describe what's in THIS image?
const { answer, engine: pe } = await probeVision(
  [dataUri],
  'Describe this image in one sentence. Set hasPerson true only if a real human being is visible. JSON {description, hasPerson}.',
);
console.log(`probe   [${pe}]  ${JSON.stringify(answer)}\n`);

// 2) Production judge() path with a real frame attached (no fake scene string).
const { judgment, engine: je } = await judge({
  title: 'Someone at the door',
  trigger: 'a person is at the front door',
  questions: ['is there a person visible in the camera frame?'],
  scene: '(live camera frame attached — look at the image)',
  visitor: null,
  images: [dataUri],
});
console.log(`judge   [${je}]  fired=${judgment.fired} verdict=${judgment.verdict}`);
console.log(`   → ${judgment.reasoning}`);
if (judgment.privacyNote) console.log(`   privacy: ${judgment.privacyNote}`);

const ok = pe === 'qwen' && je === 'qwen' && typeof answer.description === 'string';
console.log(`\n${ok ? 'PASS' : 'FAIL'} — Qwen-VL ${ok ? 'read the real frame end to end.' : 'did not answer from the real model.'}`);
process.exit(ok ? 0 : 1);
