// ============================================================
// suggest.test.ts — the chart-type SELECTION gate (moved here from dgmo).
//
// Selection is AI-authoring functionality owned by this server, so its tests
// live here too. Covers: trigger-id integrity against the dgmo registry, the
// hybrid scorer's contiguous-dominance + confidence rules, and selection
// accuracy on a representative natural-language set.
// ============================================================

import { describe, it, expect } from 'vitest';
import { chartTypes } from '@diagrammo/dgmo';
import {
  suggestChartTypes,
  scoreChartType,
  confidence,
  matchesContiguously,
  normalize,
  CONTIGUITY_DOMINANCE,
  MIN_PRIMARY_SCORE,
} from '../src/suggest/scoring';
import { TRIGGERS } from '../src/suggest/triggers';
import { internalChartTypeIds } from '../src/internal-flag';

const validIds = new Set(chartTypes.map((c) => c.id));

/**
 * Types that route but are never OFFERED (`ChartTypeMeta.internal`).
 *
 * 🔴 If the "every chart type has at least one trigger" check below fails on
 * one of these, adding a trigger phrase is EXACTLY the wrong fix. It is the
 * path of least resistance and it would make the assistant start proposing
 * `live-link` pointers to users who asked for a diagram — a file needing an id
 * only its publisher can hand out. The suggester drops these from its candidate
 * pool (src/suggest/scoring.ts), and the test below asserts it.
 */
const internalIds = internalChartTypeIds(chartTypes);
const offeredIds = new Set(
  chartTypes.map((c) => c.id).filter((id) => !internalIds.has(id))
);

describe('trigger vocabulary integrity (keyed by the dgmo registry)', () => {
  it('every TRIGGERS key is a real chart-type id', () => {
    const bad = Object.keys(TRIGGERS).filter((id) => !validIds.has(id));
    expect(bad, `unknown ids: ${bad.join(', ')}`).toEqual([]);
  });
  it('every OFFERED chart type has at least one trigger', () => {
    const missing = [...offeredIds].filter((id) => !TRIGGERS[id]?.length);
    expect(missing, `types with no triggers: ${missing.join(', ')}`).toEqual(
      []
    );
  });

  it('no internal type is in the suggester candidate pool', () => {
    const internal = [...internalIds];
    if (internal.length === 0) {
      // The INSTALLED @diagrammo/dgmo predates the `internal` flag. This guard
      // goes live by itself on the next dep bump — F7: mcp reads the installed
      // package, so its exceptions land before or with the dgmo publish, never
      // after, and a guard that cannot see the flag yet must not be red.
      console.warn(
        'installed @diagrammo/dgmo has no internal chart types — this guard is inert until the dep bump'
      );
      return;
    }
    for (const id of internal) {
      // Neither reachable by trigger…
      expect(TRIGGERS[id], `'${id}' has a trigger phrase`).toBeUndefined();
      // …nor by any prompt at all, since it is filtered from the pool.
      expect(
        suggestChartTypes(`draw me a ${id}`).ranked.some(
          (r) => r.type.id === id
        ),
        `'${id}' can be suggested`
      ).toBe(false);
    }
  });
  it('no trigger phrase belongs to more than one type', () => {
    const seen = new Map<string, string>();
    const collisions: string[] = [];
    for (const [id, ts] of Object.entries(TRIGGERS))
      for (const t of ts) {
        if (seen.has(t)) collisions.push(`"${t}": ${seen.get(t)} vs ${id}`);
        else seen.set(t, id);
      }
    expect(collisions).toEqual([]);
  });
});

describe('hybrid scorer mechanics', () => {
  it('a contiguous trigger phrase dominates loose token overlap', () => {
    const org = chartTypes.find((c) => c.id === 'org')!;
    const { score } = scoreChartType('org chart for the team', org);
    expect(score).toBeGreaterThanOrEqual(CONTIGUITY_DOMINANCE);
  });
  it('matchesContiguously is token-based, not substring', () => {
    expect(
      matchesContiguously(normalize('water diagram'), normalize('er'))
    ).toBe(false);
  });
  it('confidence: below floor → ambiguous; uncontested → high', () => {
    expect(confidence(0.5, 0)).toBe('ambiguous');
    expect(confidence(MIN_PRIMARY_SCORE, 0)).toBe('high');
    expect(confidence(4, 2)).toBe('high');
    expect(confidence(3, 2)).toBe('medium');
  });
});

describe('selection accuracy — natural language', () => {
  const cases: { prompt: string; accept: string[] }[] = [
    { prompt: 'who reports to whom', accept: ['org'] },
    { prompt: 'most common words in customer reviews', accept: ['wordcloud'] },
    { prompt: 'the lifecycle of an order', accept: ['state'] },
    { prompt: 'office locations worldwide of Chevron', accept: ['map'] },
    { prompt: 'who is responsible for each task', accept: ['raci'] },
    { prompt: 'database tables for a blog', accept: ['er'] },
    {
      prompt: 'system architecture of our microservices',
      accept: ['c4', 'infra', 'boxes-and-lines'],
    },
    { prompt: 'gantt chart for the Q3 launch', accept: ['gantt'] },
    {
      prompt: 'layers of needs from basic to self-actualization',
      accept: ['pyramid'],
    },
    { prompt: 'ring diagram of concentric rings', accept: ['ring'] },
  ];
  for (const { prompt, accept } of cases) {
    it(`"${prompt.slice(0, 42)}" → ${accept.join('/')}`, () => {
      const top1 = suggestChartTypes(prompt).ranked[0]?.type.id;
      expect(accept, `got ${top1}`).toContain(top1);
    });
  }
});
