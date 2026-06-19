// ============================================================
// reference.test.ts — the dgmo-mcp test harness.
//
// Guards the reworked per-type slicer (F4): the old heading-regex slicer
// resolved only 16/45 ids (every hyphenated + grouped data-chart id failed).
// Two layers:
//   1. Unit tests on a small fixture — exact slicing / alias / boundary logic.
//   2. An integration test against the WORKSPACE language-reference.md
//      (dgmo/docs/...) asserting all 45 chart-type ids resolve. (The published
//      node_modules copy lags until a dgmo release + dep bump — AC15 — so the
//      contract is verified against the source of truth, not the stale bundle.)
// ============================================================

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chartTypes } from '@diagrammo/dgmo';
import {
  extractSection,
  parseTypeAliases,
  extractColorRule,
} from '../src/reference.js';

const here = dirname(fileURLToPath(import.meta.url));

const FIXTURE = `# Ref

<!-- TYPE-ALIASES: line=bar pie=bar daci=raci -->

## 1. Intro

text

## 3. Sequence

<!-- TYPE:sequence -->

Sequence body.

## 16. Data Charts

<!-- TYPE:bar -->

Bar body across simple charts.

<!-- TYPE:scatter -->

Scatter body.

## 22. Journey Map

<!-- TYPE:journey-map -->

Journey body.

## 26. Colon Summary

Trailing section with no TYPE marker.
`;

describe('parseTypeAliases', () => {
  it('parses the alias map', () => {
    const m = parseTypeAliases(FIXTURE);
    expect(m.get('line')).toBe('bar');
    expect(m.get('pie')).toBe('bar');
    expect(m.get('daci')).toBe('raci');
    expect(m.size).toBe(3);
  });

  it('returns an empty map when no alias comment exists', () => {
    expect(parseTypeAliases('# nothing here').size).toBe(0);
  });
});

describe('extractSection (anchor-based slicer)', () => {
  it('slices a literal TYPE block, ending at the next TYPE marker', () => {
    const block = extractSection(FIXTURE, 'bar');
    expect(block).toContain('Bar body across simple charts.');
    expect(block).not.toContain('Scatter body.');
    expect(block).not.toContain('Sequence body.');
  });

  it('resolves a hyphenated id (the old slicer failed these)', () => {
    const block = extractSection(FIXTURE, 'journey-map');
    expect(block).toContain('Journey body.');
    // ends at the next H2 (no trailing TYPE marker)
    expect(block).not.toContain('Trailing section');
  });

  it('resolves grouped aliases to the shared block', () => {
    const bar = extractSection(FIXTURE, 'bar');
    expect(extractSection(FIXTURE, 'line')).toBe(bar);
    expect(extractSection(FIXTURE, 'pie')).toBe(bar);
  });

  it('ends a block at the next H2 when no further TYPE marker follows', () => {
    const block = extractSection(FIXTURE, 'journey-map');
    expect(block?.trimEnd().endsWith('Journey body.')).toBe(true);
  });

  it('returns null for an id with neither marker nor alias', () => {
    expect(extractSection(FIXTURE, 'nonexistent')).toBeNull();
  });
});

describe('extractColorRule', () => {
  it('extracts the text between the COLORS markers', () => {
    const md = `pre\n<!-- COLORS start -->\nonly 11 colors\n<!-- COLORS end -->\npost`;
    expect(extractColorRule(md)).toBe('only 11 colors');
  });

  it('returns null when the markers are absent', () => {
    expect(extractColorRule('no markers here')).toBeNull();
  });
});

describe('color rule rides every per-type slice (closed-set contract)', () => {
  const ref = workspaceReference();
  const anchored = ref != null && /<!--\s*TYPE:/.test(ref);

  it('the real reference defines the COLORS block with the closed 11-name list', () => {
    if (!anchored) return;
    const rule = extractColorRule(ref as string);
    expect(rule).toBeTruthy();
    for (const name of [
      'red',
      'orange',
      'yellow',
      'green',
      'blue',
      'purple',
      'teal',
      'cyan',
      'gray',
      'black',
      'white',
    ]) {
      expect(rule).toContain(`\`${name}\``);
    }
    // explicitly names CSS colors as INVALID so the model stops emitting them
    expect(rule).toMatch(/crimson/);
    expect(rule).toMatch(/royalblue/);
    expect(rule).toMatch(/hex/i);
  });
});

// Resolve the workspace reference (source of truth with the new anchors).
function workspaceReference(): string | null {
  const candidates = [
    join(here, '..', '..', 'dgmo', 'docs', 'language-reference.md'),
    join(
      here,
      '..',
      'node_modules',
      '@diagrammo',
      'dgmo',
      'docs',
      'language-reference.md'
    ),
  ];
  for (const p of candidates) if (existsSync(p)) return readFileSync(p, 'utf8');
  return null;
}

describe('integration — all 45 chart-type ids resolve against the real reference (F4/AC6)', () => {
  const ref = workspaceReference();
  const anchored = ref != null && /<!--\s*TYPE:/.test(ref);

  it('found a reference with TYPE anchors', () => {
    // If this fails in a published-only checkout, the dgmo dep predates the
    // anchor rework (AC15) — the workspace source is the contract here.
    expect(
      anchored,
      'no anchored language-reference.md found (workspace dgmo expected)'
    ).toBe(true);
  });

  for (const c of chartTypes) {
    it(`resolves ${c.id}`, () => {
      if (!anchored) return; // guarded by the assertion above
      const block = extractSection(ref as string, c.id);
      expect(block, `no TYPE block for "${c.id}"`).toBeTruthy();
      expect((block ?? '').length).toBeGreaterThan(20);
    });
  }
});

// AC11: authored TIPS reach the per-type MCP slice automatically — the slice is
// inclusive of the TYPE marker, so no MCP code change is needed. This asserts the
// delivery channel for the seed tranche; aliased ids (line→bar) inherit it.
describe('per-type TIPS ride along the MCP slice (AC11)', () => {
  const ref = workspaceReference();
  const anchored = ref != null && /<!--\s*TYPE:/.test(ref);
  // A few seed types known to be authored in this spec + an alias (pie→bar).
  const seededWithTips = ['flowchart', 'map', 'bar', 'sequence', 'gantt'];

  for (const id of seededWithTips) {
    it(`get_language_reference slice for ${id} includes its TIPS block`, () => {
      if (!anchored) return;
      const block = extractSection(ref as string, id) ?? '';
      expect(block).toMatch(/<!--\s*TIPS start\s*-->/);
      expect(block).toMatch(/<!--\s*TIPS end\s*-->/);
    });
  }

  it('an aliased id (pie→bar) inherits the parent block TIPS', () => {
    if (!anchored) return;
    const block = extractSection(ref as string, 'pie') ?? '';
    expect(block).toMatch(/<!--\s*TIPS start\s*-->/);
  });
});
