// ============================================================
// guidance-report.test.ts — the studio's run report must be committable.
//
// `trial-runs.json` is gitignored because each trial carries its rendered PNG
// inline as base64 (.gitignore:16). `report.mjs` exists to write the same
// session out without them, so the first thing locked here is that no image
// survives the trip — a report that leaked one would be gitignored for the
// same reason the scratch file is, and #847 would be back where it started.
//
// The second is the coverage line. A session that exercised two chart types
// out of forty-six has not measured the guidance, and the studio has never
// said so out loud.
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  summariseTrials,
  renderMarkdown,
} from '../tools/guidance-studio/report.mjs';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQ';
const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';

const trials = {
  sequence: {
    '1': {
      prompt: 'a checkout flow',
      sig: 'x',
      ts: 1_750_000_000_000,
      result: {
        dgmo: 'sequence\n  a -> b: hi',
        svg: SVG,
        pngBase64: PNG,
        resolvedPrompt: 'the whole 12 KB prompt the model was sent',
        injectedTips: '**Styling tips:** keep it short',
        diagnostics: [{ message: 'unknown participant "c"' }],
        error: null,
      },
    },
    '0': {
      prompt: 'a login handshake',
      sig: 'y',
      ts: 1_750_000_100_000,
      result: {
        dgmo: '',
        svg: null,
        pngBase64: null,
        diagnostics: [],
        error: 'parse failed at line 2',
      },
    },
  },
  infra: {
    '0': {
      prompt: 'a three-tier app',
      sig: 'z',
      ts: 1_750_000_200_000,
      result: {
        dgmo: 'infra\n  web -> db',
        svg: SVG,
        pngBase64: PNG,
        diagnostics: ['colour "#ff0000" is not in the palette'],
        error: null,
      },
    },
  },
};

const KNOWN = ['bar', 'infra', 'sequence', 'timeline'];

describe('guidance studio run report', () => {
  it('counts a trial as failed when the pipeline errored or produced no DGMO', () => {
    const s = summariseTrials(trials, KNOWN);
    expect(s.totals).toEqual({
      types: 2,
      trials: 3,
      rendered: 2,
      failed: 1,
      withDiagnostics: 2,
    });
    const sequence = s.types.filter((t) => t.type === 'sequence')[0];
    expect(sequence.rendered).toBe(1);
    expect(sequence.failed).toBe(1);
  });

  it('names the chart types the session never exercised', () => {
    const s = summariseTrials(trials, KNOWN);
    expect(s.knownTypeCount).toBe(4);
    expect(s.uncovered).toEqual(['bar', 'timeline']);
  });

  it('orders types alphabetically and trials by index, whatever the store did', () => {
    const s = summariseTrials(trials, KNOWN);
    expect(s.types.map((t) => t.type)).toEqual(['infra', 'sequence']);
    const sequence = s.types.filter((t) => t.type === 'sequence')[0];
    expect(sequence.trials.map((t) => t.idx)).toEqual([0, 1]);
  });

  it('carries no image and no prompt echo into the committed file', () => {
    const md = renderMarkdown(
      summariseTrials(trials, KNOWN),
      '2026-09-20T22:00:00.000Z'
    );
    expect(md).not.toContain(PNG);
    expect(md).not.toContain(SVG);
    expect(md).not.toContain('pngBase64');
    // The resolved prompt is the studio's own 12 KB construction, not a fact
    // about the run; the user's prompt is what a reader needs.
    expect(md).not.toContain('the whole 12 KB prompt');
    expect(md).toContain('a checkout flow');
  });

  it('states the coverage, the verdicts and the DGMO the model produced', () => {
    const md = renderMarkdown(
      summariseTrials(trials, KNOWN),
      '2026-09-20T22:00:00.000Z'
    );
    expect(md).toContain('**2 of 4 chart types**');
    expect(md).toContain('| sequence | 2 | 1 | 1 | 1 |');
    expect(md).toContain('## Not exercised (2)');
    expect(md).toContain('parse failed at line 2');
    expect(md).toContain('unknown participant "c"');
    expect(md).toContain('sequence\n  a -> b: hi');
    expect(md.endsWith('\n')).toBe(true);
  });

  it('survives a store whose trials are missing the fields it reads', () => {
    const s = summariseTrials({ bar: { '0': {} }, empty: {} }, KNOWN);
    expect(s.totals.types).toBe(1);
    expect(s.totals.failed).toBe(1);
    expect(() => renderMarkdown(s, '2026-09-20T22:00:00.000Z')).not.toThrow();
  });
});
