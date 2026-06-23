// ============================================================
// suggest-format.test.ts — the "ask, don't guess" flow.
//
// formatSuggestions() is the enforcement point: when the scorer is confident
// (high/medium) it tells the caller to use the top match; when it is NOT
// confident (no trigger matched → fellBack, or top two equally plausible →
// ambiguous) it returns an "⚠️ ASK THE USER" directive instead of a pick.
// ============================================================

import { describe, it, expect } from 'vitest';
import { chartTypes } from '@diagrammo/dgmo';
import { formatSuggestions } from '../src/index';
import type { ChartTypeScore } from '../src/suggest/scoring';

const typeById = (id: string) => {
  const t = chartTypes.find((c) => c.id === id);
  if (!t) throw new Error(`test setup: no chart type "${id}"`);
  return t;
};

const cand = (id: string, score: number, matched: string[] = []): ChartTypeScore => ({
  type: typeById(id),
  score,
  matched,
  breakdown: { contig: score, idf: 0, desc: 0, prior: 0 },
});

describe('formatSuggestions — ask-the-user flow', () => {
  it('ambiguous: asks the user and does not pick a type', () => {
    const ranked = [cand('bar', 1.2, ['bar chart']), cand('line', 1.0, ['line chart'])];
    const out = formatSuggestions(ranked, false, 'ambiguous');

    expect(out).toContain('⚠️ ASK THE USER');
    expect(out).toMatch(/\[A\] bar/);
    expect(out).toMatch(/\[B\] line/);
    expect(out.toLowerCase()).toContain('wait for their choice');
    // Must NOT instruct to proceed with a single pick.
    expect(out).not.toContain('use the top match');
    expect(out).not.toContain('Top match:');
  });

  it('fellBack: asks the user from the general-purpose options', () => {
    // fellBack short-circuits before reading confidence; pass anything.
    const out = formatSuggestions([cand('pyramid', 0.5)], true, 'high');

    expect(out).toContain('⚠️ ASK THE USER');
    expect(out.toLowerCase()).toContain('no chart type clearly matches');
    expect(out.toLowerCase()).toContain('wait for the user to choose');
    // Lists the registry's fallback types as lettered options.
    const fallbacks = chartTypes.filter((c) => c.fallback);
    expect(fallbacks.length).toBeGreaterThan(0);
    for (const f of fallbacks) expect(out).toContain(f.id);
  });

  it('empty ranked also falls through to ask-the-user', () => {
    const out = formatSuggestions([], false, 'high');
    expect(out).toContain('⚠️ ASK THE USER');
  });

  it('high: proceeds with the top match, no ask directive', () => {
    const ranked = [cand('org', 200, ['org chart'])];
    const out = formatSuggestions(ranked, false, 'high');

    expect(out).not.toContain('ASK THE USER');
    expect(out).toContain('Confidence: high');
    expect(out).toContain('use the top match');
    expect(out).toContain('Top match: org');
  });

  it('medium: proceeds with the top match but flags the runner-up', () => {
    const ranked = [cand('bar', 2, ['bar chart']), cand('line', 1.2, ['line chart'])];
    const out = formatSuggestions(ranked, false, 'medium');

    expect(out).not.toContain('ASK THE USER');
    expect(out).toContain('Confidence: medium');
    expect(out.toLowerCase()).toContain('runner-up');
    expect(out).toContain('Top match: bar');
    expect(out).toContain('Secondary: line');
  });
});
