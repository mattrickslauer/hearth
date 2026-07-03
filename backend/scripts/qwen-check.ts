/**
 * Live check against real Qwen (loads .env). Confirms the key works end to end:
 * authors two wishes and judges one scene, printing the compiled shapes + which
 * engine answered ('qwen' = real, 'mock' = fell back). No secrets are printed.
 */

import '../src/env.ts';
import { author, judge, hasKey } from '../src/qwen.ts';

console.log(`key present: ${hasKey()}  base: ${process.env.QWEN_BASE_URL ?? '(default intl)'}  model: ${process.env.QWEN_MODEL ?? 'qwen-plus'}\n`);

const wishes = [
  'Warn me if the garage is left open for more than 5 minutes.',
  "Tell me if someone who isn't family is at the front door.",
];

for (const wish of wishes) {
  const { question: q, engine } = await author(wish);
  console.log(`author  [${engine}]  "${wish}"`);
  console.log(`   → ${q.title} | ${q.compiledTo} | vision=${q.usesVision} | spec=${JSON.stringify(q.compiledSpec)}\n`);
}

const { judgment, engine } = await judge({
  title: 'Unfamiliar visitor',
  trigger: "someone at the door who isn't a household member",
  questions: ['the person at the door is not a household member'],
  scene: 'a person in a delivery uniform holding a package at the doorway',
  visitor: { label: 'a delivery courier', household: false, rfid: null },
});
console.log(`judge   [${engine}]  fired=${judgment.fired} verdict=${judgment.verdict}`);
console.log(`   → ${judgment.reasoning}`);
