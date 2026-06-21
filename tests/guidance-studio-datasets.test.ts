// ============================================================
// guidance-studio-datasets.test.ts — coverage invariants for the studio's
// per-type datasets + starter prompts. Locks two guarantees:
//   1. Every chart type has a starter prompt.
//   2. Every chart type has a fitting dataset EXCEPT the handful of pure-logic
//      types whose prompt is fully self-contained (a dataset adds no value).
// Regenerate fixtures with `node tools/guidance-studio/datasets/build.mjs`.
// ============================================================

import { describe, it, expect } from 'vitest';
import registry from '../tools/guidance-studio/registry.json';
import manifest from '../tools/guidance-studio/datasets/manifest.json';
import prompts from '../tools/guidance-studio/prompts.json';

// Types whose content is fully specified by the prompt itself, so no injected
// dataset is needed (logic/structure the model builds from the instruction).
const DATASETLESS = new Set(['flowchart', 'function', 'wireframe']);

// The studio shows exactly the TYPE-block ids in registry.json (35), not the
// full 45-entry chartTypes registry (which includes aliases like pie/doughnut).
const typeIds = (registry as { types: { id: string }[] }).types.map(
  (t) => t.id
);
const promptMap = prompts as Record<string, string[]>;
const suited = new Set(
  (manifest as { suitsTypes: string[] }[]).flatMap((d) => d.suitsTypes)
);

describe('guidance-studio per-type coverage', () => {
  it('every chart type has a non-empty starter prompt list', () => {
    const missing = typeIds.filter(
      (id) => !promptMap[id]?.length || !promptMap[id][0]?.trim()
    );
    expect(missing).toEqual([]);
  });

  it('every prompt entry is a non-empty trimmed string', () => {
    for (const id of typeIds) {
      for (const p of promptMap[id] ?? []) {
        expect(typeof p).toBe('string');
        expect(p.trim()).toBeTruthy();
      }
    }
  });

  it('every chart type has a dataset except the datasetless logic types', () => {
    const missing = typeIds.filter(
      (id) => !suited.has(id) && !DATASETLESS.has(id)
    );
    expect(missing).toEqual([]);
  });

  it('datasetless types are intentional (still have a prompt)', () => {
    for (const id of DATASETLESS) {
      expect(typeIds).toContain(id);
      expect(promptMap[id]?.[0]?.trim()).toBeTruthy();
    }
  });

  it('every dataset suitsTypes entry maps to a real chart type (no typos)', () => {
    // Datasets may also list non-registry aliases (line, pie); allow those two.
    const aliases = new Set(['line', 'pie']);
    const known = new Set([...typeIds, ...aliases]);
    const unknown = [...suited].filter((t) => !known.has(t));
    expect(unknown).toEqual([]);
  });
});
