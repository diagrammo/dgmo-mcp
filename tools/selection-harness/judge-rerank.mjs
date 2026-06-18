// Constrained re-rank measurement. Tests the "deterministic recall → LLM
// re-rank" architecture: for each CONTESTED case (deterministic top-2 near-tied,
// where re-rank could change the answer), hand the LLM ONLY the deterministic
// top-5 (id + description) and see whether its pick stays correct (in accept[])
// and how often it agrees with the deterministic top-1. Since deterministic is
// ~100% on the curated corpus, this is a SAFETY check on delegating the final
// pick — can the LLM re-rank the near-ties without regressing? Pure read.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { createSuggester } from '../../src/suggest/scoring.ts';
import { judgePrompt, parseVerdict } from './judge-engine.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const reg = JSON.parse(readFileSync(path.join(here, 'registry.json'), 'utf8'));
const tr = JSON.parse(
  readFileSync(path.join(here, '../../src/suggest/triggers.json'), 'utf8')
);
const corpus = JSON.parse(
  readFileSync(path.join(here, '../../tests/fixtures/selection-corpus.json'), 'utf8')
);

const descById = Object.fromEntries(reg.map((r) => [r.id, r.description]));
const map = Object.fromEntries(Object.entries(tr).map(([id, e]) => [id, e.phrases]));
const priors = Object.fromEntries(
  Object.entries(tr).map(([id, e]) => [id, e.prior ?? 0]).filter(([, p]) => p > 0)
);
const { suggestChartTypes } = createSuggester(map, priors);

const MARGIN = 10;
const SHORTLIST = 5;
const active = corpus.cases.filter((c) => !c.wontfix);

// Contested = a real shortlist whose top-2 are within MARGIN (re-rank could move
// the answer), OR deterministic top-1 already misses (LLM might rescue it).
const cases = active
  .map((c) => {
    const ranked = suggestChartTypes(c.prompt).ranked.filter((x) => x.score > 0);
    const shortlist = ranked.slice(0, SHORTLIST).map((x) => x.type.id);
    const det = ranked[0]?.type.id ?? '';
    const gap = (ranked[0]?.score ?? 0) - (ranked[1]?.score ?? 0);
    const detPass = !!det && c.accept.includes(det);
    const contested = shortlist.length >= 2 && gap <= MARGIN;
    return { ...c, shortlist, det, gap, detPass, contested };
  })
  .filter((c) => c.contested || !c.detPass);

// Mini-catalog of ONLY the shortlisted types — the constraint under test.
const miniCatalog = (ids) =>
  ids.map((id) => `- ${id}: ${descById[id] ?? ''}`).join('\n');

function runClaude(prompt) {
  return new Promise((resolve) => {
    execFile('claude', ['-p', prompt], { timeout: 120_000, maxBuffer: 1 << 20 },
      (err, stdout) => resolve(err ? '' : (stdout || '').trim()));
  });
}

const idSet = new Set(reg.map((r) => r.id));
const concurrency = 6;
const queue = [...cases];
const out = [];
async function worker() {
  while (queue.length) {
    const c = queue.shift();
    const raw = await runClaude(judgePrompt(miniCatalog(c.shortlist), c.prompt));
    const { pick } = parseVerdict(raw, idSet);
    out.push({ ...c, llm: pick, llmPass: c.accept.includes(pick), agree: pick === c.det });
  }
}
console.error(`Re-ranking ${cases.length} contested cases (top-${SHORTLIST}, LLM-constrained)…`);
await Promise.all(Array.from({ length: Math.min(concurrency, cases.length || 1) }, worker));

const detPass = out.filter((c) => c.detPass).length;
const llmPass = out.filter((c) => c.llmPass).length;
const agree = out.filter((c) => c.agree).length;
const disagree = out.filter((c) => !c.agree);

console.log(`\n===== CONTESTED RE-RANK (${out.length} cases) =====`);
console.log(`deterministic top-1 in accept : ${detPass}/${out.length}`);
console.log(`LLM (top-${SHORTLIST}) pick in accept : ${llmPass}/${out.length}`);
console.log(`LLM agrees with deterministic  : ${agree}/${out.length}`);
console.log(`\n----- DISAGREEMENTS (LLM ≠ deterministic) -----`);
for (const c of disagree) {
  const verdict = c.llmPass ? (c.detPass ? 'both-ok' : 'LLM-RESCUED') : 'LLM-REGRESSED';
  console.log(
    `  [${verdict}] "${c.prompt}"\n     accept=[${c.accept.join(', ')}] det=${c.det} llm=${c.llm} shortlist=[${c.shortlist.join(', ')}] gap=${c.gap.toFixed(2)}`
  );
}
const regressed = disagree.filter((c) => !c.llmPass && c.detPass).length;
const rescued = disagree.filter((c) => c.llmPass && !c.detPass).length;
console.log(
  `\nSUMMARY: of ${out.length} contested — LLM regressed ${regressed}, rescued ${rescued}, net ${rescued - regressed}.`
);
