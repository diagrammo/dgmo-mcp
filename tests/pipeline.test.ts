// ============================================================
// pipeline.test.ts — exercises the render pipeline directly, without the MCP
// transport (Story 110.3). Every tool (render_diagram, preview_diagram,
// generate_report, the open_in_app browser fallback) routes through this one
// function, so its contract is the tools' shared behavior.
// ============================================================

import { describe, it, expect } from 'vitest';
import { renderPipeline } from '../src/index.js';

describe('renderPipeline', () => {
  it('renders a valid diagram → svg, no error', async () => {
    const r = await renderPipeline('bar Revenue\n\nNorth 850\nSouth 620', {
      theme: 'light',
      palette: 'slate',
    });
    expect(r.error).toBeNull();
    expect(r.svg).toMatch(/<svg/);
    expect(r.diagnostics.some((d) => d.severity === 'error')).toBe(false);
  });

  it('reports parse errors → null svg + formatted error + error diagnostics', async () => {
    const r = await renderPipeline('infra\n\nLB\n  -> API | split: 70%', {
      theme: 'light',
      palette: 'slate',
    });
    expect(r.svg).toBeNull();
    expect(r.error).toBeTruthy();
    expect(r.diagnostics.some((d) => d.severity === 'error')).toBe(true);
  });

  it('tolerates an unknown palette (resolution happens downstream, not here)', async () => {
    // The pipeline passes the palette string to render(); palette fallback +
    // its warning are a tool-level concern (Story 110.2), so the pipeline still
    // renders successfully here.
    const r = await renderPipeline('bar X\n\nA 1', {
      theme: 'dark',
      palette: 'not-a-real-palette',
    });
    expect(r.error).toBeNull();
    expect(r.svg).toMatch(/<svg/);
  });
});
