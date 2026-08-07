#!/usr/bin/env node
/**
 * Copy the data files this server reads at runtime out of `@diagrammo/dgmo` and
 * into our own `dist/`, so the published package does not need the library
 * installed beside it.
 *
 * Why this exists: the MCP server used to declare `@diagrammo/dgmo` as a
 * runtime dependency, which meant every `npm i -g @diagrammo/dgmo-cli` pulled
 * the whole library plus its d3, dagre and lz-string trees — 17,028 KB — even
 * though the CLI bundle already inlines the library and never loads that copy.
 * The server now inlines it too (see `noExternal` in tsup.config.ts) and carries
 * these four assets itself.
 *
 * 🔴 `map-data` MUST land at `dist/map-data`. The inlined `src/map/load-data.ts`
 * looks for basemaps in directories relative to its own module — `./data`,
 * `./map-data`, `../map-data`, `../src/map/data` — and after bundling that
 * module lives in `dist/`. Getting this wrong does not fail the build or the
 * tests; it produces a server that renders every chart type except maps, and
 * reports the failure as though the diagram were invalid. That is exactly how
 * `@diagrammo/dgmo-cli` 0.62.0 shipped (issue #121), and why
 * `scripts/prepack-mcp.mjs` renders one fixture per chart type before publish.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

// Path lookup rather than require.resolve: the library's `exports` map does not
// expose `./package.json`, and none of these assets are reachable through it.
const LIB = join(ROOT, 'node_modules', '@diagrammo', 'dgmo');
const LIB_FALLBACK = resolve(ROOT, '..', 'dgmo'); // sibling checkout, local dev

function libRoot() {
  for (const candidate of [LIB, LIB_FALLBACK]) {
    if (existsSync(join(candidate, 'package.json'))) return candidate;
  }
  throw new Error(
    'stage-assets: @diagrammo/dgmo not found in node_modules or as a sibling ' +
      'checkout. It is a devDependency — run `pnpm install`.'
  );
}

/**
 * Each entry is [source relative to the library root, destination in dist/].
 *
 * Named files rather than whole directories, deliberately. Copying `fonts/`
 * wholesale brought the two woff2 builds and a licence — 296 KB that resvg
 * cannot use, since it rasterises from the TTFs — and copying `docs/` brought
 * three markdown files no tool reads. Both are the kind of waste that never
 * gets noticed once it ships.
 */
const ASSETS = [
  ['dist/map-data', 'map-data'],
  ['fonts/Inter-Regular.ttf', 'fonts/Inter-Regular.ttf'],
  ['fonts/Inter-Bold.ttf', 'fonts/Inter-Bold.ttf'],
  ['fonts/LICENSE-Inter.txt', 'fonts/LICENSE-Inter.txt'],
  // Which codepoints those TTFs actually contain, so a render can warn about
  // text no bundled glyph can draw. Generated from the subset output.
  ['fonts/coverage.json', 'fonts/coverage.json'],
  ['docs/language-reference.md', 'docs/language-reference.md'],
  ['gallery/fixtures', 'gallery/fixtures'],
];

const src = libRoot();
mkdirSync(DIST, { recursive: true });

const staged = [];
for (const [from, to] of ASSETS) {
  const source = join(src, from);
  if (!existsSync(source)) {
    throw new Error(
      `stage-assets: ${from} is missing from ${src}. The server reads it at ` +
        'runtime, so shipping without it would break a tool at the point of use.'
    );
  }
  const dest = join(DIST, to);
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(source, dest, { recursive: true });
  staged.push(to);
}

const bytes = (path) => {
  const st = statSync(path);
  if (!st.isDirectory()) return st.size;
  let n = 0;
  for (const e of readdirSync(path, { withFileTypes: true })) {
    n += bytes(join(path, e.name));
  }
  return n;
};
const total = staged.reduce((n, d) => n + bytes(join(DIST, d)), 0);
console.log(
  `✓ staged ${staged.join(', ')} into dist/ (${Math.round(total / 1024)} KB) from ${src === LIB ? 'node_modules' : 'the sibling checkout'}`
);
