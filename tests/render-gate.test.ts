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
import { renderPipeline } from '../src/render-helpers.js';

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
