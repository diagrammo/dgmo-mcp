// ============================================================
// report.mjs — turn a guidance-studio session into a committed result file.
//
// The studio's only output is `trial-runs.json`, and that file is gitignored
// (.gitignore:16) because every trial carries its rendered PNG inline as
// base64 — a two-chart-type session came to 404 KB. So a run survived a
// refresh on the machine that made it and reached nobody else, which is why
// the instrument has been repaired four times and read never (#847).
//
// This writes the same session out WITHOUT the images: a markdown file under
// `results/`, carrying the verdict per trial, the diagnostics the pipeline
// returned, the DGMO the model actually produced, and — the headline the
// studio never stated — how many chart types the session covered at all.
//
// Run: node tools/guidance-studio/report.mjs   (or `pnpm studio:report`)
//      node tools/guidance-studio/report.mjs --out <path>
//
// 🔴 It refuses rather than report a number it cannot stand behind: an empty
// session, an unreadable trial store, and an unreadable registry all exit 1.
// A result file saying "0 trials" cannot be told from a run nobody made, and
// "2 of 0 chart types" reads as a coverage measurement while being the
// registry's absence. Being trustworthy is the whole point of a file somebody
// else reads.
//
// 🔴 The file is DATED BY ITS TRIALS, never by when this script ran. The stale
// 404 KB store #847 describes is three months old and two types wide, and the
// decision on that row says in as many words that it must not be mistaken for
// a baseline — which a report titled with today's date is exactly how to do.
//
// 🔴 Nothing stored is echoed unbounded, and nothing stored can open a fence.
// A failed `claude -p` is persisted as `claude failed: Command failed: claude
// -p <the entire resolved prompt>`, so the FAILURE path was re-introducing the
// 12 KB prompt echo this file exists to leave out — with the literal ```dgmo
// the studio tells the model it may use, which inverted every fence after it.
// Prompts, errors and diagnostics are capped and indented; the DGMO keeps its
// bytes and gets a fence sized to hold them.
//
// 🔴 `results/` is in .prettierignore. `format:check` is the first step of
// `check:all`, prettier pads markdown table cells, and this generator does
// not — so without the ignore, committing the file this script exists to
// produce turns the gate red, and `pnpm format` un-does the next run.
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
  const types = Object.keys(trials ?? {})
    .filter((t) => Object.keys(trials[t] ?? {}).length > 0)
    .sort();

  const stamps = [];
  const rows = types.map((type) => {
    const byIdx = trials[type] ?? {};
    const trialList = Object.keys(byIdx)
      .sort((a, b) => Number(a) - Number(b))
      .map((idx) => {
        const trial = byIdx[idx] ?? {};
        const result = trial.result ?? {};
        // A trial RENDERED when the pipeline returned no error and some DGMO
        // came back. `svg`/`pngBase64` are deliberately not consulted — they
        // are the fields this report exists to leave behind.
        const error = result.error ? String(result.error) : null;
        const dgmo = typeof result.dgmo === 'string' ? result.dgmo.trim() : '';
        // 🔴 `line` and `severity` are kept, not flattened to the message.
        // A diagnostic that names a line is the only way a reader can point
        // at the offending line of the DGMO printed below it.
        const diagnostics = Array.isArray(result.diagnostics)
          ? result.diagnostics.map((d) =>
              typeof d === 'string'
                ? { message: d, line: null, severity: null }
                : {
                    message: String(d?.message ?? JSON.stringify(d)),
                    line: typeof d?.line === 'number' ? d.line : null,
                    severity:
                      typeof d?.severity === 'string' ? d.severity : null,
                  }
            )
          : [];
        const ts = typeof trial.ts === 'number' ? trial.ts : null;
        if (ts !== null) stamps.push(ts);
        return {
          idx: Number(idx),
          prompt: typeof trial.prompt === 'string' ? trial.prompt : '',
          ts,
          verdict: verdictFor(!error && dgmo.length > 0, diagnostics),
          error,
          diagnostics,
          dgmo,
        };
      });

    return {
      type,
      trials: trialList,
      rendered: trialList.filter((t) => t.verdict === 'rendered').length,
      withWarnings: trialList.filter(
        (t) => t.verdict === 'rendered-with-warnings'
      ).length,
      failed: trialList.filter((t) => t.verdict === 'failed').length,
      withDiagnostics: trialList.filter((t) => t.diagnostics.length > 0).length,
    };
  });

  const covered = new Set(types);
  const known = new Set(knownTypes);
  return {
    types: rows,
    // The coverage line is the point: a session that exercised two types out
    // of forty-six has not measured the guidance, whatever its trials say.
    //
    // 🔴 The numerator counts only types the registry still lists. A store is
    // cumulative and the registry is not — `live-link` was in it and is now
    // excluded (`NOT_AUTHORED`, dump-registry.mjs), and a rename does the
    // same — so counting session types against the registry total produced a
    // fraction whose parts did not add up: 2 of 4, above `Not exercised (3)`.
    knownTypeCount: knownTypes.length,
    coveredKnownCount: types.filter((t) => known.has(t)).length,
    uncovered: knownTypes.filter((t) => !covered.has(t)).sort(),
    unknownTypes: types.filter((t) => !known.has(t)).sort(),
    // When the trials ran, which is not when this file was written.
    ran: stamps.length
      ? { from: Math.min(...stamps), to: Math.max(...stamps) }
      : null,
    totals: {
      types: rows.length,
      trials: rows.reduce((n, r) => n + r.trials.length, 0),
      rendered: rows.reduce((n, r) => n + r.rendered, 0),
      withWarnings: rows.reduce((n, r) => n + r.withWarnings, 0),
      failed: rows.reduce((n, r) => n + r.failed, 0),
      withDiagnostics: rows.reduce((n, r) => n + r.withDiagnostics, 0),
    },
  };
}

