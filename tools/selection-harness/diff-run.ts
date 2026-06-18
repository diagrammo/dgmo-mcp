// Pure, dependency-light scoring delta — shared by the harness UI (browser)
// and the regression gate (node/vitest, see tests/selection-corpus.test.ts).
// Kept free of DOM/node APIs so it type-checks under the strict tsconfig when
// the test imports it, and bundles cleanly in the browser. The only import is
// the (browser-aliasable) scorer.

import {
  createSuggester,
  type TriggerMap,
  type PriorMap,
} from '../../src/suggest/scoring.js';

/** A scorer's full tunable state: the phrase vocabulary + popularity priors.
 *  Net-delta compares two of these, so a prior change registers as an edit
 *  exactly like a phrase change. `priors` optional (absent = no bias). */
export interface SuggesterState {
  readonly map: TriggerMap;
  readonly priors?: PriorMap;
}

export interface CorpusCase {
  readonly prompt: string;
  readonly accept: readonly string[];
  /** Parked: a prompt we've decided not to solve as worded (too ambiguous /
   *  good-enough). Excluded from the active pass-count, baseline, and net-delta;
   *  kept in the corpus as a documented known-limitation. */
  readonly wontfix?: boolean;
  /** Optional reason for parking (shown in the harness, kept in the corpus). */
  readonly note?: string;
}

/** Cases we're actively trying to land (everything not parked). */
export function activeCases(corpus: Corpus): readonly CorpusCase[] {
  return corpus.cases.filter((c) => !c.wontfix);
}

export interface Corpus {
  readonly baseline: number;
  readonly dgmoVersion: string;
  readonly cases: readonly CorpusCase[];
}

/** The ACTIVE prompts whose top-1 suggestion lands in `accept`, scored against
 *  `state` (phrases + priors). Parked (won't-fix) cases are ignored. */
export function passingPrompts(
  state: SuggesterState,
  corpus: Corpus
): Set<string> {
  const suggester = createSuggester(state.map, state.priors);
  const pass = new Set<string>();
  for (const c of activeCases(corpus)) {
    const top1 = suggester.suggestChartTypes(c.prompt).ranked[0]?.type.id;
    if (top1 && c.accept.includes(top1)) pass.add(c.prompt);
  }
  return pass;
}

export interface DiffResult {
  readonly fixed: string[];
  readonly regressed: string[];
}

/**
 * The net effect of swapping scorer state `a` → `b` (phrases AND/OR priors) over
 * `corpus`: `fixed` = cases that started failing and now pass; `regressed` = the
 * reverse. This is the anti-whack-a-mole guard — every edit (phrase or prior) is
 * judged on its delta, not just whether it fixed the case you were looking at.
 */
export function diffRun(
  a: SuggesterState,
  b: SuggesterState,
  corpus: Corpus
): DiffResult {
  const before = passingPrompts(a, corpus);
  const after = passingPrompts(b, corpus);
  const fixed: string[] = [];
  const regressed: string[] = [];
  for (const c of activeCases(corpus)) {
    const was = before.has(c.prompt);
    const now = after.has(c.prompt);
    if (!was && now) fixed.push(c.prompt);
    else if (was && !now) regressed.push(c.prompt);
  }
  return { fixed, regressed };
}
