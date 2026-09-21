// ============================================================
// report.mjs — turn a guidance-studio session into a committed result file.
//
// The studio's only output is `trial-runs.json`, and that file is gitignored
// (.gitignore:16) because every trial carries its rendered PNG inline as
// base64 — a two-chart-type session came to 404 KB. So a run survived a
// refresh on the machine that made it and reached nobody else, which is why
// the instrument has been repaired four times and read never (#847).
//
// This writes the same session out WITHOUT the images: a dated markdown file
// under `results/`, carrying the verdict per trial, the diagnostics the
// pipeline returned, the DGMO the model actually produced, and — the headline
// the studio never stated — how many chart types the session covered at all.
//
// Run: node tools/guidance-studio/report.mjs   (or `pnpm studio:report`)
//      node tools/guidance-studio/report.mjs --out <path>
//
// 🔴 It refuses rather than reporting an empty session. A result file saying
// "0 trials" is indistinguishable from a run nobody made, and the whole point
// of the file is that somebody else can trust what it says.
// ============================================================
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const TRIALS_PATH = path.join(here, 'trial-runs.json');
const REGISTRY_PATH = path.join(here, 'registry.json');
const RESULTS_DIR = path.join(here, 'results');

/**
 * Reduce the studio's persisted trials to the facts a reader needs, dropping
 * everything an image or a prompt echo would add.
 *
 * @param {Record<string, Record<string, unknown>>} trials the trial-runs.json store
 * @param {string[]} knownTypes every chart type the studio offers, for coverage
 */
export function summariseTrials(trials, knownTypes = []) {
  const types = Object.keys(trials)
    .filter((t) => Object.keys(trials[t] ?? {}).length > 0)
    .sort();

  const rows = types.map((type) => {
    const byIdx = trials[type] ?? {};
    const trialList = Object.keys(byIdx)
      .sort((a, b) => Number(a) - Number(b))
      .map((idx) => {
        const trial = byIdx[idx] ?? {};
        const result = trial.result ?? {};
        // A trial is RENDERED when the pipeline returned no error and some
        // DGMO came back. `svg`/`pngBase64` are deliberately not consulted —
        // they are the fields this report exists to leave behind.
        const error = result.error ? String(result.error) : null;
        const dgmo = typeof result.dgmo === 'string' ? result.dgmo.trim() : '';
        const diagnostics = Array.isArray(result.diagnostics)
          ? result.diagnostics.map((d) =>
              typeof d === 'string' ? d : (d?.message ?? JSON.stringify(d))
            )
          : [];
        return {
          idx: Number(idx),
          prompt: typeof trial.prompt === 'string' ? trial.prompt : '',
          ts: typeof trial.ts === 'number' ? trial.ts : null,
          rendered: !error && dgmo.length > 0,
          error,
          diagnostics,
          dgmo,
        };
      });

    return {
      type,
      trials: trialList,
      rendered: trialList.filter((t) => t.rendered).length,
      failed: trialList.filter((t) => !t.rendered).length,
      withDiagnostics: trialList.filter((t) => t.diagnostics.length > 0).length,
    };
  });

  const covered = new Set(types);
  return {
    types: rows,
    // The coverage line is the point: a session that exercised two types out
    // of forty-six has not measured the guidance, whatever its trials say.
    knownTypeCount: knownTypes.length,
    uncovered: knownTypes.filter((t) => !covered.has(t)).sort(),
    totals: {
      types: rows.length,
      trials: rows.reduce((n, r) => n + r.trials.length, 0),
      rendered: rows.reduce((n, r) => n + r.rendered, 0),
      failed: rows.reduce((n, r) => n + r.failed, 0),
      withDiagnostics: rows.reduce((n, r) => n + r.withDiagnostics, 0),
    },
  };
}

const stamp = (ts) => (ts ? new Date(ts).toISOString() : 'no timestamp');