/**
 * A trial's verdict: `failed`, `rendered-with-warnings`, or `rendered`.
 *
 * 🔴 A render that came back with diagnostics is NOT a plain `rendered`. The
 * pipeline refuses only on an error-severity diagnostic, so everything on a
 * trial that rendered is a warning the model's output tripped — and a warning
 * can mean its intent was dropped. The 2026-09-24 probe's sequence trial is
 * the case: `Web App z: Customer` was rejected as an unexpected line, half the
 * participants lost their colour tag, and the report still said `rendered`
 * (#847). Only a render with no diagnostics at all is clean.
 */
function verdictFor(rendered, diagnostics) {
  if (!rendered) return 'failed';
  return diagnostics.length > 0 ? 'rendered-with-warnings' : 'rendered';
}

const stamp = (ts) => (ts ? new Date(ts).toISOString() : 'no timestamp');

/** How long a stored prompt, error or diagnostic may run in the report. */
const TEXT_CAP = 600;

/**
 * Render untrusted stored text as an INDENTED code block.
 *
 * 🔴 Two hazards, and the indent answers both. A failed `claude -p` is stored
 * by save-plugin.ts as `claude failed: Command failed: claude -p <the entire
 * resolved prompt>\n<stderr>` — so the failure path re-introduced the 12 KB
 * prompt echo this file exists to leave out, and that prompt contains the
 * literal ```dgmo the studio tells the model it may use, which opened a fence
 * and inverted every fence in the rest of the document. An indented block
 * cannot be opened or closed by backticks, and the cap bounds the blob.
 */
function quoted(text) {
  const clipped =
    text.length > TEXT_CAP
      ? `${text.slice(0, TEXT_CAP)}… [truncated, ${text.length} characters]`
      : text;
  return clipped.split('\n').map((line) => `    ${line}`);
}

/**
 * A fence long enough to hold this content. The model is told a ```dgmo fence
 * is acceptable, so its answer can carry one; three backticks would end the
 * block early and spill DGMO into the document as prose.
 */
