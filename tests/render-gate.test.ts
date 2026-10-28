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

// A boxes-and-lines chain: one node line and one edge connector per line.
const chain = (edges: number) =>
  [
    'boxes-and-lines',
    ...Array.from({ length: edges }, (_, i) => `n${i} -> n${i + 1}`),
  ].join('\n');

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

  it('refuses a diagram past the node and edge cap', async () => {
    const r = await renderPipeline(chain(1001), opts);
    expect(r.svg).toBeNull();
    expect(r.error).toMatch(
      /more than 2000 nodes and edges \(counted to line 1001\)/
    );
  });

  it('accepts a diagram at the node and edge cap', () => {
    // The chart-type line plus 999 lines of one node and one connector each.
    expect(inputSizeError(chain(999))).toBe(null);
    expect(inputSizeError(chain(1000))).toMatch(/more than 2000/);
  });

  it('counts every connector on a chain line, not only the line', () => {
    // 100 nodes and 99 connectors a line: the 20th chain line (line 21) crosses.
    const line = Array.from({ length: 100 }, (_, i) => `n${i}`).join(' -> ');
    const src = [
      'boxes-and-lines',
      ...Array.from({ length: 25 }, () => line),
    ].join('\n');
    expect(inputSizeError(src)).toMatch(
      /more than 2000 nodes and edges \(counted to line 21\)/
    );
  });

  it('lets every gallery fixture through both caps', () => {
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
