// ============================================================
// guidance-report.test.ts — the studio's run report must be committable,
// verbatim, and honest about what it does not know.
//
// `trial-runs.json` is gitignored because each trial carries its rendered PNG
// inline as base64 (.gitignore:16). `report.mjs` exists to write the same
// session out without them, so the first thing locked here is that no image
// survives the trip — a report that leaked one would be gitignored for the
// same reason the scratch file is, and #847 would be back where it started.
//
// The rest are the three ways a shareable file can still mislead: a coverage
// headline computed off a registry that could not be read, a title dated by
// when the report was written rather than when the trials ran, and a fenced
// block of the model's own DGMO that has been reflowed on the way out.
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  summariseTrials,
  renderMarkdown,
  sessionDate,
  main,
} from '../tools/guidance-studio/report.mjs';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQ';
const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';
const JUNE = 1_750_000_000_000; // 2025-06-15T15:06:40Z
const NOW = '2026-09-20T22:00:00.000Z';

const trials = {
  sequence: {
    '1': {
      prompt: 'a checkout flow',
      sig: 'x',
      ts: JUNE,
      result: {
        dgmo: 'sequence\n  a -> b: hi',
        svg: SVG,
        pngBase64: PNG,
        resolvedPrompt: 'the whole 12 KB prompt the model was sent',
        injectedTips: '**Styling tips:** keep it short',
        diagnostics: [{ message: 'unknown participant "c"', line: 2 }],
        error: null,
      },
    },
    '0': {
      prompt: 'a login handshake',
      sig: 'y',
      ts: JUNE + 100_000,
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
      ts: JUNE + 200_000,
      result: {
        dgmo: 'infra\n  web -> db',
        svg: SVG,
        pngBase64: PNG,
        diagnostics: [
          {
            message: 'colour "#ff0000" is not in the palette',
            severity: 'warn',
          },
        ],
        error: null,
      },
    },
  },
};

const KNOWN = ['bar', 'infra', 'sequence', 'timeline'];
const md = () => renderMarkdown(summariseTrials(trials, KNOWN), NOW);

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
    const out = md();
    expect(out).not.toContain(PNG);
    expect(out).not.toContain(SVG);
    expect(out).not.toContain('pngBase64');
    // The resolved prompt is the studio's own 12 KB construction, not a fact
    // about the run; the user's prompt is what a reader needs.
    expect(out).not.toContain('the whole 12 KB prompt');
    expect(out).toContain('a checkout flow');
  });

  it('states the coverage, the verdicts and the diagnostics with their lines', () => {
    const out = md();
    expect(out).toContain('**2 of 4 chart types**');
    expect(out).toContain('| sequence | 2 | 1 | 1 | 1 |');
    expect(out).toContain('## Not exercised (2)');
    expect(out).toContain('parse failed at line 2');
    expect(out).toContain('- line 2: unknown participant "c"');
    expect(out).toContain('- [warn] colour "#ff0000" is not in the palette');
    expect(out.endsWith('\n')).toBe(true);
  });

  it('dates itself by the trials, not by when the report was written', () => {
    // The store #847 describes is three months old. A file whose title says
    // today is how a stale session becomes somebody's baseline.
    const s = summariseTrials(trials, KNOWN);
    expect(sessionDate(s, NOW)).toBe('2025-06-15');
    const out = renderMarkdown(s, NOW);
    expect(out).toContain('# Guidance studio run — 2025-06-15');
    expect(out).toContain('Trials ran: 2025-06-15T15:06:40.000Z');
    expect(out).toContain(`report written ${NOW}`);
  });

  it('reproduces the model’s DGMO byte for byte, blank lines included', () => {
    const spaced = {
      bar: {
        '0': {
          prompt: 'p',
          ts: JUNE,
          result: {
            dgmo: 'bar\n  a: 1\n\n\n  b: 2',
            diagnostics: [],
            error: null,
          },
        },
      },
    };
    const out = renderMarkdown(summariseTrials(spaced, KNOWN), NOW);
    expect(out).toContain('```dgmo\nbar\n  a: 1\n\n\n  b: 2\n```');
  });

  it('says the total is unknown rather than printing "of 0"', () => {
    const out = renderMarkdown(summariseTrials(trials, []), NOW);
    expect(out).not.toContain('of 0 chart types');
    expect(out).toContain('the studio registry was unreadable');
  });

  it('survives a store whose trials are missing the fields it reads', () => {
    const s = summariseTrials({ bar: { '0': {} }, empty: {} }, KNOWN);
    expect(s.totals.types).toBe(1);
    expect(s.totals.failed).toBe(1);
    expect(s.ran).toBeNull();
    expect(sessionDate(s, NOW)).toBe('2026-09-20');
    expect(() => renderMarkdown(s, NOW)).not.toThrow();
  });
});

describe('the studio:report command', () => {
  let dir: string;
  const paths = () => ({
    trialsPath: path.join(dir, 'trial-runs.json'),
    registryPath: path.join(dir, 'registry.json'),
    resultsDir: path.join(dir, 'results'),
  });

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'studio-report-'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  const seedRegistry = () =>
    writeFileSync(
      paths().registryPath,
      JSON.stringify({ types: KNOWN.map((id) => ({ id })) })
    );

  it('writes the result file named for the day the trials ran', () => {
    seedRegistry();
    writeFileSync(paths().trialsPath, JSON.stringify(trials));
    expect(main([], paths())).toBe(0);
    const written = readFileSync(
      path.join(dir, 'results', '2025-06-15.md'),
      'utf8'
    );
    expect(written).toContain('**2 of 4 chart types**');
    expect(written).not.toContain(PNG);
  });

  it('refuses a session with no trials rather than reporting zero', () => {
    seedRegistry();
    writeFileSync(paths().trialsPath, '{}');
    expect(main([], paths())).toBe(1);
  });

  it('refuses a trial store that is not readable JSON', () => {
    seedRegistry();
    writeFileSync(paths().trialsPath, 'not json');
    expect(main([], paths())).toBe(1);
  });

  it('refuses a trial store that is not an object', () => {
    seedRegistry();
    writeFileSync(paths().trialsPath, '[]');
    expect(main([], paths())).toBe(1);
  });

  it('refuses when the registry cannot be read, rather than reporting "of 0"', () => {
    // `dump-registry.mjs` rewrites the registry with a bare writeFileSync on
    // every `pnpm studio`, so a half-written one is reachable.
    writeFileSync(paths().registryPath, '{"types":');
    writeFileSync(paths().trialsPath, JSON.stringify(trials));
    expect(main([], paths())).toBe(1);
  });

  it('refuses when there is no trial store at all', () => {
    seedRegistry();
    expect(main([], paths())).toBe(1);
  });

  it('honours --out', () => {
    seedRegistry();
    writeFileSync(paths().trialsPath, JSON.stringify(trials));
    const target = path.join(dir, 'elsewhere', 'run.md');
    expect(main(['--out', target], paths())).toBe(0);
    expect(readFileSync(target, 'utf8')).toContain('Guidance studio run');
  });
});