/** Render a summary as the committed markdown result file. */
export function renderMarkdown(summary, generatedAt) {
  const { totals, types, uncovered, knownTypeCount } = summary;
  const out = [];

  out.push(`# Guidance studio run — ${generatedAt.slice(0, 10)}`);
  out.push('');
  out.push(
    "Written by `pnpm studio:report` from the studio's `trial-runs.json`.",
    'The rendered PNG of each trial is deliberately not here — inline base64 is',
    'what keeps the scratch file out of git, and what kept every run before this',
    'one unreadable by anybody but the machine that made it.'
  );
  out.push('');
  out.push(`Generated: ${generatedAt}`);
  out.push('');
  out.push(
    `Coverage: **${totals.types} of ${knownTypeCount} chart types** carry a trial.`
  );
  out.push('');
  out.push(
    `Trials: ${totals.trials} · rendered ${totals.rendered} · failed ${totals.failed} · returned diagnostics ${totals.withDiagnostics}`
  );
  out.push('');
  out.push('| chart type | trials | rendered | failed | with diagnostics |');
  out.push('|---|---|---|---|---|');
  for (const row of types) {
    out.push(
      `| ${row.type} | ${row.trials.length} | ${row.rendered} | ${row.failed} | ${row.withDiagnostics} |`
    );
  }
  out.push('');

  if (uncovered.length > 0) {
    out.push(`## Not exercised (${uncovered.length})`);
    out.push('');
    out.push(uncovered.join(', '));
    out.push('');
  }

  for (const row of types) {
    out.push(`## ${row.type}`);
    out.push('');
    for (const trial of row.trials) {
      out.push(
        `### trial ${trial.idx} — ${trial.rendered ? 'rendered' : 'FAILED'} — ${stamp(trial.ts)}`
      );
      out.push('');
      if (trial.prompt) {
        out.push(`Prompt: ${trial.prompt}`);
        out.push('');
      }
      if (trial.error) {
        out.push(`Error: ${trial.error}`);
        out.push('');
      }
      if (trial.diagnostics.length > 0) {
        out.push('Diagnostics:');
        out.push('');
        for (const d of trial.diagnostics) out.push(`- ${d}`);
        out.push('');
      }
      if (trial.dgmo) {
        out.push('```dgmo');
        out.push(trial.dgmo);
        out.push('```');
        out.push('');
      }
    }
  }

  return (
    out
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trimEnd() + '\n'
  );
}

/** Chart-type ids the studio offers, from the registry it seeds itself with. */
function knownTypes() {
  try {
    const registry = JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'));
    return (registry.types ?? []).map((t) => t.id);
  } catch {
    return [];
  }
}

function main(argv) {
  const outFlag = argv.indexOf('--out');
  let raw;
  try {
    raw = readFileSync(TRIALS_PATH, 'utf8');
  } catch {
    console.error(
      `report: no trials at ${TRIALS_PATH} — run \`pnpm studio\` and save at least one trial first.`
    );
    return 1;
  }

  let trials;
  try {
    trials = JSON.parse(raw);
  } catch (err) {
    // The studio itself treats a corrupt store as empty so the UI survives.
    // A report must not: reporting zero runs off an unreadable file is the one
    // outcome a reader cannot tell from an honest one.
    console.error(`report: ${TRIALS_PATH} is not readable JSON — ${err}`);
    return 1;
  }

  const summary = summariseTrials(trials, knownTypes());
  if (summary.totals.trials === 0) {
    console.error(
      'report: the trial store holds no trials — nothing to report.'
    );
    return 1;
  }

  const generatedAt = new Date().toISOString();
  const target =
    outFlag >= 0 && argv[outFlag + 1]
      ? path.resolve(argv[outFlag + 1])
      : path.join(RESULTS_DIR, `${generatedAt.slice(0, 10)}.md`);

  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, renderMarkdown(summary, generatedAt));

  const { totals, knownTypeCount } = summary;
  console.log(
    `report: ${target}\n` +
      `  ${totals.types} of ${knownTypeCount} chart types covered, ` +
      `${totals.trials} trials — ${totals.rendered} rendered, ${totals.failed} failed, ` +
      `${totals.withDiagnostics} with diagnostics`
  );
  return 0;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(here, 'report.mjs')
) {
  process.exit(main(process.argv.slice(2)));
}
