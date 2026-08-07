import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Where to look for the data files this server reads at runtime — the Inter
 * TTFs, `language-reference.md`, and the gallery fixtures.
 *
 * These used to be found through `require.resolve('@diagrammo/dgmo')`, back
 * when the library was a runtime dependency. It is a devDependency now (the
 * bundle inlines it), so there is no installed package to resolve and the files
 * travel in our own `dist/` — see scripts/stage-assets.mjs.
 *
 * The three roots, in order:
 *
 * 1. **Our own module directory.** When built, that is `dist/`, where the
 *    staging step put everything. This is the only one that matters in a
 *    published install.
 * 2. **A sibling `dgmo/` checkout.** For running from source in this workspace,
 *    where `dist/` holds no staged assets because nothing has been built.
 * 3. **`node_modules/@diagrammo/dgmo`.** The devDependency, for the same
 *    from-source case in a checkout without a sibling.
 *
 * Note this deliberately covers only the three assets whose layout is IDENTICAL
 * under both a staged `dist/` and the library root. Basemaps are not among them
 * — they live at `dist/map-data` here and `dist/map-data` there, and they are
 * found by the library's own `load-data.ts` walking directories relative to
 * itself, not by this helper. Do not add them.
 */
export function assetRoots(): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  const pkg = resolve(here, '..');
  return [
    here,
    resolve(pkg, '..', 'dgmo'),
    join(pkg, 'node_modules', '@diagrammo', 'dgmo'),
  ].filter((d) => existsSync(d));
}
