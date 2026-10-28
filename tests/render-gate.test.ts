// ============================================================
// render-gate.test.ts — the hard color gate behind every output tool.
//
// renderPipeline() is the single parse→render path under render_diagram,
// preview_diagram, share_diagram and generate_report. It must REFUSE any
// diagram whose colors aren't one of the 11 named palette colors — both hex
// (an `error` in the library) and CSS color names like `crimson` (a `warning`
// in the library, blocked here via the E_INVALID_COLOR code) — so an authoring
// LLM is forced to correct rather than silently getting an auto-color fallback.
// ============================================================

import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderPipeline, inputSizeError } from '../src/render-helpers.js';
import { assetRoots } from '../src/asset-roots.js';

const opts = { theme: 'light' as const, palette: 'slate' };

describe('color hard-gate in renderPipeline', () => {
  it('blocks hex colors with line + nearest-named hint', async () => {
    const src = `scatter\nno-name\n\n[North America] #e6194b\n  US 76300 12700\n\n[Caribbean] #4363d8\n  JM 6050 1250`;
    const r = await renderPipeline(src, opts);
    expect(r.svg).toBeNull();
    expect(r.error).toMatch(/#e6194b/);
    expect(r.error).toMatch(/Nearest: red/);
    expect(r.error).toMatch(/Nearest: blue/);
  });

  it('blocks CSS color names (crimson/royalblue) even though the library warns', async () => {
    const src = `scatter\n\n[NA] crimson\n  US 100 200\n\n[SA] royalblue\n  BR 50 60`;
    const r = await renderPipeline(src, opts);
    expect(r.svg).toBeNull();
    expect(r.error).toMatch(/crimson/);
    expect(r.error).toMatch(/royalblue/);
    expect(r.error).toMatch(/only these 11 named colors/);
  });

  it('renders cleanly when every color is a named palette color', async () => {
    const src = `scatter\n\n[NA] red\n  US 100 200\n\n[SA] blue\n  BR 50 60`;
    const r = await renderPipeline(src, opts);
    expect(r.error).toBeNull();
    expect(r.svg).toBeTruthy();
  });

  it('renders cleanly when no color is specified (auto palette)', async () => {
    const src = `scatter\n\n[NA]\n  US 100 200\n\n[SA]\n  BR 50 60`;
    const r = await renderPipeline(src, opts);
    expect(r.error).toBeNull();
    expect(r.svg).toBeTruthy();
  });
});

// One node line and one edge connector per line, in a chart type dagre lays out
// (boxes-and-lines) and in one it does not (sequence).
const chain = (edges: number) =>
  [
    'boxes-and-lines',
    ...Array.from({ length: edges }, (_, i) => `n${i} -> n${i + 1}`),
  ].join('\n');
const messages = (count: number) =>
  ['sequence', ...Array.from({ length: count }, (_, i) => `A -m${i}-> B`)].join(
    '\n'
  );

describe('input caps in renderPipeline, before parse and layout (#1557)', () => {
  it('refuses a line past the length cap, naming the line', async () => {
    const src = `flowchart\n(a) -> (b) ${'[]('.repeat(2000)}`;
    const r = await renderPipeline(src, opts);
    expect(r.svg).toBeNull();
    expect(r.error).toMatch(
      /^Line 2 is 6011 characters long; the limit is 1000\./
    );
  });

  it('accepts a line at the length cap', () => {
    expect(
      inputSizeError(`flowchart\n(a) -> (${'b'.repeat(1000 - 9)})`)
    ).toBeNull();
  });

  it('refuses a dagre-laid-out graph past the graph cap, before layout', async () => {
    // The chart-type line plus 150 lines of one node and one connector: 301.
    const r = await renderPipeline(chain(150), opts);
    expect(r.svg).toBeNull();
    expect(r.error).toBe(
      'The boxes-and-lines diagram has 301 nodes and edges; the limit for this chart type is 300. Split it into smaller diagrams.'
    );
  });

  it('accepts a dagre-laid-out graph at the graph cap', () => {
    expect(inputSizeError(chain(149))).toBeNull();
  });

  it('counts every connector on a line toward the graph cap', () => {
    // 51 nodes and 50 connectors a line, so 51 a line: five lines and the
    // chart-type line are 256, six are 307.
    const line = Array.from({ length: 51 }, (_, i) => `n${i}`).join(' -> ');
    const src = (n: number) =>
      ['boxes-and-lines', ...Array.from({ length: n }, () => line)].join('\n');
    expect(inputSizeError(src(5))).toBeNull();
    expect(inputSizeError(src(6))).toMatch(
      /has 307 nodes and edges; the limit for this chart type is 300/
    );
  });

  it('counts an edge written with no arrow — an ER relationship, a sitemap child', () => {
    const er = [
      'er',
      ...Array.from({ length: 30 }, (_, t) => [
        `t${t}`,
        ...Array.from({ length: 9 }, () => `  1-has-* t${(t + 1) % 30}`),
      ]).flat(),
    ];
    expect(er.length).toBe(301);
    expect(inputSizeError(er.join('\n'))).toMatch(
      /^The er diagram has 301 nodes and edges/
    );
    const sitemap = [
      'sitemap',
      ...Array.from({ length: 300 }, (_, i) => `${i ? '  ' : ''}Page ${i}`),
    ];
    expect(inputSizeError(sitemap.join('\n'))).toMatch(
      /^The sitemap diagram has 301 nodes and edges/
    );
  });

  it('holds a chart type dagre does not lay out to the node and edge cap only', async () => {
    // The chart-type line plus 999 lines of one node and one connector each.
    expect(inputSizeError(messages(999))).toBeNull();
    const r = await renderPipeline(messages(1001), opts);
    expect(r.svg).toBeNull();
    expect(r.error).toMatch(
      /more than 2000 nodes and edges \(counted to line 1001\)/
    );
  });

  it('lets every gallery fixture through every cap', () => {
    const dir = assetRoots()
      .map((root) => join(root, 'gallery', 'fixtures'))
      .find((d) => existsSync(d));
    expect(dir).toBeDefined();
    const files = readdirSync(dir!).filter((f) => f.endsWith('.dgmo'));
    expect(files.length).toBeGreaterThan(50);
    const refused = files.filter(
      (f) => inputSizeError(readFileSync(join(dir!, f), 'utf8')) !== null
    );
    expect(refused).toEqual([]);
  });
});
