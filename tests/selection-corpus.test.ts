// ============================================================
// selection-corpus.test.ts — the prompt → chart-type REGRESSION GATE.
//
// Baseline-ratchet: the corpus (tests/fixtures/selection-corpus.json) carries a
// `baseline` top-1 pass-count; this test fails if accuracy drops below it. Known-
// failing cases live in the corpus as targets (they don't redden CI as long as
// the overall count holds), and the baseline is ratcheted UP as the selection
// harness (tools/selection-harness, `pnpm harness`) fixes them. Plus structural
// checks that catch corpus typos/renames, and a unit test of the harness's pure
// net-delta logic (diffRun).
// ============================================================

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chartTypes } from '@diagrammo/dgmo';
import { suggestChartTypes } from '../src/suggest/scoring';
import {
  accepts,
  sameSelectionGroup,
  SYNONYM_GROUPS,
} from '../src/suggest/synonyms';
import {
  diffRun,
  activeCases,
  type Corpus,
} from '../tools/selection-harness/diff-run';

const here = path.dirname(fileURLToPath(import.meta.url));
const corpus = JSON.parse(
  readFileSync(path.join(here, 'fixtures/selection-corpus.json'), 'utf8')
) as Corpus;

const validIds = new Set(chartTypes.map((c) => c.id));

/** Installed @diagrammo/dgmo version (its package.json subpath isn't exported,
 *  so read it off disk; fall back to 'unknown' if the layout changes). */
function installedDgmoVersion(): string {
  try {
    const pkg = path.join(here, '../node_modules/@diagrammo/dgmo/package.json');
    return (JSON.parse(readFileSync(pkg, 'utf8')) as { version: string })
      .version;
  } catch {
    return 'unknown';
  }
}

function top1(prompt: string): string | undefined {
  return suggestChartTypes(prompt).ranked[0]?.type.id;
}

describe('selection corpus — structural integrity', () => {
  it('is non-empty', () => {
    expect(corpus.cases.length).toBeGreaterThan(0);
  });

  it('every accept id is a real chart-type id (catches typos/renames)', () => {
    const bad = corpus.cases.flatMap((c) =>
      c.accept
        .filter((id) => !validIds.has(id))
        .map((id) => `"${id}" (prompt: "${c.prompt}")`)
    );
    expect(bad, `unknown accept ids: ${bad.join(', ')}`).toEqual([]);
  });
});

describe('selection accuracy — baseline ratchet', () => {
  it(`top-1 pass-count is >= committed baseline (${corpus.baseline})`, () => {
    // A baseline above the active-case count is unsatisfiable (e.g. a passing
    // case was parked without decrementing it) — catch that explicitly rather
    // than reporting a confusing accuracy miss.
    const activeN = activeCases(corpus).length;
    expect(
      corpus.baseline,
      `baseline ${corpus.baseline} exceeds active cases ${activeN} — re-baseline (a passing case was likely parked)`
    ).toBeLessThanOrEqual(activeN);

    // Surface a dgmo-version drift hint: the pass-count is coupled to the
    // installed @diagrammo/dgmo, so a bump that adds/renames a type or shifts a
    // description can move scores. If this fails right after a dgmo bump,
    // re-evaluate accuracy and re-commit `baseline` + `dgmoVersion`.
    const installed = installedDgmoVersion();

    // Parked (won't-fix) cases are excluded — the baseline measures only what
    // we're actively trying to land. Parked cases stay in the corpus as
    // documented known-limitations (still id-validated below).
    const active = activeCases(corpus);
    const parked = corpus.cases.length - active.length;
    const failing = active.filter((c) => !accepts(c.accept, top1(c.prompt)));
    const passCount = active.length - failing.length;

    const detail =
      `top-1 ${passCount}/${active.length} active (${parked} parked, baseline ${corpus.baseline}); ` +
      `dgmo installed ${installed}, baseline measured against ${corpus.dgmoVersion}. ` +
      (installed !== corpus.dgmoVersion
        ? `dgmo version changed — if this dropped, re-baseline. `
        : '') +
      `failing: ${failing.map((c) => `"${c.prompt}"→${c.accept.join('/')}`).join('; ')}`;

    expect(passCount, detail).toBeGreaterThanOrEqual(corpus.baseline);
  });

  // ADVISORY (never gated): the "primary hit-rate" — how often the shipped
  // scorer lands the CANONICAL answer (accept[0]), not merely an acceptable one.
  // Membership-based pass-count can mask quality drift (the scorer picks an
  // acceptable-but-worse type); this surfaces it. Reported via console; the only
  // assertion is the trivially-true invariant so the line always prints in CI.
  it('reports primary (canonical accept[0]) hit-rate — advisory, not gated', () => {
    const active = activeCases(corpus);
    // Synonym-aware: landing a sibling of the canonical (arc≈chord) counts as
    // primary — within-group differences aren't a miss.
    const primaryHits = active.filter((c) => {
      const got = top1(c.prompt);
      return !!got && sameSelectionGroup(c.accept[0], got);
    }).length;
    const pct = ((primaryHits / active.length) * 100).toFixed(1);
     
    console.log(
      `[advisory] primary hit-rate ${primaryHits}/${active.length} (${pct}%) — ` +
        `scorer landed the canonical accept[0]. Membership pass-count is the gate; ` +
        `this is quality signal only.`
    );
    expect(primaryHits).toBeGreaterThanOrEqual(0);
  });
});

