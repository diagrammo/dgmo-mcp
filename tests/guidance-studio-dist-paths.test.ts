// ============================================================
// guidance-studio-dist-paths.test.ts — the studio scripts name `dist/` files
// by string, and nothing else checks those strings against what the builds
// emit. Twice in September 2026 `pnpm studio` died on every run because a
// script named a file no build writes: `dgmo/dist/advanced.cjs` (dgmo is
// ESM-only) and `dist/render-helpers.mjs` (this package is "type": "module",
// so tsup writes `.js`). Both fixes were path strings and touched no test.
//
// Reads the sources only — no build runs here.
// ============================================================

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STUDIO = join(ROOT, 'tools', 'guidance-studio');
const DGMO_PKG = join(ROOT, '..', 'dgmo', 'package.json');

const read = (p: string): string => readFileSync(p, 'utf8');

// Every `dist/<name>` a script names, in both spellings the scripts use:
// a literal path string ('dist/render-helpers.js') and path segments
// (join(dgmoSrc, 'dist', 'advanced.js')).
function distNames(source: string, base: string): string[] {
  const esc = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const literal = new RegExp(`dist/(${esc}\\.[a-z]+)\\b`, 'g');
  const segments = new RegExp(
    `['"]dist['"]\\s*,\\s*['"](${esc}\\.[a-z]+)['"]`,
    'g'
  );
  return [...source.matchAll(literal), ...source.matchAll(segments)].map(
    (m) => m[1]
  );
}

// What tsup emits for an ESM entry: `.js` in a "type": "module" package,
// `.mjs` otherwise.
function tsupEsmExtension(): string {
  const tsup = read(join(ROOT, 'tsup.config.ts'));
  expect(tsup).toMatch(/format:\s*\[\s*'esm'\s*\]/);
  expect(tsup).toContain("'src/render-helpers.ts'");
  const pkg = JSON.parse(read(join(ROOT, 'package.json'))) as {
    type?: string;
  };
  return pkg.type === 'module' ? '.js' : '.mjs';
}

describe('guidance studio dist paths match what the builds emit', () => {
  it.each(['build-gallery.mjs', 'save-plugin.ts'])(
    '%s names the render-helpers file tsup writes',
    (file) => {
      const names = distNames(read(join(STUDIO, file)), 'render-helpers');
      expect(names.length).toBeGreaterThan(0);
      const expected = `render-helpers${tsupEsmExtension()}`;
      for (const name of names) expect(name).toBe(expected);
    }
  );

  it.skipIf(!existsSync(DGMO_PKG))(
    "use-local-dgmo.mjs names the file dgmo's ./advanced export resolves to",
    () => {
      const pkg = JSON.parse(read(DGMO_PKG)) as {
        exports: Record<string, { import?: string; default?: string }>;
      };
      const entry = pkg.exports['./advanced'];
      const target = (entry.import ?? entry.default ?? '').replace(/^\.\//, '');
      expect(target).toMatch(/^dist\/advanced\.[a-z]+$/);

      const names = distNames(
        read(join(STUDIO, 'use-local-dgmo.mjs')),
        'advanced'
      );
      expect(names.length).toBeGreaterThan(0);
      for (const name of names) expect(`dist/${name}`).toBe(target);
    }
  );
});
