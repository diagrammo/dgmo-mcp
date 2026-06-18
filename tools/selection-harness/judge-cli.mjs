// CLI driver for the LLM selection-judge — runs the same engine as judge.html
// over the full active corpus, then prints the fail / disagree splits so judge
// curation can happen without driving the browser. Pure read; writes nothing.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { judgeAll } from './judge-engine.ts';
import { createSuggester } from '../../src/suggest/scoring.ts';
import { activeCases } from './diff-run.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const registry = JSON.parse(readFileSync(path.join(here, 'registry.json'), 'utf8'));
const triggers = JSON.parse(readFileSync(path.join(here, '../../src/suggest/triggers.json'), 'utf8'));
const corpus = JSON.parse(
  readFileSync(path.join(here, '../../tests/fixtures/selection-corpus.json'), 'utf8')
);

const descriptions = Object.fromEntries(registry.map((r) => [r.id, r.description]));
const ids = registry.map((r) => r.id);
const triggerMap = Object.fromEntries(
  Object.entries(triggers).map(([id, entry]) => [id, entry.phrases])
);
const suggest = createSuggester(triggerMap);
const cases = activeCases(corpus);
const prompts = cases.map((c) => c.prompt);
const acceptByPrompt = new Map(cases.map((c) => [c.prompt, c.accept]));

const detPick = (p) => suggest(p).ranked[0]?.type.id ?? '';

console.error(`Judging ${prompts.length} prompts via claude -p ...`);
const verdicts = await judgeAll(descriptions, prompts, ids, 6);

const rows = verdicts.map((v) => {
  const det = detPick(v.prompt);
  const acc = acceptByPrompt.get(v.prompt) ?? [];
  return {
    prompt: v.prompt,
    accept: acc,
    det,
    llm: v.pick,
    reason: v.reason,
    detFail: !acc.includes(det),
    llmFail: !acc.includes(v.pick),
    disagree: det !== v.pick,
  };
});

const fmt = (r) =>
  `  "${r.prompt}"\n     accept=[${r.accept.join(', ')}]  det=${r.det}  llm=${r.llm}  «${r.reason}»`;

const detFails = rows.filter((r) => r.detFail);
const llmFails = rows.filter((r) => r.llmFail);
const disagrees = rows.filter((r) => r.disagree);

console.log(`\n===== DETERMINISTIC FAILS (${detFails.length}) — shipped scorer pick ∉ accept =====`);
detFails.forEach((r) => console.log(fmt(r)));
console.log(`\n===== LLM FAILS (${llmFails.length}) — LLM pick ∉ accept =====`);
llmFails.forEach((r) => console.log(fmt(r)));
console.log(`\n===== DISAGREE (${disagrees.length}) — LLM pick ≠ deterministic pick =====`);
disagrees.forEach((r) => console.log(fmt(r)));
console.log(
  `\nSUMMARY: ${rows.length} active | detFails ${detFails.length} | llmFails ${llmFails.length} | disagree ${disagrees.length}`
);