describe('diffRun — net-delta logic (AC11)', () => {
  it('reports exactly the case it fixes and the case it regresses', () => {
    // Nonsense tokens so only the explicit phrase map can produce a match;
    // no description/IDF overlap muddies the result.
    const tiny: Corpus = {
      baseline: 0,
      dgmoVersion: 'test',
      cases: [
        { prompt: 'zzz', accept: ['org'] },
        { prompt: 'qqq', accept: ['state'] },
      ],
    };
    const mapA = { org: ['zzz'], state: ['xxx'] }; // zzz passes, qqq fails
    const mapB = { org: ['xxx'], state: ['qqq'] }; // zzz fails (regressed), qqq passes (fixed)

    expect(diffRun({ map: mapA }, { map: mapB }, tiny)).toEqual({
      fixed: ['qqq'],
      regressed: ['zzz'],
    });
  });

  it('a prior change alone (same phrases) registers as a net-delta', () => {
    // Both types fire on the same prompt via identical phrases; the prior breaks
    // the tie. Flipping which type carries the prior flips the winner.
    const tiny: Corpus = {
      baseline: 0,
      dgmoVersion: 'test',
      cases: [{ prompt: 'zzz', accept: ['org'] }],
    };
    const map = { org: ['zzz'], state: ['zzz'] };
    const a = { map, priors: { state: 5 } }; // state wins → org fails
    const b = { map, priors: { org: 5 } }; // org wins → org passes
    expect(diffRun(a, b, tiny)).toEqual({ fixed: ['zzz'], regressed: [] });
  });
});

describe('synonym groups — opinionated equivalence', () => {
  it('treats within-group types as interchangeable, across-group as distinct', () => {
    expect(sameSelectionGroup('arc', 'chord')).toBe(true);
    expect(sameSelectionGroup('arc', 'arc')).toBe(true);
    expect(sameSelectionGroup('arc', 'sankey')).toBe(false); // distinct flow chart
    expect(sameSelectionGroup('arc', 'pie')).toBe(false);
    expect(sameSelectionGroup('pie', 'ring')).toBe(false); // ring is a distinct chart
    expect(sameSelectionGroup('pie', 'bar')).toBe(false);
  });

  it('accepts a pick that is a synonym of any listed accept id', () => {
    expect(accepts(['arc'], 'chord')).toBe(true); // honor the policy
    expect(accepts(['chord'], 'arc')).toBe(true);
    expect(accepts(['bar'], 'chord')).toBe(false);
    expect(accepts(['arc'], undefined)).toBe(false);
  });

  it('every synonym-group id is a real chart type', () => {
    // imported lazily to keep the group list as the single source of truth
    const bad = SYNONYM_GROUPS.flat().filter((id) => !validIds.has(id));
    expect(bad, `unknown synonym ids: ${bad.join(', ')}`).toEqual([]);
  });
});

describe('packaging invariant — harness is dev-only (AC10)', () => {
  const root = path.join(here, '..');
  const pkg = JSON.parse(
    readFileSync(path.join(root, 'package.json'), 'utf8')
  ) as {
    files: string[];
  };

  it('published `files` does not include tools/ (the file-writing dev server must not ship)', () => {
    expect(pkg.files).toEqual(['dist']);
    expect(pkg.files.some((f) => f.includes('tools'))).toBe(false);
  });

  it('the server entry never imports the harness', () => {
    const index = readFileSync(path.join(root, 'src/index.ts'), 'utf8');
    expect(index).not.toMatch(/selection-harness|tools\//);
  });
});
