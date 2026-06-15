// Browser-safe stand-in for `@diagrammo/dgmo/internal`.
//
// The real barrel re-exports the full render library (`export * from advanced`),
// which pulls in node `fs` and cannot be bundled for the browser (Task-0 spike:
// esbuild "Could not resolve 'fs'"). The scorer only needs the chart-type
// REGISTRY, so vite aliases that import to this shim. `registry.json` is auto-
// dumped from the installed dgmo every time `pnpm harness` runs (see the
// `harness` script's dump-registry.mjs step) so it never drifts from the real
// library — only the import path is redirected; scoring.ts is bundled unchanged.
import registry from './registry.json';

export const chartTypes = registry as readonly {
  id: string;
  description: string;
  fallback?: boolean;
}[];
