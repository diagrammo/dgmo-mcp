// ============================================================
// flowchart-structure.test.ts — the structural hard-gate for flowcharts.
//
// validateFlowchartStructure() refuses flowcharts that are structurally broken:
// orphan nodes (not on a start→end path) and decisions with fewer than two
// outgoing branches. The gate runs inside renderPipeline + validate_diagram so
// an authoring LLM is forced to produce a connected, well-formed flow.
// ============================================================

import { describe, it, expect } from 'vitest';
import { validateFlowchartStructure } from '../src/flowchart-structure.js';
import { renderPipeline } from '../src/render-helpers.js';

const opts = { theme: 'light' as const, palette: 'slate' };

describe('validateFlowchartStructure', () => {
  it('flags a node that is declared but never wired into the flow', () => {
    const src = `flowchart T
(Start) -> <Worked?>
<Worked?> -yes-> (Approved)
<Worked?> -no-> (Denied)
[Floating]`;
    const issues = validateFlowchartStructure(src);
    const msgs = issues.map((i) => i.message).join('\n');
    expect(msgs).toMatch(/Floating.*not connected/);
    // Well-formed nodes are NOT flagged.
    expect(msgs).not.toMatch(/Worked\?.*not connected/);
    expect(msgs).not.toMatch(/Start.*not connected/);
  });

  it('flags a decision with only one branch', () => {
    const src = `flowchart T
(Start) -> <Ready?>
<Ready?> -yes-> (Done)`;
    const issues = validateFlowchartStructure(src);
    expect(issues.map((i) => i.message).join('\n')).toMatch(
      /Decision "Ready\?".*at least two/
    );
  });

  it('accepts a decision with non-binary specific labels', () => {
    const src = `flowchart T
(Start) -> <Type?>
<Type?> -retirement-> (A)
<Type?> -disability-> (B)
<Type?> -survivor-> (C)`;
    const issues = validateFlowchartStructure(src);
    expect(issues).toHaveLength(0);
  });

  it('passes a fully-connected, well-formed flow', () => {
    const src = `flowchart T
(Start) -> [Collect info] -> <Worked?>
<Worked?> -yes-> (Approved)
<Worked?> -no-> (Denied)`;
    const issues = validateFlowchartStructure(src);
    expect(issues).toHaveLength(0);
  });

  it('flags a flow with no end (pure cycle)', () => {
    const src = `flowchart T
[A] -> [B]
[B] -> [A]`;
    const issues = validateFlowchartStructure(src);
    expect(issues.map((i) => i.message).join('\n')).toMatch(/no end/);
  });
});

describe('flowchart structural gate in renderPipeline', () => {
  it('refuses a flowchart with a disconnected node', async () => {
    const src = `flowchart T
(Start) -> <Worked?>
<Worked?> -yes-> (Approved)
<Worked?> -no-> (Denied)
[Floating]`;
    const r = await renderPipeline(src, opts);
    expect(r.svg).toBeNull();
    expect(r.error).toMatch(/not connected/);
  });

  it('renders a well-formed flowchart', async () => {
    const src = `flowchart T
(Start) -> [Collect info] -> <Worked?>
<Worked?> -yes-> (Approved)
<Worked?> -no-> (Denied)`;
    const r = await renderPipeline(src, opts);
    expect(r.error).toBeNull();
    expect(r.svg).toBeTruthy();
  });

  it('does not gate non-flowchart diagrams', async () => {
    const src = `scatter\n\n[NA] red\n  US 100 200`;
    const r = await renderPipeline(src, opts);
    expect(r.error).toBeNull();
  });
});
