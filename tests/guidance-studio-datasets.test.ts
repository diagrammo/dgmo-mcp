// ============================================================
// guidance-studio-datasets.test.ts — coverage invariants for the studio's
// per-type datasets + starter prompts. Locks three guarantees:
//   1. Every chart type has a starter prompt.
//   2. Every chart type has a fitting dataset EXCEPT the handful of pure-logic
//      types whose prompt is fully self-contained (a dataset adds no value).
//   3. Every starter prompt has a gallery source, and that source renders.
// Regenerate fixtures with `node tools/guidance-studio/datasets/build.mjs`.
// ============================================================

import { describe, it, expect } from 'vitest';
import registry from '../tools/guidance-studio/registry.json';
import manifest from '../tools/guidance-studio/datasets/manifest.json';
import prompts from '../tools/guidance-studio/prompts.json';
import promptValidation from '../tools/guidance-studio/prompt-validation.json';
import gallerySources from '../tools/guidance-studio/gallery-sources.json';
import { renderPipeline } from '../src/render-helpers.js';

// Types whose content is fully specified by the prompt itself, so no injected
// dataset is needed (logic/structure the model builds from the instruction).
//
// `sketch` joined them 2026-09-04. It is not a data chart at all — the language
// reference calls it "a GUI-authored format — the desktop and web canvas
// editors generate this markup, so hand-writing it is the exception", and the
// same block caps a good sketch at ~15 shapes. That is the identical reason
// `wireframe` has always been here.
const DATASETLESS = new Set(['flowchart', 'function', 'wireframe', 'sketch']);

// The studio shows exactly the TYPE-block ids in registry.json, not the full
// chartTypes registry (which includes grouped data-chart ids like line/pie).
const typeIds = (registry as { types: { id: string }[] }).types.map(
  (t) => t.id
);
const promptMap = prompts as Record<string, string[]>;
const sourceMap = gallerySources as Record<string, string[]>;
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

  it('every starter prompt has a persisted, passing validation verdict', () => {
    // prompt-validation.json records the validation pass (parse + render +
    // intent) and the studio surfaces it per prompt. Lock it in sync: every
    // current prompt must have a verdict, keyed by exact text, that passed.
    type Verdict = {
      prompt: string;
      valid: boolean;
      render: string;
      intent: string;
    };
    const byText = new Map<string, Verdict>();
    for (const [k, v] of Object.entries(
      promptValidation as Record<string, unknown>
    )) {
      if (k === '_meta') continue;
      for (const verdict of v as Verdict[]) byText.set(verdict.prompt, verdict);
    }
    const problems: string[] = [];
    for (const id of typeIds) {
      for (const p of promptMap[id] ?? []) {
        const v = byText.get(p);
        if (!v) problems.push(`${id}: no verdict for "${p.slice(0, 40)}…"`);
        else if (!v.valid || v.render !== 'ok' || v.intent !== 'good')
          problems.push(`${id}: weak verdict for "${p.slice(0, 40)}…"`);
      }
    }
    expect(problems).toEqual([]);
  });

  // gallery-sources.json is the by-hand half of the studio. registry.json
  // regenerates itself on every `pnpm studio` run, so it cannot drift for
  // longer than one run; the gallery cannot regenerate, and the gap it grows
  // is invisible — build-gallery.mjs reports a missing source as "a render
  // failure on a fresh checkout and nowhere else". It had regrown to seven
  // types (body, bracket, clock, countdown, family, goal, sketch) after
  // `1a82b1b` closed the last one. These two assertions are what stop it
  // regrowing a third time.
  it('every starter prompt has an index-aligned gallery source', () => {
    const problems: string[] = [];
    for (const id of typeIds) {
      const want = promptMap[id] ?? [];
      const got = sourceMap[id] ?? [];
      if (got.length !== want.length) {
        problems.push(
          `${id}: ${want.length} prompt(s), ${got.length} source(s)`
        );
        continue;
      }
      got.forEach((dgmo, i) => {
        if (typeof dgmo !== 'string' || !dgmo.trim())
          problems.push(`${id}[${i}]: empty source`);
      });
    }
    expect(problems).toEqual([]);
  });

  it('every gallery source renders through the shipped pipeline', async () => {
    // The same call build-gallery.mjs makes — theme light, palette slate — so
    // a source that passes here is one the gallery can actually draw. It is
    // the render only, never the rasterisation, which is what keeps a
    // whole-corpus check affordable.
    const problems: string[] = [];
    for (const id of typeIds) {
      const got = sourceMap[id] ?? [];
      for (let i = 0; i < got.length; i++) {
        const r = await renderPipeline(got[i], {
          theme: 'light',
          palette: 'slate',
        });
        if (r.error || !r.svg)
          problems.push(`${id}[${i}]: ${r.error ?? 'no svg'}`);
        else if (r.diagnostics.some((d) => d.severity === 'error'))
          problems.push(
            `${id}[${i}]: ${r.diagnostics.find((d) => d.severity === 'error')?.message}`
          );
      }
    }
    expect(problems).toEqual([]);
  }, 60_000);

  it('every dataset suitsTypes entry maps to a real chart type (no typos)', () => {
    // Datasets may also list non-registry aliases (line, pie); allow those two.
    const aliases = new Set(['line', 'pie']);
    const known = new Set([...typeIds, ...aliases]);
    const unknown = [...suited].filter((t) => !known.has(t));
    expect(unknown).toEqual([]);
  });
});