function fenceFor(text) {
  const longest = (text.match(/`+/g) ?? []).reduce(
    (n, run) => Math.max(n, run.length),
    0
  );
  return '`'.repeat(Math.max(3, longest + 1));
}

/** The date this session was RUN, for the title and the filename. */
export function sessionDate(summary, generatedAt) {
  return summary.ran
    ? new Date(summary.ran.to).toISOString().slice(0, 10)
    : generatedAt.slice(0, 10);
}

/** Render a summary as the committed markdown result file. */
export function renderMarkdown(summary, generatedAt) {
  const { totals, types, uncovered, knownTypeCount, ran } = summary;
  const out = [];
  // 🔴 Blank lines are managed here rather than by collapsing the finished
  // document. A `\n{3,}` pass over the whole string reaches inside the ```dgmo
  // fences and silently renumbers the model's own output, which is the one
  // thing in this file that has to be verbatim.
  const blank = () => {
    if (out.length && out[out.length - 1] !== '') out.push('');
  };

  out.push(`# Guidance studio run — ${sessionDate(summary, generatedAt)}`);
  blank();
  out.push(
    "Written by `pnpm studio:report` from the studio's `trial-runs.json`.",
    'The rendered PNG of each trial is deliberately not here — inline base64 is',
    'what keeps the scratch file out of git, and what kept every run before this',
    'one unreadable by anybody but the machine that made it.'
  );
  blank();
  out.push(
    ran
      ? `Trials ran: ${stamp(ran.from)} to ${stamp(ran.to)} · report written ${generatedAt}`
      : `Trials ran: no trial carries a timestamp · report written ${generatedAt}`
  );
  blank();
  out.push(
    knownTypeCount > 0
      ? `Coverage: **${summary.coveredKnownCount} of ${knownTypeCount} chart types** carry a trial.`
      : `Coverage: ${totals.types} chart types carry a trial; the studio registry was unreadable, so the total is unknown.`
  );
  blank();
  out.push(
    `Trials: ${totals.trials} · rendered ${totals.rendered} · rendered with warnings ${totals.withWarnings} · failed ${totals.failed} · returned diagnostics ${totals.withDiagnostics}`
  );
  blank();
  out.push(
    '| chart type | trials | rendered | rendered with warnings | failed | with diagnostics |'
  );
  out.push('|---|---|---|---|---|---|');
  for (const row of types) {
    out.push(
      `| ${row.type} | ${row.trials.length} | ${row.rendered} | ${row.withWarnings} | ${row.failed} | ${row.withDiagnostics} |`
    );
  }
  blank();

  if (uncovered.length > 0) {
    out.push(`## Not exercised (${uncovered.length})`);
    blank();
    out.push(uncovered.join(', '));
    blank();
  }

  // Trials the registry no longer lists. They are real trials and they keep
  // their section below; they are simply not part of the coverage fraction,
  // and a reader who adds the two counts up has to be told why.
  if (summary.unknownTypes.length > 0) {
    out.push(`## No longer in the registry (${summary.unknownTypes.length})`);
    blank();
    out.push(
      `${summary.unknownTypes.join(', ')} — trialled, but not a chart type the studio offers today, so outside the coverage count above.`
    );
    blank();
  }

  for (const row of types) {
    out.push(`## ${row.type}`);
    blank();
    for (const trial of row.trials) {
      out.push(
        `### trial ${trial.idx} — ${trial.verdict === 'failed' ? 'FAILED' : trial.verdict} — ${stamp(trial.ts)}`
      );
      blank();
      if (trial.prompt) {
        out.push('Prompt:');
        blank();
        out.push(...quoted(trial.prompt));
        blank();
      }
      if (trial.error) {
        out.push('Error:');
        blank();
        out.push(...quoted(trial.error));
        blank();
      }
      if (trial.diagnostics.length > 0) {
        out.push('Diagnostics:');
        blank();
        for (const d of trial.diagnostics) {
          const where = d.line !== null ? `line ${d.line}: ` : '';
          const how = d.severity ? `[${d.severity}] ` : '';
          out.push(...quoted(`${how}${where}${d.message}`));
        }
        blank();
      }
      if (trial.dgmo) {
        // Verbatim, fence to fence. Nothing below reformats this, and the
        // fence is sized to the content so the model's own backticks cannot
        // close it early.
        const fence = fenceFor(trial.dgmo);
        out.push(`${fence}dgmo`);
        out.push(trial.dgmo);
        out.push(fence);
        blank();
      }
    }
  }

  return out.join('\n').trimEnd() + '\n';
}

/**
 * Chart-type ids the studio offers, from the registry it seeds itself with,
 * or `null` when it could not be read.
 *
 * 🔴 Absence is not emptiness. `dump-registry.mjs` rewrites this file with a
 * bare `writeFileSync` on every `pnpm studio`, so a report taken while the
 * studio is launching can read a half-written one — and an empty list would
 * turn the coverage headline into "2 of 0" without anything saying so.
 */
function knownTypes(registryPath) {
  try {
    const registry = JSON.parse(readFileSync(registryPath, 'utf8'));
    const ids = (registry.types ?? []).map((t) => t.id);
    return ids.length > 0 ? ids : null;
  } catch {
    return null;
  }
}

/**
 * The command. `paths` exists so the test can drive the whole thing against a
 * scratch directory: the real trial store is a developer's own session and a
 * test that wrote to it would destroy the thing this script reports on.
 */
export function main(argv, paths = {}) {
  const trialsPath = paths.trialsPath ?? TRIALS_PATH;
  const registryPath = paths.registryPath ?? REGISTRY_PATH;
  const resultsDir = paths.resultsDir ?? RESULTS_DIR;
  const outFlag = argv.indexOf('--out');
  let raw;
  try {
    raw = readFileSync(trialsPath, 'utf8');
  } catch {
    console.error(
      `report: no trials at ${trialsPath} — run \`pnpm studio\` and save at least one trial first.`
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
    console.error(`report: ${trialsPath} is not readable JSON — ${err}`);
    return 1;
  }
  if (trials === null || typeof trials !== 'object' || Array.isArray(trials)) {
    console.error(
      `report: ${trialsPath} is not a trial store — ${raw.slice(0, 40)}`
    );
    return 1;
  }

  const known = knownTypes(registryPath);
  if (known === null) {
    console.error(
      `report: ${registryPath} could not be read — the coverage number would be meaningless. Run \`node tools/guidance-studio/dump-registry.mjs\` first.`
    );
    return 1;
  }

  const summary = summariseTrials(trials, known);
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
      : path.join(resultsDir, `${sessionDate(summary, generatedAt)}.md`);

  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, renderMarkdown(summary, generatedAt));

  const { totals, knownTypeCount, coveredKnownCount } = summary;
  console.log(
    `report: ${target}\n` +
      `  ${coveredKnownCount} of ${knownTypeCount} chart types covered, ` +
      `${totals.trials} trial${totals.trials === 1 ? '' : 's'} — ${totals.rendered} rendered, ` +
      `${totals.withWarnings} rendered with warnings, ${totals.failed} failed, ` +
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
