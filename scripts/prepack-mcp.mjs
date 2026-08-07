#!/usr/bin/env node
/**
 * Refuse to publish a `@diagrammo/dgmo-mcp` that cannot draw.
 *
 * 🔴 This exists because the identical change to `@diagrammo/dgmo-cli` shipped
 * broken. Inlining the library moves it away from the data files it looks up
 * relative to its own module, and 0.62.0 therefore rendered 20 of 20 non-map
 * fixtures and 0 of 18 maps (issue #121) — while the binary ran, `--version`
 * answered, and the tarball installed cleanly. The failure even reported itself
 * as bad input rather than a missing asset (issue #122), so it read as somebody
 * else's problem.
 *
 * The lesson that check bought: a smoke test that runs the thing is necessary
 * and not sufficient. Only rendering EVERY chart type catches one dead type.
 *
 * So this walks the staged gallery — which also proves the staging ran — and
 * pushes each type through the built `dist/render-helpers.js`, the same module
 * the server itself calls. It then rasterises one to PNG, because fonts resolve
 * on a different path from basemaps and would otherwise go unchecked.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

const fail = (msg) => {
  console.error(`✖ prepack: ${msg}`);
  process.exit(1);
};

// 1. The staged assets. Each one is read at runtime by a different tool, and a
//    missing one is invisible until somebody calls that tool.
for (const [rel, why] of [
  ['map-data/world-detail.json', 'every map chart'],
  ['fonts/Inter-Regular.ttf', 'PNG rasterisation'],
  ['fonts/Inter-Bold.ttf', 'PNG rasterisation'],
  ['docs/language-reference.md', 'the get_language_reference tool'],
  ['gallery/fixtures', 'the get_examples tool'],
]) {
  if (!existsSync(join(DIST, rel))) {
    fail(`dist/${rel} is missing — ${why} would fail at the point of use`);
  }
}

// 2. The library must be INLINED, not imported. If this regressed, the package
//    would work perfectly here and fail wherever the library is absent.
const entry = join(DIST, 'index.js');
if (!existsSync(entry)) fail('dist/index.js is missing — run `pnpm build` first');
if (/from\s*["']@diagrammo\/dgmo/.test(readFileSync(entry, 'utf8'))) {
  fail(
    'dist/index.js still imports @diagrammo/dgmo at runtime — it is a ' +
      'devDependency now, so this would throw on a clean install'
  );
}

// 3. One fixture per chart type, through the real render path.
const FIXTURES = join(DIST, 'gallery/fixtures');
const byType = new Map();
for (const f of readdirSync(FIXTURES).sort()) {
  if (!f.endsWith('.dgmo')) continue;
  const type = basename(f, '.dgmo').split('-')[0];
  if (!byType.has(type)) byType.set(type, join(FIXTURES, f));
}
if (byType.size < 20) {
  fail(`only ${byType.size} chart types found in the staged gallery — that is not a full copy`);
}

const { renderPipeline, svgToPngBase64 } = await import(
  pathToFileURL(join(DIST, 'render-helpers.js')).href
);

const broken = [];
let mapSvg = null;
for (const [type, file] of byType) {
  const source = readFileSync(file, 'utf8');
  try {
    const res = await renderPipeline(source, { theme: 'light', palette: 'nord' });
    if (!res.svg) broken.push(`${type} (${res.error ?? 'empty svg'})`);
    else if (type === 'map') mapSvg = res.svg;
  } catch (err) {
    broken.push(`${type} (${err instanceof Error ? err.message : String(err)})`);
  }
}

if (broken.length > 0) {
  fail(
    `${broken.length} of ${byType.size} chart types failed to render:\n  ` +
      broken.join('\n  ') +
      '\n  This package would ship broken, so nothing was published.'
  );
}

// 4. Fonts, on their own path. A map is the strongest case — it is the chart
//    type that broke last time and it carries the most text.
try {
  const png = svgToPngBase64(mapSvg ?? (await renderPipeline('pie A 1\nB 2', { theme: 'light', palette: 'nord' })).svg);
  if (!png || png.length < 1000) fail('PNG rasterisation produced no meaningful output');
} catch (err) {
  fail(`PNG rasterisation threw: ${err instanceof Error ? err.message : String(err)}`);
}

console.log(
  `✓ prepack: ${byType.size} chart types render through the built server, assets staged, library inlined`
);
