import { defineConfig } from 'tsup';
import { execFileSync } from 'node:child_process';

/**
 * The four entries match the `exports` map in package.json: the server itself
 * (also the `bin`), the two suggester subpaths the ops console imports, and
 * `render-helpers`, which the dev-only guidance studio dynamic-imports from
 * `dist/` rather than from source.
 *
 * 🔴 `@diagrammo/dgmo` is INLINED, not depended on. It moved to a
 * devDependency on 2026-08-07. Declaring it at runtime meant every install of
 * this server — and every `npm i -g @diagrammo/dgmo-cli`, which spawns it —
 * unpacked the library plus its d3, dagre and lz-string trees: 17,028 KB, on
 * top of a CLI bundle that already inlines the same library and never loads
 * that copy. `@diagrammo/dgmo-cli` has inlined it since the CLI split for the
 * same reason.
 *
 * Two consequences, both deliberate:
 *
 * - **No more version tracking.** This package used to pick up library fixes on
 *   a consumer's `npm install` via `^0.62.0`; now a library fix reaches MCP
 *   users only when this package is republished. That cuts both ways — five of
 *   the imports here come from `@diagrammo/dgmo/advanced`, which carries no
 *   semver guarantee, so tracking meant a library patch could break an already
 *   installed server. Inlining pins it.
 * - **The runtime data files have to travel with us.** scripts/stage-assets.mjs
 *   copies the basemaps, fonts, language reference and gallery fixtures into
 *   `dist/`, and scripts/prepack-mcp.mjs refuses to publish if any of it fails
 *   to render. See the landmine note in stage-assets.mjs.
 */
export default defineConfig({
  entry: [
    'src/index.ts',
    'src/suggest/scoring.ts',
    'src/suggest/selection-tools.ts',
    'src/render-helpers.ts',
  ],
  format: ['esm'],
  dts: true,
  // Everything that is genuinely somebody else's package stays external. The
  // library is the deliberate exception, and the regex covers its subpaths
  // (`/advanced`, `/block`) as well as the root entry.
  noExternal: [/^@diagrammo\/dgmo(\/|$)/],
  external: [
    '@resvg/resvg-js',
    'jsdom',
    '@modelcontextprotocol/sdk',
    '@hono/node-server',
    'zod',
    '@lezer/lr',
    '@lezer/common',
  ],
  onSuccess: async () => {
    execFileSync(process.execPath, ['scripts/stage-assets.mjs'], {
      stdio: 'inherit',
    });
  },
});
