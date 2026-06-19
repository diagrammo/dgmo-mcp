// ============================================================
// guidance-studio-validate.test.ts — unit coverage for the TIPS write-back
// guard (T5 / AC6 / AC7). The studio is a dev-only by-eye tool, but the
// write-back ships to every MCP client, so its validator is tested.
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  validateTipsEdit,
  applyTipsEdit,
  currentTipsBlock,
  tipsCoverage,
} from '../tools/guidance-studio/validate-tips';

// Minimal reference doc with an alias map and two TYPE blocks: one already has
// TIPS (map), one does not yet (bar). The bar block is followed by an H2 to
// exercise the boundary.
const MD = `<!-- TYPE-ALIASES: doughnut=pie multi-line=line -->

## 1. Bar

<!-- TYPE:bar -->

Bar charts compare values across categories.

### options

stuff

## 2. Map

<!-- TYPE:map -->

<!-- TIPS start -->
**Styling tips:** name places and stop; tag POIs by category.
<!-- TIPS end -->

Geographic concept maps.
`;

const GOOD = `<!-- TIPS start -->
**Styling tips:** sort bars descending; color a single highlighted bar.
<!-- TIPS end -->`;

describe('validateTipsEdit', () => {
  it('accepts a clean edit and returns spliced markdown (AC6)', () => {
    const r = validateTipsEdit(MD, 'bar', GOOD);
    expect(r.ok).toBe(true);
    expect(r.result).toContain('sort bars descending');
    // TIPS landed inside the bar block, before the H3 options sub-heading.
    expect(r.result!.indexOf('sort bars descending')).toBeLessThan(
      r.result!.indexOf('### options')
    );
    // Untouched map block still has its tips.
    expect(r.result).toContain('name places and stop');
  });

  it('replaces an existing TIPS block rather than duplicating it', () => {
    const replacement = `<!-- TIPS start -->\nNew map guidance.\n<!-- TIPS end -->`;
    const r = validateTipsEdit(MD, 'map', replacement);
    expect(r.ok).toBe(true);
    expect((r.result!.match(/<!-- TIPS start -->/g) ?? []).length).toBe(1); // bar has none; map replaced, still one
    expect(r.result).toContain('New map guidance.');
    expect(r.result).not.toContain('name places and stop');
  });

  it('resolves aliases to the parent block', () => {
    const r = validateTipsEdit(MD, 'doughnut', GOOD); // alias → pie? no pie block here
    // doughnut aliases to pie which has no block → reject with clear reason
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/no TYPE block/i);
  });

  it('rejects a ```dgmo fence (AC7)', () => {
    const bad = `<!-- TIPS start -->\nUse this:\n\`\`\`dgmo\nbar\n\`\`\`\n<!-- TIPS end -->`;
    const r = validateTipsEdit(MD, 'bar', bad);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/fence/i);
  });

  it('rejects a broken / unbalanced anchor (AC7)', () => {
    const bad = `<!-- TIPS start -->\nNo closing anchor here.`;
    const r = validateTipsEdit(MD, 'bar', bad);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/anchor/i);
  });

  it('rejects an empty body', () => {
    const bad = `<!-- TIPS start -->\n   \n<!-- TIPS end -->`;
    const r = validateTipsEdit(MD, 'bar', bad);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/empty/i);
  });

  it('rejects a TIPS placed outside the sliced block via a stray H2 (F10/AC7)', () => {
    const bad = `<!-- TIPS start -->\n## Sneaky heading\n**tips** here\n<!-- TIPS end -->`;
    const r = validateTipsEdit(MD, 'bar', bad);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/within the sliced/i);
  });

  it('rejects an unknown type', () => {
    const r = validateTipsEdit(MD, 'nope', GOOD);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/no TYPE block/i);
  });
});

describe('applyTipsEdit', () => {
  it('is idempotent on re-applying the same block', () => {
    const once = applyTipsEdit(MD, 'bar', GOOD);
    const twice = applyTipsEdit(once, 'bar', GOOD);
    expect(twice).toBe(once);
  });
});

describe('currentTipsBlock', () => {
  it('returns the existing block for a type with tips', () => {
    expect(currentTipsBlock(MD, 'map')).toContain('name places and stop');
  });
  it('returns null for a type without tips', () => {
    expect(currentTipsBlock(MD, 'bar')).toBeNull();
  });
});

describe('tipsCoverage', () => {
  it('reports has-tips/empty per raw TYPE block', () => {
    const cov = tipsCoverage(MD);
    expect(cov).toEqual([
      { type: 'bar', hasTips: false },
      { type: 'map', hasTips: true },
    ]);
  });
});
