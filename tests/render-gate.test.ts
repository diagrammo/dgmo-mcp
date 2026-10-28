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

  it('refuses a dagre-laid-out graph past the edge cap, before layout', async () => {
    const r = await renderPipeline(chain(151), opts);
    expect(r.svg).toBeNull();
    expect(r.error).toBe(
      'The boxes-and-lines diagram has 151 edges; the limit for this chart type is 150. Split it into smaller diagrams.'
    );
  });

  it('accepts a dagre-laid-out graph at the edge cap', () => {
    expect(inputSizeError(chain(150))).toBeNull();
  });

  it('counts every connector on a line toward the edge cap', () => {
    // 76 nodes and 75 connectors a line: two lines are 150 edges, three are 225.
    const line = Array.from({ length: 76 }, (_, i) => `n${i}`).join(' -> ');
    const src = (n: number) =>
      ['boxes-and-lines', ...Array.from({ length: n }, () => line)].join('\n');
    expect(inputSizeError(src(2))).toBeNull();
    expect(inputSizeError(src(3))).toMatch(
      /has 225 edges; the limit for this chart type is 150/
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
